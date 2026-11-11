/**
 * Regras do modo público de demonstração.
 *
 * Não confiar em cabeçalhos originados do cliente: o proxy sobrescreve
 * x-vigia-request-method com o método HTTP recebido antes de encaminhar
 * a requisição ao servidor. A ausência do valor no servidor nega acesso.
 */
export const DEMO_READ_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

export function isDemoReadMethod(method: string | null | undefined): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function isDemoWriteMethod(method: string | null | undefined): boolean {
  return !isDemoReadMethod(method);
}

/** Cron e webhooks são entradas operacionais, inclusive quando expõem GET. */
export function isDemoSafeRequest(method: string | null | undefined, pathname: string): boolean {
  if (!isDemoReadMethod(method)) return false;
  return !(
    pathname === '/api/cron' || pathname.startsWith('/api/cron/') ||
    pathname === '/api/webhook' || pathname.startsWith('/api/webhook/') ||
    pathname === '/api/webhooks' || pathname.startsWith('/api/webhooks/')
  );
}
