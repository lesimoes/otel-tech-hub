export interface InferredHttpTarget {
  httpMethod?: string;
  route?: string;
}

export function inferHttpFromQuestion(question: string): InferredHttpTarget {
  const q = question.toLowerCase();

  const routeMatch = question.match(/(\/[\w/:.-]+)/);
  if (routeMatch) {
    const route = routeMatch[1].split('?')[0];
    const methodMatch = q.match(/\b(get|post|put|patch|delete)\b/);
    return {
      route: route.startsWith('/') ? route : `/${route}`,
      httpMethod: methodMatch?.[1].toUpperCase(),
    };
  }

  if (/transa[cç][õo]es?|transaction/i.test(q)) {
    const method =
      /criad|nov[aoe]|criou|registrad|inserid|adicionad/i.test(q)
        ? 'POST'
        : /atualiz|edit|alter|modific/i.test(q)
          ? 'PUT'
          : /delet|remov|exclu/i.test(q)
            ? 'DELETE'
            : undefined;
    return { httpMethod: method, route: '/transactions' };
  }

  if (/usu[aá]rios?|users?/i.test(q)) {
    const method = /criad|nov[aoe]|registrad/i.test(q) ? 'POST' : undefined;
    return { httpMethod: method, route: '/users' };
  }

  return {};
}

export function isErrorQuestion(question: string): boolean {
  return /erros?|falhas?|failures?|5\d{2}|problema|exception|crash/i.test(
    question,
  );
}
