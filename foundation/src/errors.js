// Erros tipados. O código é estável e seguro de expor ao cliente; a mensagem não.
export class AppError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export const err = {
  unauthenticated: (m = 'Sessão inexistente, expirada ou revogada') =>
    new AppError('UNAUTHENTICATED', 401, m),
  forbidden: (m = 'Acesso negado') =>
    new AppError('FORBIDDEN', 403, m),
  notFound: (m = 'Recurso não encontrado') =>
    new AppError('NOT_FOUND', 404, m),
  badRequest: (m = 'Requisição inválida') =>
    new AppError('BAD_REQUEST', 400, m),
  scope: (m = 'Consulta sem escopo de tenant') =>
    new AppError('TENANT_SCOPE_REQUIRED', 500, m),
  feature: (m = 'Recurso não habilitado para este contrato') =>
    new AppError('FEATURE_DISABLED', 403, m),
  quota: (m = 'Cota de IA excedida') =>
    new AppError('QUOTA_EXCEEDED', 429, m),
  ssrf: (m = 'Endpoint de provedor não permitido') =>
    new AppError('UNSAFE_ENDPOINT', 400, m),
  signature: (m = 'Assinatura de webhook inválida') =>
    new AppError('INVALID_SIGNATURE', 403, m),
};
