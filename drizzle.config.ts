import type { Config } from 'drizzle-kit';

// As migracoes versionadas vivem em migrations/ e sao aplicadas por
// `npm run migrate`. O DDL aditivo em lib/db/index.ts continua sendo o
// bootstrap de desenvolvimento (PGlite); ambos sao idempotentes e convergem
// para o mesmo estado. Nunca editar uma migracao ja aplicada: crie a proxima.
export default {
  schema: './lib/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/vigiaplus',
  },
  strict: true,
  verbose: false,
} satisfies Config;
