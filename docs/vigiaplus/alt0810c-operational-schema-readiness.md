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


## ALT-08.10C.3 — snapshot estático integral do bootstrap (2026-11-12)

- `schema/operational-bootstrap/00001_legacy_snapshot.sql`: **186 comandos SQL** extraídos em ordem da lista estática `DDL` em `lib/db/index.ts` (CREATE TABLE, ALTER TABLE, índices e uma atualização legada de `mentions.kind`). Este é um **snapshot versionado inerte**, fora da pasta `migrations/`; NÃO é executado por `npm run migrate`.
- `schema/operational-bootstrap/manifest.json`: fixa o SHA-1 Git blob do snapshot, a quantidade exata e os indicadores `bootstrapSeparated=false`, `operationalSchemaCertified=false`, `migrationRunnerActivated=false`.
- `lib/db/bootstrap-snapshot.ts`: extrai o array pelo compilador AST do TypeScript, **sem importar nem executar** `lib/db/index.ts`; rejeita SQL dinâmico e deriva um snapshot determinístico. Hash Git e texto exato do snapshot devem coincidir com o manifesto.
- `scripts/bootstrap-snapshot-check.ts`: verificação offline, sem banco ou rede. Testes adversariais em `tests/todo-alt0810c-bootstrap-snapshot.test.ts`.
- `scripts/tests/alt0810c-bootstrap-disposable.test.ts`: ensaio de aplicação dos 186 statements em **PGlite somente em memória**, seguido de `ROLLBACK` e verificação do catálogo restaurado a zero tabelas. CI executa o ensaio explicitamente.
- A aplicação **continua** usando o antigo `ensureSchema`/seeds em `getDb()`; não se alterou o fluxo produtivo. O snapshot sozinho não é um plano de rollback de ambientes com dados ou grants anteriores.

**Critérios de aceite deste incremento:** no SHA exato, CI completo GREEN, passo de comparação de snapshot GREEN e ensaio descartável de aplicação+rollback GREEN. Não promover o schema operacional de staging nem produção antes de rever dependências, seeds, roles e política de migração existente. ALT-08.10C global **PENDENTE**.


## ALT-08.10C.4 — bootstrap separado por modo operacional (2026-11-12)

**Implementação inicial, não homologação do schema integral.**

- `lib/db/bootstrap-mode.ts`: `resolveDbBootstrapMode()` preserva `legacy-bootstrap` como padrão, inclusive em produção. Apenas `preprovisioned-staging-ci` permite ignorar o bootstrap e é protegido por `CI=true`, `GITHUB_ACTIONS=true`, `NODE_ENV!=production`, `DEMO_MODE!=1`, `VIGIA_RLS_MODE=ci-experimental`, `GITHUB_RUN_ID` numérico, confirmação `READ_EXISTING_SCHEMA_ONLY`, ausência de `RLS_DATABASE_URL` e URL `DATABASE_URL` fixada ao banco `vigia_alt086_staging_20261112` / usuário PostgreSQL `vigia_alt087_staging_reader` em host Neon.
- `lib/db/index.ts`: resolve o modo **antes** da abertura de conexão; caso modo pré-provisionado validado, verifica via `to_regclass` a existência de `users`, `memberships`, `tenants`, `subscriptions`, `plans`, `plan_features` e `tenant_features`. Se ausentes, lança `PREPROVISIONED_STAGING_SCHEMA_NOT_READY` sem executar `ensureSchema()`, seeds, catálogo ou índices. O caminho padrão legado continua com comportamento anterior.
- `tests/todo-alt0810c-bootstrap-mode.test.ts` valida ausência de opt-in, defaults, role não privilegiada, banco exato e recusas em produção ou ambiente inválido.
- Este modo **não** é um migrador. Não altera `scripts/migrate.ts` nem autoriza execução de DDL, não afirma que a role reader possui todos os grants necessários às rotas. Staging tem `public` vazio na última inspeção; portanto, a ativação deverá falhar fechado.
- Ainda faltam política formal de bootstrap de produção, migrações versionadas operacionais, snapshot/restore ACL/policies e autenticação de serviços em roles dedicadas.

**Gate:** CI no SHA exato com teste unitário e E2E; só futuramente usar `preprovisioned-staging-ci` após migrador controlado provisionar o schema real em ambiente autorizado. Nenhum merge/deploy.

## ALT-08.10C.4 — ensaio de baseline preexistente (candidato, sem migração)

