/**
 * Provisionamento seguro do primeiro proprietário da plataforma.
 * Sem senhas embutidas no repositório, mesmo para instalação de desenvolvimento.
 */
export type BootstrapEnv = Record<string, string | undefined>;
export type BootstrapAdmin = {
  email: string;
  password: string;
  name: string;
  mustChange: 1;
};

/** Ausência de senha em produção impede o bootstrap (fail closed). */
export function resolveBootstrapAdmin(env: BootstrapEnv): BootstrapAdmin | null {
  const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? '';
  if (!email || !password) {
    if (env.NODE_ENV === 'production' && env.DEMO_MODE !== '1') {
      throw new Error('Bootstrap seguro: ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórios no primeiro acesso de produção');
    }
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Bootstrap seguro: ADMIN_EMAIL inválido');
  }
  if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)) {
    throw new Error('Bootstrap seguro: ADMIN_PASSWORD requer 12+ caracteres, letras maiúsculas/minúsculas e números');
  }
  return { email, password, name: env.ADMIN_NAME?.trim() || 'Proprietário', mustChange: 1 };
}

/** Fixtures comerciais somente em ambiente de DEMO ou opt-in explícito de desenvolvimento. */
export function shouldSeedSampleTenants(env: BootstrapEnv): boolean {
  return env.DEMO_MODE === '1' || (env.NODE_ENV !== 'production' && env.VIGIA_SEED_SAMPLE_TENANTS === '1');
}
