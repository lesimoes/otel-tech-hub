import type { QueryPlan } from './query-plan.types';
import {
  inferHttpFromQuestion,
  isErrorQuestion,
} from './question-routes.util';
import { defaultTimeWindow } from './time-window.util';

export function defaultPlan(question: string): QueryPlan {
  const q = question.toLowerCase();
  const timeWindow = defaultTimeWindow(question);
  const isFailure = isErrorQuestion(question);
  const isCount = /quantas?|total|n[uú]mero\s+de|how\s+many/i.test(q);
  const isList =
    /quais|liste|listar|mostre|ocorreram|quais\s+foram|algum|alguma|houve/i.test(
      q,
    );
  const isTopRoute = /rota|route/i.test(q) && /mais|top|principal|pior/i.test(q);
  const inferred = inferHttpFromQuestion(question);

  if (isTopRoute) {
    return {
      mode: 'aggregate',
      timeWindow,
      filters: { level: 'ERROR' },
      aggregation: 'top_route_by_count',
      listLogs: false,
      limit: 5,
    };
  }

  if (inferred.route && inferred.httpMethod && (isCount || isList)) {
    return {
      mode: 'hybrid',
      timeWindow,
      filters: {
        httpMethod: inferred.httpMethod,
        route: inferred.route,
      },
      aggregation: 'count_http_requests',
      listLogs: true,
      limit: 30,
      ragQuery: question,
    };
  }

  if (isCount && !isList) {
    return {
      mode: 'aggregate',
      timeWindow,
      filters: isFailure ? { level: 'ERROR' } : {},
      aggregation: isFailure ? 'count_failures' : 'none',
      listLogs: false,
      limit: 10,
    };
  }

  if (isFailure && isList) {
    return {
      mode: 'hybrid',
      timeWindow,
      filters: { level: 'ERROR' },
      aggregation: 'count_failures',
      listLogs: true,
      limit: 30,
      ragQuery: question,
    };
  }

  if (isFailure) {
    return {
      mode: 'hybrid',
      timeWindow,
      filters: { level: 'ERROR' },
      aggregation: 'count_failures',
      listLogs: true,
      limit: 30,
      ragQuery: question,
    };
  }

  if (inferred.route) {
    return {
      mode: 'hybrid',
      timeWindow,
      filters: {
        httpMethod: inferred.httpMethod,
        route: inferred.route,
      },
      aggregation: inferred.httpMethod ? 'count_http_requests' : 'none',
      listLogs: true,
      limit: 30,
      ragQuery: question,
    };
  }

  return {
    mode: 'hybrid',
    timeWindow,
    filters: {},
    aggregation: 'none',
    listLogs: isList,
    limit: 30,
    ragQuery: question,
  };
}