- `scripts/tests/alt0810c-preexisting-rollback.test.ts` exercita o snapshot legado inerte em PGlite **em memória** com tabela, linha, role NOLOGIN, GRANT de colunas e policy FORCE RLS previamente existentes.
- Captura baseline ordenado de tabelas, role, definição de policy, ACL, flags RLS e contagem de dados; aplica os 186 comandos dentro de `BEGIN`, executa `ROLLBACK` e exige igualdade exata ao baseline.
- Executa uma segunda transação interrompida após metade dos comandos e confirma novamente baseline intacto.
- Ensaio incorporado ao job de build do CI, sem `DATABASE_URL`, `RLS_DATABASE_URL` ou `getDb()`. **Este teste não prova recuperação de falhas fora de transação, dependências entre migrações, grants de todos os objetos, migração em Neon nem rollback depois de COMMIT.**
- CI e execução dos testes precisam ser confirmados no SHA exato; o runtime padrão ainda usa bootstrap legado, o snapshot permanece fora de `migrations/`. Produção NO-GO.

**Próximo gate:** grafo de dependências e classificação dos comandos (DDL/DML), papéis SQL distintos, snapshot completo de estado real e restauração reversível por objeto em PostgreSQL 16 descartável antes de qualquer DDL de staging.

## ALT-08.10C.5 — inventário de dependências e papéis (candidato)

