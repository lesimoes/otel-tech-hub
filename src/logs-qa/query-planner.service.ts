import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { Aggregation, PlannerMode, QueryPlan } from './query-plan.types';
import { defaultPlan } from './query-planner.heuristic';
import {
  inferHttpFromQuestion,
  isErrorQuestion,
} from './question-routes.util';

const PLANNER_SCHEMA = `{
  "mode": "aggregate" | "rag" | "hybrid",
  "timeWindow": { "amount": number, "unit": "minute" | "hour" | "day", "calendarDay": boolean (opcional, true para "hoje") },
  "filters": { "level": "ERROR" (opcional), "route": "/users" (só path), "httpMethod": "GET" },
  "aggregation": "count_failures" | "top_route_by_count" | "count_http_requests" | "none",
  "listLogs": boolean,
  "limit": number,
  "ragQuery": string (opcional)
}`;

@Injectable()
export class QueryPlannerService {
  private readonly chat: ChatOpenAI | null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.chat = apiKey
      ? new ChatOpenAI({
          apiKey,
          model: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
          temperature: 0,
        })
      : null;
  }

  async plan(question: string): Promise<QueryPlan> {
    if (!this.chat) return defaultPlan(question);

    try {
      const response = await this.chat.invoke([
        {
          role: 'system',
          content: `Você classifica perguntas sobre logs. Responda APENAS JSON válido no schema:
${PLANNER_SCHEMA}

Modos:
- aggregate: contagem ou ranking ("quantas falhas", "qual rota com mais erros")
- rag: busca semântica por tema ("existe problema de conexão?", "por que falhou?")
- hybrid: contagem + listagem ("houve transação criada?", "quais logs ocorreram hoje?")

Regras:
- listLogs=true quando pedir listar/mostrar/quais/houve algum(a)/ocorreram
- filters.level="ERROR" SOMENTE quando a pergunta for sobre erros/falhas/problemas — NÃO filtrar level para perguntas sobre transações, requisições ou eventos normais
- "houve transação criada" -> hybrid, aggregation count_http_requests, httpMethod POST, route /transactions, listLogs true
- "hoje" -> timeWindow { amount: 1, unit: "day", calendarDay: true }
- "quantas vezes GET /users" -> mode hybrid, aggregation count_http_requests, httpMethod GET, route /users, listLogs true
- NUNCA coloque "GET: /users" em route; separe httpMethod e route
- count_failures e top_route_by_count são só para perguntas de erro/falha`,
        },
        { role: 'user', content: question },
      ]);

      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
      const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonText) as QueryPlan;
      return normalizePlan(parsed, question);
    } catch {
      return defaultPlan(question);
    }
  }
}

function normalizePlan(raw: QueryPlan, question: string): QueryPlan {
  const fallback = defaultPlan(question);

  const mode: PlannerMode =
    raw.mode === 'aggregate' || raw.mode === 'rag' || raw.mode === 'hybrid'
      ? raw.mode
      : fallback.mode;

  const unit =
    raw.timeWindow?.unit === 'minute' ||
    raw.timeWindow?.unit === 'hour' ||
    raw.timeWindow?.unit === 'day'
      ? raw.timeWindow.unit
      : fallback.timeWindow.unit;
  const amount =
    typeof raw.timeWindow?.amount === 'number' && raw.timeWindow.amount > 0
      ? raw.timeWindow.amount
      : fallback.timeWindow.amount;
  const calendarDay =
    raw.timeWindow?.calendarDay ?? fallback.timeWindow.calendarDay;

  const inferred = inferHttpFromQuestion(question);
  const route =
    sanitizeRouteFilter(raw.filters?.route) ??
    fallback.filters.route ??
    inferred.route;
  const httpMethod =
    raw.filters?.httpMethod?.toUpperCase() ??
    fallback.filters.httpMethod ??
    inferred.httpMethod;

  const filters = {
    ...fallback.filters,
    ...raw.filters,
    route,
    httpMethod,
  };

  if (!isErrorQuestion(question) && filters.level === 'ERROR') {
    delete filters.level;
  }

  let aggregation: Aggregation = raw.aggregation ?? fallback.aggregation;
  if (
    aggregation !== 'count_failures' &&
    aggregation !== 'top_route_by_count' &&
    aggregation !== 'count_http_requests' &&
    aggregation !== 'none'
  ) {
    aggregation = fallback.aggregation;
  }

  if (
    httpMethod &&
    route &&
    aggregation === 'none' &&
    /houve|algum|alguma|quais|ocorreram|criad|nov[aoe]/i.test(question)
  ) {
    aggregation = 'count_http_requests';
  }

  const listLogs =
    raw.listLogs ??
    fallback.listLogs ??
    /houve|algum|alguma|quais|liste|mostre|ocorreram/i.test(question);

  return {
    mode,
    timeWindow: { amount, unit, calendarDay },
    filters,
    aggregation,
    listLogs,
    limit:
      typeof raw.limit === 'number' && raw.limit > 0
        ? Math.min(raw.limit, 50)
        : fallback.limit,
    ragQuery: raw.ragQuery ?? question,
  };
}

function sanitizeRouteFilter(route: string | undefined): string | undefined {
  if (!route) return undefined;
  const cleaned = route
    .replace(/^(GET|POST|PUT|PATCH|DELETE)\s*:\s*/i, '')
    .trim()
    .split('?')[0];
  if (!cleaned) return undefined;
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}
