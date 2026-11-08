// Erros tipados do VigiaPlus. O `code` e estavel e usado nos testes adversariais.
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthenticated(msg = 'Nao autenticado') { return new AppError('UNAUTHENTICATED', 401, msg); }
  static forbidden(msg = 'Acesso negado') { return new AppError('FORBIDDEN', 403, msg); }
  static notFound(msg = 'Nao encontrado') { return new AppError('NOT_FOUND', 404, msg); }
  static badRequest(msg = 'Requisicao invalida') { return new AppError('BAD_REQUEST', 400, msg); }
  static feature(msg: string) { return new AppError('FEATURE_DISABLED', 403, msg); }
  static scope(msg: string) { return new AppError('TENANT_SCOPE_REQUIRED', 500, msg); }
  static quota(msg: string) { return new AppError('QUOTA_EXCEEDED', 429, msg); }
  static ssrf(msg: string) { return new AppError('UNSAFE_ENDPOINT', 400, msg); }
  static signature(msg = 'Assinatura invalida') { return new AppError('INVALID_SIGNATURE', 400, msg); }
}