O analisador `lib/db/bootstrap-dependencies.ts` classifica **somente** os comandos congelados em quatro categorias: `CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `CREATE INDEX` (incluindo `USING gin`) e `UPDATE`. Extrai tabelas-alvo, dependências de `REFERENCES`, dependência dos índices/ALTER/UPDATE e hash SHA-256 por comando. Rejeita instrução desconhecida, referência a tabela ainda inexistente e tabela duplicada. **Não é parser SQL geral nem autorizador de migrações.** O resultado sempre traz `readyForMigration=false`.

`tests/todo-alt0810c-bootstrap-dependencies.test.ts` exige a classificação integral dos 186 comandos (62 CREATE TABLE, 78 ALTER TABLE, 45 CREATE INDEX, 1 UPDATE) e casos adversariais. A execução foi adicionada ao CI; requer verificação do HEAD exato.

### Contrato de papéis — proposta NÃO provisionada

| Papel lógico | Acesso previsto | Proibições |
| --- | --- | --- |
| Migrador DDL (CI/staging dedicado) | DDL versionada e reversível somente no banco isolado, credencial separada e aprovação explícita | Runtime de usuário, transporte de notificações, credenciais produtivas |
| Runtime de aplicação | DML estritamente necessária às rotas autenticadas, com políticas RLS e transações autorizadas | CREATE/ALTER/DROP, ownership de tabelas, SUPERUSER/BYPASSRLS |
| Reader de verificação | SELECT somente colunas permitidas, catalog/ACL preflight em transação READ ONLY | Escrita, DDL, leitura de PII, SET ROLE para privilegiados |
| Worker/webhook | Roles específicas com comandos e escopo explicitamente auditados | Herdar privilégios de owner/migrador ou aceitar tenant enviado pelo cliente |

O nome do reader existente `vigia_alt087_staging_reader` **não autoriza** reutilizar a mesma credencial para migrar, autenticar clientes ou executar workers. Papéis internos positivos exigem E2E separados.

### Pendente para a ALT-08.10C.5

1. Catalogar também dependências indiretas (foreign keys, funções, triggers, extensões, grants e constraints existentes), se houver, com parser/inspeção PostgreSQL completa e revisão humana.
2. Capturar o baseline de `pg_roles`, ownership, ACLs de coluna/tabela/schema, policies, `relrowsecurity`/`relforcerowsecurity`, índices, constraints, dados e `schema_migrations` **no alvo de ensaio**.
3. Testar um plano de `UP/DOWN` por objeto em PostgreSQL 16 descartável, inclusive objetos pré-existentes, conflitos de nomes, falha pós-commit e recovery; preservar integralmente baseline.
4. Somente depois, sob autorização explícita, preparar homologação de migração no staging isolado.

**Estado:** inventário técnico inerte, sem scripts de provisioning ou SQL de migração ativada. Nenhuma alteração em produção; NO-GO.

## ALT-08.10C.6 — snapshot de catálogo e rollback PostgreSQL 16 (candidato)

**Escopo: somente o serviço PostgreSQL 16 efêmero do GitHub Actions**. Não usa `getDb()`, Neon, banco de staging nem credenciais remotas. O script exige conjuntamente `CI=true`, `GITHUB_ACTIONS=true`, `ALT0810C6_EPHEMERAL=1`, `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGDATABASE=vigia_alt081_ci`, `PGUSER=vigia_ci`, senha descartável conhecida e `DATABASE_URL`/`RLS_DATABASE_URL` vazias.

- `lib/db/disposable-catalog-snapshot.ts` usa somente SELECT de `pg_catalog` e `information_schema` e coleta, com ordenação estável, schemas e ACL, relações/owners/ACL/flags RLS, colunas/ACL/defaults, constraints, índices, policies, grants por tabela/coluna/schema, atributos de roles e memberships. Escopo permitido: namespace e roles com prefixo `alt0810c6_`. É inventário de metadados **de ensaio**, não backup de banco real.
- `scripts/tests/alt0810c6-postgres-catalog-rollback.test.ts` cria namespace exclusivo, tabela com registro, constraint, índice, owner distinto, GRANT por coluna, policy SELECT e FORCE RLS antes de capturar o baseline. Altera ownership, revoga grants, remove policy/índice, altera coluna e dados, cria tabela extra e injeta erro SQL dentro de `BEGIN`. Executa `ROLLBACK`, exige igualdade exata do snapshot e da linha original. Também confirma uma reversão explícita sem erro.
- Preflight recusa namespace ou roles preexistentes. Cleanup é limitado aos objetos criados pelo próprio ensaio e não usa `CASCADE`. O teste foi conectado ao job `postgres-disposable` do CI.
- **Status da execução:** candidato até confirmação do CI no SHA exato. O teste prova somente reversibilidade transacional dos objetos sintéticos sob PostgreSQL 16. **Não prova** restauração após `COMMIT`, rollback de dados preexistentes no schema operacional, catálogo real completo, backups externos, recuperação de crash ou segurança de migração Neon.

Próximo gate: confirmar CI GREEN incluindo teste de regressão PostgreSQL; ensaiar diferença entre catálogo preexistente e migração real com restauração por objeto *após COMMIT*, somente em banco descartável, com papéis migrator/runtime/reader distintos. Produção continua **NO-GO**.

## ALT-08.10C.7 — restauração após COMMIT, com roles distintas (candidato)

- `scripts/tests/alt0810c7-postcommit-restore.test.ts`: ensaio somente no PostgreSQL 16 efêmero do GitHub Actions (`vigia_alt081_ci` / `127.0.0.1:5432`), explicitamente bloqueado quando há `DATABASE_URL`, `RLS_DATABASE_URL` ou produção. Não importa `getDb()` nem o executor de migrações.
- Preflight recusa namespace e roles preexistentes. Cria fixture em `alt0810c6_postcommit`, com três roles NOLOGIN distintas (`alt0810c6_migrator`, `alt0810c6_runtime`, `alt0810c6_reader_c7`), tabela, dados dos tenants 771/882, constraint, índice, owner migrator, ACL por coluna e policies RLS específicas.
- Prova negativa: reader não acessa `private_note` nem altera dados; runtime somente atualiza a linha permitida por RLS e essa alteração é revertida.
- Prova de recuperação: captura catálogo e dados via `snapshotDisposableCatalog`; executa alterações em ownership, policies, RLS, ACL, índice, coluna e dados e efetua **COMMIT**; verifica diferença frente ao baseline; executa compensação explícita em **outra transação** com novo COMMIT; exige igualdade integral de catálogo e linhas originais.
- Etapa incluída no job `postgres-disposable` de CI. **Somente marcar GREEN após verificar conclusão do SHA exato.**

**Limites:** teste de cenário sintético conhecido, não gerador automático de rollback nem backup. Não cobre falhas de energia/crash, mudanças externas concorrentes, dados operacionais reais, extensão do esquema completo, RESTORE físico ou credenciais migradoras Neon. Migração operacional e produção permanecem NO-GO; nenhuma alteração em staging foi autorizada ou realizada.

## ALT-08.10C.8 — ensaio integral do bootstrap em PostgreSQL 16 descartável

Candidato implementado em `scripts/tests/alt0810c8-postgres-full-bootstrap.test.ts`, com etapa própria no job `postgres-disposable` do GitHub Actions. O teste **não** aplica migrações no Neon nem habilita o snapshot como migrador da aplicação.

1. Valida manifesto e hash do snapshot antes de conectar; confere os 186 comandos e o inventário de dependências.
2. Usa apenas PostgreSQL 16 local do runner (`127.0.0.1:5432`, DB `vigia_alt081_ci`), com guarda explícito de CI, senha descartável e ausência de `DATABASE_URL`/`RLS_DATABASE_URL`.
3. Recusa colisões de namespace/role; cria `alt0810c6_fullschema` isolado com tabela, linha, grants por coluna, role e policy FORCE RLS **preexistentes**.
4. Captura baseline de catálogo e dados, entra em transação `BEGIN` com `SET LOCAL search_path`, aplica na ordem os **186** comandos estáticos, verifica **62 tabelas operacionais**, mais o sentinela, e presença de `users`, `memberships`, `tenants`, `subscriptions`, `plans`, `plan_features`, `tenant_features`.
5. Verifica que o DDL legado não configura RLS operacional integral e **não** representa prontidão de autenticação/entitlements. Faz `ROLLBACK` e exige recuperação exata do baseline de catálogo, ACL/policy e dados.

**Condição de aceite:** cinco jobs GREEN no SHA exato, inclusive passo ALT-08.10C.8. Sem GREEN no novo HEAD, tratar apenas como implementação candidata.

**Limites:** ensaio PostgreSQL local não comprova bootstrap seguro em base com schema operacional existente, grants/propriedade em Neon, seeds, contrato Drizzle completo, migrações de billing nem restauração operacional após `COMMIT` dos 186 comandos. O futuro staging operacional exige plano versionado/diff, autorização humana e credencial migradora separada. **Produção NO-GO.**

## ALT-08.10C.9 — gate de prontidão operacional fail-closed

- `lib/db/operational-readiness.ts` interpreta somente snapshots do catálogo PostgreSQL efêmero em namespaces `alt0810c6_*`. Relata ausência de `users`, `memberships`, `tenants`, `subscriptions`, `plans`, `plan_features` e `tenant_features`; falta de FORCE RLS; falta de políticas com predicado; ausência de `schema_migrations`.
- Mesmo quando **todas** as evidências do catálogo aparentam existir, `readyForOperationalAuth=false`, `migrationAllowed=false`, `productionAllowed=false` obrigatórios. Catálogo e SQL estáticos não certificam testes HTTP, revogação, isolamento, roles, seeds, grants ou compatibilidade de runtime.
- O ensaio PostgreSQL 16 de 186 comandos (`alt0810c8-postgres-full-bootstrap.test.ts`) agora chama este gate *antes do ROLLBACK*, exige sete tabelas centrais sem FORCE RLS, ausência do ledger e proibição inequívoca de migração/produção. Nenhum objeto no Neon.
- `tests/todo-alt0810c-operational-readiness.test.ts` cobre catálogo vazio, tabelas sem RLS/policies, catálogo aparentemente completo que continua NÃO autorizado, namespace estranho e dados inválidos.

**Aceite:** CI dos 5 jobs GREEN no SHA exato incluindo testes unitários e PostgreSQL. **Próximo gate:** plano de migrações operacionais versionadas e provisionamento de roles/ACL/RLS no PostgreSQL 16 efêmero; staging somente após autorização humana e relatório de diff/backup. Produção NO-GO.

## ALT-08.10C.10 — proposta versionada de ACL e RLS com ensaio em PostgreSQL 16

A proposta **inerte** `lib/db/alt0810c10-roles-wave.ts` identifica a versão `alt0810c10-disposable-roles-v1` e disponibiliza sequências explícitas `ALT0810C10_UP_SQL` e `ALT0810C10_DOWN_SQL`, sem integração à pasta `migrations/` nem ao runtime. O atributo `operationalMigrationAuthorized=false` é obrigatório. Os nomes de schema/roles são fixos, reservados ao teste `alt0810c6_roles_wave`, e não são configuráveis por variáveis externas.

O teste `scripts/tests/alt0810c10-postgres-roles-wave.test.ts`, integrado ao job PostgreSQL 16 descartável, exige GitHub Actions CI, endpoint `127.0.0.1:5432`, banco `vigia_alt081_ci`, credenciais descartáveis conhecidas e ausência de `DATABASE_URL` ou `RLS_DATABASE_URL`. Recusa colisões de namespace e roles. Cria dados sintéticos de dois tenants (101 e 202) e quatro roles NOLOGIN sem SUPERUSER ou BYPASSRLS: migrador, runtime A, runtime B e leitor. Aplica a proposta em transação com COMMIT e verifica:

- Runtime A/B lê apenas o próprio tenant; UPDATE cross-tenant retorna zero; SELECT de dado sensível, INSERT e DDL são negados.
- Reader tem SELECT de colunas não sensíveis, sem UPDATE e sem acesso ao campo privado.
- Migrador é owner da tabela sintética e consegue fazer DDL permitido; o runtime não recebe ownership nem CREATE no schema.
- A versão de compensação DOWN roda em outra transação com COMMIT e restaura exatamente o baseline de catálogo, RLS, policies, ACLs, ownership e linhas de dados.

**Status: somente candidato até CI GREEN no HEAD exato.** Esse ensaio é uma prova isolada de privilégios PostgreSQL e reversibilidade de uma fixture, não a migração das 62 tabelas operacionais, não representa autenticação HTTP real em Neon e não autoriza provisionamento de roles em staging. Próximo gate exige plano completo por objeto, catálogo/Drizzle compatível, roles operacionais e E2E autorizado em staging com backups. Produção NO-GO.
