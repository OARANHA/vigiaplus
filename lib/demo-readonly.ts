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
