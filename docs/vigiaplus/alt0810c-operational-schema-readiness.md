# ALT-08.10C — pré-migração operacional segura no staging

**Data:** 2026-11-12. **Status:** inventário e plano, sem migração operacional executada.

## Evidência verificada

O Neon isolado (`still-heart-81001946`, branch `br-super-star-bbc317wq`, banco `vigia_alt086_staging_20261112`) apresenta **zero tabelas no schema `public`**. ALT-08.10B com Next.js real sobre fixture em namespace `alt0810_next_ci` foi GREEN (SHA `ef0730e086e6e5e8107f873bd151be9dd6b45b76`; CI 43237972979; manual 43239412881; rollback 0/0/0). Isto **não** certifica schema operacional.

## Risco de migração identificado na base

Inspeção dos arquivos:
- `lib/db/index.ts`: `getDb()` realiza `init()`, que invoca `ensureSchema()` antes da primeira consulta, executando sequência de DDL de `CREATE TABLE IF NOT EXISTS` e `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Também aciona `seedUsers`, `seedVigiaPlus`, catálogo inicial de planos e índices comerciais. Não é um mecanismo *somente leitura*.
- `scripts/migrate.ts`: migrações versionadas com checksum SHA-256, mas chama `getDb()` inicialmente e cria `schema_migrations`. Usar `npm run migrate:check` em banco remoto **também abre `getDb()` e pode disparar DDL/bootstrap previamente**, logo não é preflight de leitura segura.
- `lib/db/schema.ts`: contratos Drizzle de identidade, memberships, billing, observabilidade, crises e fontes; não é sinônimo de uma migração versionada integral.

**Decisão de segurança:** não executar `getDb()`, `npm run migrate`, `npm run migrate:check` nem inicializar o Next operacional apontado diretamente ao banco Neon staging enquanto o bootstrap implícito não estiver isolado e revisado. Essa precaução evita escrever em ambiente que ainda não recebeu snapshot/manifest de migração.

## Critérios para uma migração executável

1. Criar um **manifesto versionado do schema operacional**, somente com SQL revisado, checksums e dependências.
2. Registrar baseline prévio de `pg_namespace`, `pg_class`, `pg_policy`, `pg_roles`, `information_schema.role_table_grants`, constraints, índices e extensões; confirmar alvo com banco, branch, papel e assinatura de confirmação exclusiva.
3. Separar *migrador* do runtime de autenticação: somente credencial de DDL pode alterar objetos; sessões nunca usam role proprietária nem BYPASSRLS.
4. Desabilitar `ensureSchema`/seed implícito apenas por desenho aprovado e coberto por teste de produção/staging. Evitar alteração global ad hoc em `getDb()`.
5. Executar migração para staging em duas etapas: dry-run de diff/DDL e aplicação com checkpoint transacional e rollback por objeto, preservando grants/policies preexistentes.
6. Testar **rotas Next reais** com duas identidades, múltiplas memberships, revogação, tenant suspenso, assinatura vencida/carência, limites e UI owner/analyst/worker/webhook em identidades distintas.
7. Exigir CI e workflow staging GREEN no SHA exato, restauração do baseline e aprovação humana antes de qualquer instalação operacional.

## Estado de liberação

- ALT-08.10B: GREEN para rota Next sobre fixture em staging.
- ALT-08.10C: **BLOQUEADO pela ausência de schema operacional e pelo bootstrap automático atual**.
- Produção: **NO-GO**; PR DRAFT; sem merge, deploy ou migração operacional.


## ALT-08.10C.1 — preflight executável sem bootstrap

- `lib/db/staging-schema-preflight.ts` define o contrato do catálogo e valida **banco e role exatos**, reader sem SUPERUSER/BYPASSRLS e contagens coerentes. A presença de tabelas/ledger é apenas um sinal de inventário: **nunca declara readyForOperationalAuth=true**.
- `scripts/tests/alt0810c-neon-readonly-preflight.ts` usa exclusivamente `withNeonRlsPool` com a credencial **reader**, `BEGIN READ ONLY`, consultas agregadas a `pg_namespace`, `pg_class`, `pg_policies`, `pg_constraint`, `information_schema.role_table_grants` e `ROLLBACK`. Não importa ou chama `getDb()`, `ensureSchema()` ou `scripts/migrate.ts`.
- `tests/todo-alt0810c-staging-preflight.test.ts` cobre alvos inválidos, role owner, BYPASS, índices e contagens inconsistentes, além de proibir ambiente de produção.
- Workflow **manual**, etapa `ALT-08.10C inventario read-only schema Neon staging sem bootstrap`, condicionado ao secret dedicado do reader. Exige `ALT0810C_PREFLIGHT_CONFIRM=READ_ONLY_NEON_STAGING` e `GITHUB_RUN_ID`; não possui credencial migradora nem qualquer SQL de DDL.
- Essa etapa **não é migração**: o `getDb()` operacional e o comando legado `migrate:check` continuam com bootstrap implícito e seguem proibidos como preflight remoto. A separação do migrador e um manifesto integral com rollback permanecem abertas.

Critério de aceite: CI do HEAD exato e execução manual real exibindo `ALT0810C: NO DDL, NO BOOTSTRAP, NO DB WRITES VERIFIED` e contagens verificadas, sem confundir inventário com homologação operacional.


## ALT-08.10C.2 — manifesto SQL versionado e separação do check

**Artefatos implementados**:
- `migrations/manifest.json`: inventário versionado de 4 arquivos SQL legados com seus identificadores Git blob SHA-1. Declara explicitamente `authoritativeOperationalSchema=false` e `bootstrapSeparated=false`: **não** certifica DDL completo.
- `lib/db/migration-manifest.ts`: valida lista exata de arquivos, hashes Git blob, nomes e unicidade; calcula SHA-256 para conferência sem conexão ao banco.
- `scripts/schema-manifest-check.ts`: somente leitura de arquivos locais e checksum; nenhuma conexão, `getDb()`, DDL ou seeds.
- `tests/todo-alt0810c-migration-manifest.test.ts`: adulteração, duplicações, divergência de arquivos e alegação falsa de readiness.
- CI principal agora executa etapa `ALT-08.10C manifesto offline de migrações (sem banco)` após TypeScript.
- `scripts/migrate.ts --check` deixou de chamar `getDb()`: valida primeiro o manifesto e executa consultas diretas de `schema_migrations` em `BEGIN READ ONLY`, com `ROLLBACK`, sem bootstrap/seeds. Requer `DATABASE_URL` existente; sem URL falha fechado, sem criar banco PGlite local. Ainda não substitui o preflight de staging por role fixa e portanto **não deve ser usado para certificar o staging**.

**Limitação crítica:** `npm run migrate` (sem `--check`) ainda usa o fluxo legado `getDb()`, `ensureSchema()` e seeds por compatibilidade; NÃO EXECUTAR em staging operacional nem produção sem revisão e autorização. Inventário versionado desses quatro arquivos **não contém** as ~62 criações e ~78 alterações implementadas pelo bootstrap em `lib/db/index.ts`. A migração completa, plano de rollback e papéis operacionais permanecem pendentes.
