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

## ALT-08.10C.11 — manifesto de evidência, dependências e preparação de backup (offline)

**Status: candidato, não aplicável.** Um plano de migração operacional revisado deve separar (i) análise do snapshot, (ii) attestation do destino, (iii) backups comprovados, (iv) migração com papel próprio, (v) compensação e restore verificável. **Nenhum desses passos é autorizado somente pelo CI.**

Artefatos:
- `lib/db/operational-migration-evidence.ts`: gera plano determinístico de **186 passos** (ordinais, classes DDL/DML, SHA-256 por comando, hash de conjunto, precedências entre tabelas e dependência da última alteração na tabela). Marca cada passo como `reversibleAutomatically=false`; `migrationAuthorized/stagingAuthorized/productionAuthorized=false` invariáveis. Modificações de dados ou estrutura de colunas exigem backup de dados; todas exigem backup do catálogo.
- `tests/todo-alt0810c-operational-evidence.test.ts`: recusa divergência, ordem adulterada, tentativa de alegar readiness e execução; verifica hashes, contagem, determinismo e dependências.
- `scripts/operational-evidence-check.ts`: relatório **somente offline**, sem conexão ao DB e sem `getDb()`. Valida o snapshot congelado e emite apenas hashes, contagens, bloqueios e pré-requisitos. Executado pelo CI `build`.

### Critérios para um futuro gate de backup e restore

1. **Identidade verificável do alvo**: banco, projeto, branch, host, role e versão PostgreSQL atestados fora do app; credencial migradora separada das credenciais do runtime/reader; nenhuma role aplicativa deve ter `BYPASSRLS`, `SUPERUSER`, ownership de objetos protegidos ou DDL arbitrária.
2. **Congelamento e diff**: conferir SHA exato da PR e do plano, migrations já aplicadas, SQL do catálogo do destino, constraints, extensões, índices, policies, grants de coluna e ownership. Exigir identificação de drift e de possíveis conflitos `IF NOT EXISTS`.
3. **Backup lógico**: realizar `pg_dump` no alvo autorizado com formato custom, incluir dados e schema, conferir exit code, tamanho, integridade do artefato e metadados auditáveis. Manter cópia independente do banco-alvo.
4. **Backup físico/PITR**: comprovar mecanismo do provedor, retenção e ponto restaurável antes de qualquer alteração; não presumir que o `pg_dump` atende a PITR.
5. **Restore obrigatório**: restaurar em **outro banco descartável**, conferir checksums/contagens por tabela, permissions/ownership/policies e executar E2E de autenticação, revogação e tenants A/B antes de alegar reversibilidade real.
6. **Plano UP/DOWN revisado**: para UPDATE legado, backfill, alterações de tipo, DROP, índices e constraint com possíveis dependências, descrever compensação e perda potencial de informação. Proibir runner legado `getDb()`/seeds no staging enquanto não houver separação certificada.
7. **Aprovação humana exclusiva**: nenhuma flag, CI GREEN ou manifesto permite criar roles ou aplicar DDL no Neon automaticamente. Toda operação de staging depende de autorização explícita, escopo e plano aprovado; produção exige gate separado.

### Não coberto

Este incremento **não cria backup**, **não testa restore**, **não valida o schema Drizzle inteiro**, **não ativa migrador** e **não aprova o estágio operacional**. Dependências extraídas do SQL textual são parciais: não representam grafo completo do catálogo existente, extensões, triggers, relações externas e constraints implícitas. Somente uma inspeção de catálogo do alvo autorizado poderá resolver isso. Produção: **NO-GO**.

## ALT-08.10C.12 — pg_dump/pg_restore real entre bancos efêmeros (candidato)

Teste adicionado: `scripts/tests/alt0810c12-pg-dump-restore.test.ts`, executado no job PostgreSQL 16 descartável via Docker oficial `postgres:16`. **Não usa** `DATABASE_URL`, `RLS_DATABASE_URL`, Neon, `getDb()` nem o migrador legado.

1. Guardas exigem GitHub Actions CI, runner Linux, banco `vigia_alt081_ci` em `127.0.0.1:5432`, role `vigia_ci`, senha de fixture descartável e flag `ALT0810C12_EPHEMERAL=1`. Namespace e roles com nomes exclusivos; preflight recusa colisões com objetos preexistentes.
2. Fixture inclui dois registros de tenants distintos e dados privados, owner separado, reader sem BYPASSRLS/SUPERUSER, GRANT em colunas, schema ACL, policy SELECT, FORCE RLS, índice e CHECK/PK.
3. `pg_dump --format=custom --schema=alt0810c6_backup_c12` produz arquivo isolado no runner; verifica cabeçalho PGDMP, tamanho, SHA-256 e lista de objetos `pg_restore --list`.
4. Cria um **outro database descartável** `vigia_alt0810c12_restored_ci`, na mesma instância PostgreSQL16 efêmera. Restaura com `pg_restore --single-transaction --exit-on-error` mantendo owner e ACL originais, sem `--no-owner` e sem `--no-acl`.
5. Compara `snapshotDisposableCatalog` de fonte/destino e linhas originais; verifica owner, FORCE RLS e policy preservados. Remove o banco restaurado, tabela/namespace e roles de fixture ao final.

**Critério de aceite**: job completo no CI GREEN no SHA exato, e execução da nova etapa sem skips/falhas. A certificação de backup vale **apenas para a fixture sintética**. NÃO é backup físico, PITR, restore de schema operacional real, prova de interoperabilidade entre instâncias ou segurança de migração Neon. O backup é temporário e destruído ao final. **Staging e produção permanecem NO-GO.**

## ALT-08.10C.13 — restore entre clusters independentes e drift negativo (candidato)

- `scripts/tests/alt0810c13-pg-cross-instance-restore.test.ts` opera somente dentro de GitHub Actions com `CI=true`, flag `ALT0810C13_EPHEMERAL=1`, endpoint fonte fixo `127.0.0.1:5432/vigia_alt081_ci`, endpoint destino fixo `127.0.0.1:5433/vigia_alt0810c13_restore_ci`, senha efêmera, sem `DATABASE_URL` ou `RLS_DATABASE_URL`.
- O job `postgres-disposable` passou a provisionar **dois serviços PostgreSQL 16**, com volumes e clusters independentes, e testes que comparam o identificador físico `pg_control_system().system_identifier` antes de operar.
- A fixture sintética inclui dois tenants e registros confidenciais, duas roles sem BYPASSRLS, schema/table owner, ACL por coluna, política SELECT, FORCE RLS, índices e CHECK/PK. O teste gera `pg_dump -Fc` no cluster fonte e executa `pg_restore --single-transaction --exit-on-error` no cluster destino, sem omitir ACL nem ownership.
- Compara snapshots de catálogo, ownership, permissões, policies, RLS, constraints/índices e dados entre os clusters. Injeta drift em RLS e registro no cluster destino, **exige falha de igualdade**, corrige a fixture e exige recuperação do baseline. SHA-256 do arquivo é calculado e registrado em log.
- **Aceite:** CI do HEAD exato GREEN com todos os jobs, especialmente esta nova etapa. A criação dos serviços no mesmo runner não equivale a isolamento de infraestrutura física, nem comprova backup remoto, PITR, restore de todos os objetos operacionais, autenticação HTTP real no Neon ou segurança de migração de produção.

O teste é **candidato até execução**; banco externo, staging e produção não são utilizados. PR #36 continua DRAFT; produção **NO-GO**.

## ALT-08.10C.14 — auditoria estática ORM / bootstrap / RLS (candidato)

`lib/db/operational-compatibility-audit.ts` usa AST TypeScript, sem executar `schema.ts`, para inventariar nomes de tabelas `pgTable()` e compará-los às 62 criações congeladas no bootstrap. Cruza nomes com instruções ENABLE ROW LEVEL SECURITY e CREATE POLICY contidas em `migrations/00002_rls.sql`.

O relatório offline identifica tabelas somente no Drizzle, somente no bootstrap, tabelas Drizzle sem par ENABLE RLS/policy no arquivo legado, policies que apontam a tabelas não declaradas e detecção textual de `current_setting('app.tenant_id', true) IS NULL` como possível risco de acesso sem contexto. Em todos os casos `readyForMigration=false`, `readyForOperationalAuth=false` e `productionAuthorized=false`.

Os achados são **sinais estáticos**, não execução de políticas, análise completa de colunas, migração funcional nem confirmação de vulnerabilidade em runtime. A inspeção CI `scripts/operational-compatibility-check.ts` só lê arquivos; testes adversariais em `tests/todo-alt0810c-operational-compatibility.test.ts`. A aprovação depende do CI GREEN no SHA exato. Próximo gate técnico: comparar colunas, tipos, defaults e constraints do contrato Drizzle ao catálogo real criado em PostgreSQL descartável, e revisar policies legadas com contexto ausente. Neon/staging e produção permanecem NO-GO.

## ALT-08.10C.15 — diff de colunas Drizzle versus PostgreSQL16 descartável (candidato)

- `lib/db/operational-column-compatibility.ts` compara os contratos por tabela/coluna: faltas, colunas extras, tipos SQL e `NOT NULL`, calculando hash SHA-256 e flags `schemaCertified=false`, `migrationAuthorized=false`, `productionAuthorized=false`. Não cria nem aplica SQL.
- O ensaio `scripts/tests/alt0810c8-postgres-full-bootstrap.test.ts` agora, antes do rollback dos 186 comandos, obtém metadados do catálogo `pg_attribute` e os contratos de coluna via `getTableColumns` do `lib/db/schema.ts` (módulo declarativo, **sem** `getDb`). Imprime contagens e uma amostra dos gaps, sem tratar incompatibilidades legadas como aprovação para DDL automático.
- `tests/todo-alt0810c-column-compatibility.test.ts` cobre tipos, nulabilidade, campos ausentes/extras, entradas duplicadas e determinismo. Comparação com dados reais limita-se ao Postgres 16 do job descartável.
- O comparador é conservador e **não cobre** defaults, precision, constraints compostas, índices, arrays, enums, sequência SERIAL/identity, todas as nuances de `format_type`, policies e tabela de migrações. Diferenças detectadas exigem revisão técnica; igualdade de colunas não equivale à homologação operacional.
- Sem acesso ao Neon e sem habilitar migrador; critério de aceite é CI GREEN do SHA exato e confirmação do passo PostgreSQL.

Próximo gate: análise detalhada de defaults, PK/FK, índices e policy coverage com catálogo de PostgreSQL descartável, seguida de plano versionado aprovado. Produção NO-GO.

## ALT-08.10C.16 — auditoria estrutural de defaults, índices e constraints (candidato)

- `lib/db/operational-structural-audit.ts` produz resumo determinístico com SHA-256, contagens de defaults, PK, FK, UNIQUE, CHECK, índices nomeados no bootstrap e referências externas declaradas. Detecta índice explicitamente declarado ausente no catálogo e contagem insuficiente de FKs.
- O ensaio real `scripts/tests/alt0810c8-postgres-full-bootstrap.test.ts` passa a consultar `pg_index`, `pg_constraint` e `pg_attrdef` durante o `BEGIN` dos 186 comandos. Exige os 45 índices nomeados, referências de FK presentes, relatório com NO-GO e executa `ROLLBACK` com comparação do baseline preexistente.
- `tests/todo-alt0810c-structural-audit.test.ts` exercita cenários de ausência de índice/FK, catálogo inválido e duplicações.
- **Limitações:** o contador de FKs não certifica correspondência coluna-a-coluna, ações `ON DELETE`, compatibilidade de defaults Drizzle, índices implícitos/únicos ou SQL de políticas. É somente o ensaio do bootstrap congelado em PostgreSQL 16 descartável; não equivale a migração segura sobre DB já existente.
- Aceite condicionado ao CI GREEN do HEAD exato. Nenhuma execução em Neon/staging/produção. PR DRAFT, produção NO-GO.

## ALT-08.10C.17 — evidências de defaults e topologia completa das FKs (candidato)

- `lib/db/operational-default-fk-audit.ts` compara a presença de defaults esperados (`hasDefault` das colunas Drizzle) ao catálogo `pg_attrdef` no PostgreSQL16 descartável. Relata defaults ausentes, extras e colunas não modeladas; preserva as expressões de defaults do catálogo para auditoria. **Não** equivale a afirmar igualdade semântica das expressões.
- Consulta real `pg_constraint` com `conkey`/`confkey` e `pg_attribute` para registrar por FK a tabela origem/destino, **colunas ordenadas**, ações `ON UPDATE` e `ON DELETE`, flag `convalidated`. Recusa FKs quebradas, não validadas e ações desconhecidas no cenário efêmero.
- Integrado ao ensaio de aplicação dos 186 comandos SQL em transação no PostgreSQL16, antes do `ROLLBACK`. Relatório com hash SHA-256 e amostras, sem habilitar migração.
- `tests/todo-alt0810c-default-fk-audit.test.ts` cobre ausência/extra de defaults, topologia de FK inválida, constraint não validada, ações desconhecidas e entradas duplicadas.

**Limitações:** defaults dinâmicos, `onUpdateFn`, `SERIAL`, `generated` e expressões SQL ainda exigem inspeção semântica; relatório não correlaciona todas as FKs com referências esperadas do Drizzle e não certifica segurança de políticas RLS no Neon. CI GREEN no SHA exato é necessário para considerar este gate concluído. PR DRAFT e produção NO-GO.

## ALT-08.10C.17 — correção de decoding de nomes de coluna no PostgreSQL

O CI #400, SHA `174633f97766eb41146feadeebf19d1c57935b52`, falhou somente na etapa `ALT-08.10C.8 186 statements ... rollback` do job PostgreSQL16. As asserções de 591 colunas Drizzle/PG16 e dos 45 índices passaram; a asserção nova da ALT-08.10C.17 relatou `broken foreign key topology: 57 !== 0`.

Correção candidata: a consulta `pg_constraint` obtinha `ARRAY(SELECT a.attname ...)` como PostgreSQL `name[]`; o driver pode não retornar esse tipo como array JS padrão. As duas projeções foram explicitamente convertidas para `text[]` via `a.attname::text`, e o teste valida `Array.isArray` e tipo string das colunas antes de avaliar a topologia FK. Sem desabilitar a asserção de integridade. Confirmar resultado no **SHA exato posterior** antes de classificar GREEN. Staging/produção inalterados.

## ALT-08.10C.18 — contrato Drizzle/PG de FKs e prova adversarial da RLS legada

- `lib/db/operational-fk-contract-audit.ts` compara FKs como tuplas ordenadas (tabela/colunas de origem, tabela/colunas referenciadas, ações `ON DELETE`/`ON UPDATE`) e normaliza códigos do PostgreSQL (a/r/c/n/d). Divergências `missingDbFks`/`missingOrmFks` são evidência; o relatório mantém `fkContractCertified=false` e `migrationAuthorized=false`.
- `scripts/tests/alt0810c8-postgres-full-bootstrap.test.ts` extrai `getTableConfig(table).foreignKeys` do Drizzle e compara com `pg_constraint` antes do rollback dos 186 DDL no PostgreSQL16 descartável; imprime contagens, amostras de diferenças e hash SHA-256. Sem modificar o schema real.
- `tests/todo-alt0810c-fk-contract.test.ts` cobre ordem, código das ações, divergências e tuples inválidas.
- `scripts/tests/alt0810c18-legacy-rls-null-context.test.ts` reproduz em fixture efêmera o comportamento perigoso da política legada: quando `app.tenant_id` está ausente, a condição `IS NULL OR ...` permite ler ambos os tenants. Com política alternativa de contexto obrigatório, testa **zero linhas** sem escopo e somente tenant A com contexto 101. A migração `migrations/00002_rls.sql` não é alterada ou executada em produção.
- A prova de exposição é **falha de prontidão de segurança**, não certificação de segurança do sistema. A lógica de identidade/membership e a cobertura de todas as tabelas ainda não estão homologadas. Nenhum resultado GREEN autoriza aplicar a política proposta ao Neon.
- Aceite limitado aos jobs do CI no SHA exato. PR #36 DRAFT e produção NO-GO.

## ALT-08.10C.19 — proposta INERTE de RLS com tenant, usuário, membership e papel interno

`lib/db/alt0810c19-membership-rls.ts` declara a candidata versionada `alt0810c19-rls-membership-candidate-v1`, restrita à fixture `alt0810c6_membership19` em PostgreSQL16 descartável. Nenhum SQL foi incorporado a `migrations/`, `scripts/migrate.ts` ou executado no Neon.

A proposta requer `app.tenant_id` **e** `app.user_id` positivos, membership ativa do usuário no tenant e papel permitido (`client_viewer`/`client_admin`). A política separada para owner exige papel interno `owner` ativo e tenant selecionado explicitamente; ela não concede automaticamente visão de carteira. Ambas usam RLS + FORCE RLS, aplicadas somente à fixture.

`scripts/tests/alt0810c19-membership-rls.test.ts` prova negação sem contexto, leitura A/B separada, troca indevida de tenant, membership desativada/excluída, usuário interno revogado e roles PostgreSQL sem `BYPASSRLS`. `tests/todo-alt0810c19-rls-candidate.test.ts` verifica as flags NO-GO e recusa executar em ambiente diferente do CI efêmero.

**Bloqueador de segurança:** `SET LOCAL app.user_id/app.tenant_id` são parâmetros alteráveis por clientes SQL com conexão; não representam prova criptográfica de identidade. Uma futura implementação operacional exige que o app autentique sessão HTTP, confirme vínculo/entitlement no banco, use um papel sem `BYPASSRLS`, e estabeleça o escopo em transação confiável com conexão persistente e testes de falsificação/revogação. O driver Neon HTTP atual não fornece a transação interativa necessária segundo `lib/tenant/scope.ts`. Conceder acesso direto ao banco ao usuário final ou confiar nesses GUCs seria inseguro.

**Não há autorização para staging, produção, migração, merge ou deploy.** A aceitação técnica fica condicionada a 5/5 GREEN no SHA exato, especialmente o teste de RLS da fixture. A migração legada com contexto opcional permanece inalterada e insegura como opção operacional.

## ALT-08.10C.20 — autorização de sessão e escopo transacional (candidato)

- `lib/tenant/alt0810c20-authz-preflight.ts` introduz uma decisão **pura e inerte**: identidade já autenticada no servidor com versão da sessão verificada, `userId` válido, tenant explícito, membership ativa para o mesmo usuário/tenant, tenant e assinatura ativos, entitlement explicitamente habilitado. Operações owner/analyst são recusadas e devem ter seu próprio gate. Falha de qualquer condição resulta em negação. **Não está conectada às rotas de produção.**
- `tests/todo-alt0810c20-authz-preflight.test.ts` cobre sessões revogadas, usuário inválido, spoof de tenant, membership suspensa, contrato suspenso, feature desligada e bypass de papel interno.
- `scripts/tests/alt0810c20-pg-authz-scope.test.ts` usa apenas PostgreSQL16 descartável. Após validar autorização, abre `BEGIN`, assume role mínima sem BYPASSRLS, aplica `set_config(..., true)` de tenant/usuário autorizados **na mesma conexão** e consulta fixture A/B com FORCE RLS; rollback deve limpar o contexto. Tenta operações negadas antes de abrir transação. Integrado ao job PostgreSQL CI.
- **Limite de segurança essencial:** a função recebe uma prova de sessão *já validada* (representada por versão da sessão e identidade em memória); não autentica cookies, não faz lookup real de memberships/planos na mesma transação, não revoga sessão no banco, não implementa um executor WS/transaction pool nem torna os GUCs não falsificáveis a clientes SQL. O binding de identidade/entitlement e a revogação reais no Neon exigem gate adicional, inclusive proteção contra TOCTOU e falsificação.
- Nenhum runner de migração, API operacional ou banco Neon é alterado. `operationalAuthEnabled=false`, `stagingAuthorized=false`, `productionAuthorized=false`. Aceite condicionado ao CI GREEN no SHA exato, sem elevar status para migração.

## ALT-08.10C.21 — HTTP loopback real → sessão e autorização em PostgreSQL16 efêmero (candidato)

- Teste `scripts/tests/alt0810c21-http-pg-authz.test.ts` usa servidor HTTP Node (`127.0.0.1`, porta atribuída pelo sistema), cookies HMAC assinados de fixture, e duas identidades sintéticas. Não inicializa nem modifica as rotas Next.js reais.
- Para cada chamada, valida a assinatura do cookie antes de conectar ao banco; na **mesma conexão e transação PostgreSQL16**, lê a sessão/versionamento ativo, consulta membership do usuário e estado do contrato/entitlement do tenant, aplica `authorizeDisposableTenantScope`, faz `SET LOCAL ROLE` para role mínima e `set_config(...,true)` de tenant e usuário, consulta dados com FORCE RLS, finaliza por `ROLLBACK`.
- Verifica HTTP 200 apenas para tenant A ou B correto, HTTP 401 para cookie falso, anônimo e sessão revogada/version mismatch; HTTP 403 para tentativa cross-tenant, membership desativada e entitlement revogado. Confirma que revogação de A não bloqueia acesso legítimo de B.
- O CI PostgreSQL16 `postgres-disposable` ganhou passo ALT-08.10C.21. Tudo é descartável, sem URLs remotas ou acesso ao Neon.

**Limites/NO-GO:** a assinatura HMAC é uma chave fixa de fixture e o servidor HTTP é de teste, não uma implementação de autenticação Next.js. A política depende de GUCs mutáveis e não prova segurança contra acesso SQL direto com credenciais de aplicativo. Não há teste de conexões Neon HTTP/WebSocket, direitos comerciais completos, políticas operacionais legadas nem autenticação real por cookie da aplicação. A aceitação requer CI GREEN 5/5 no SHA exato e análise dos logs. PR #36 DRAFT; sem merge, deploy ou migração operacional.

## ALT-08.10C.22 — rota Next.js real, sessão revogada e falsificação de tenant (candidato)

- Reutiliza o ensaio existente `scripts/tests/alt083-http-ci.sh`, que inicia **Next.js real** com `PGLITE_DIR` descartável, cookie de sessão HMAC e banco de identidades sintéticas. Não cria rota de diagnóstico nova.
- `scripts/tests/alt083-http-fixture.ts` acrescenta identidade owner com `session_version=2`. O verificador HTTP chama a rota real `/api/console/notifications/operations` com cookie HMAC válido mas versão antiga `0`, exigindo HTTP **401**; a mesma identidade com versão atual `2` recebe **200**. Cliente tentando forjar `x-tenant-id` recebe **403**. Testes existentes para acesso owner/analyst/clientes A/B, cookie adulterado, anonimato e remoção de dados sensíveis permanecem.
- Critério de isolamento: somente `DATABASE_URL` vazia e PGlite criado em diretório temporário no runner GitHub; nenhuma consulta ao Neon/staging. O teste real Next.js está no job `ALT-08.3 HTTP autenticado (PGlite descartável)` já existente.
- **Limite:** a etapa usa a rota Next.js real mas não a integra ao PostgreSQL16 simultaneamente. O gate anterior .21 prova HTTP+PG16 em servidor HTTP de fixture, não em Next.js. Nenhum dos dois certifica a união Next.js + memberships + entitlements + RLS no mesmo PostgreSQL operacional. Para isso, restam seleção de driver transacional, vínculo entre cookie e DB, testes de revogação dentro do mesmo processo e revisão de GUCs falsificáveis.
- PR #36 DRAFT, produção NO-GO. A confirmação exige todos os jobs GREEN no SHA exato.

## ALT-08.10C.23 — gate arquitetural Next.js → PostgreSQL16 (NO-GO verificável)

**Constatação:** o adaptador real em `lib/db/index.ts` seleciona `drizzle-orm/neon-http` se `DATABASE_URL` existe, ou `drizzle-orm/pglite` se está ausente. `lib/tenant/scope.ts` já recusa executar escopo RLS sem transações interativas. Assim, a homologação HTTP Next.js + PGlite da ALT-08.10C.22 e a homologação HTTP de fixture + PG16 da ALT-08.10C.21 **não comprovam** que as rotas Next.js reais verificam cookie, versão de sessão, membership e entitlement dentro da mesma transação de PG16 com RLS.

**Implementação:** `lib/tenant/alt0810c23-next-pg-runtime-gate.ts` contém gate puro, sempre fail-closed, que cataloga evidências exigidas e **não** permite que a própria fixture autorize uma migração. `tests/todo-alt0810c23-next-pg-runtime-gate.test.ts` cobre falta de transação, GUC falsificável e tentativa de autoaprovação. `scripts/alt0810c23-database-routing-check.ts` inspeciona as fontes do adaptador real, o verificador de sessão, o helper de escopo e as fixtures CI e emite diagnóstico explícito. O check roda offline no job build. Nenhuma rota foi modificada nem foi criado endpoint público de diagnóstico.

**Critérios ainda não atendidos:** (a) adaptador PostgreSQL16 transacional usado pelo próprio Next.js sob guarda CI e sem URL operacional; (b) checagem no mesmo banco/transação de sessão, membership e entitlement; (c) papel sem BYPASSRLS e escopo no mesmo socket; (d) proteção contra injeção de `app.user_id`/`app.tenant_id` por clientes SQL; (e) evidência de revogação e rollback sob as rotas HTTP reais. Fazer nova implementação somente no ambiente descartável, mantendo validação e políticas reais imutáveis.

**Status:** ALT-08.10C.23 entrega bloqueio arquitetural verificável, **não** a integração completa. `ready=false`, `migrationAuthorized=false`, `productionAuthorized=false`. PR #36 DRAFT; Neon/staging/produção intactos; CI deve ser checado no SHA exato.

## ALT-08.10C.24 — adaptador PostgreSQL16 transacional descartável (candidato)

A ALT-08.10C.23 foi verificada GREEN 5/5 no CI #436 (run 43440797896), SHA `26d19f888b1b607c10dd3d34ea40235b209b1cad`.

O módulo `lib/db/alt0810c24-disposable-pg-adapter.ts` cria conexão `pg` **somente** no runner CI e no banco `vigia_alt081_ci` em `127.0.0.1:5432`, sob guarda de variáveis de ambiente. Seu método `readAuthorizedFixture` verifica assinatura HMAC do cookie real `sr_session` com `verifySession`, abre `BEGIN` na mesma conexão, consulta a versão da sessão com `FOR SHARE`, consulta membership/contrato/entitlement com `FOR SHARE OF m,c`, executa a pré-autorização fail-closed, assume role mínima `NOBYPASSRLS`, define GUCs locais e faz leitura protegida por `FORCE ROW LEVEL SECURITY`. Todos os caminhos fecham por `ROLLBACK`.

`scripts/tests/alt0810c24-pg-adapter.test.ts` exercita sessões corretas, tenants A/B, tentativas cross-tenant, papel owner, cookie falso/ausente, revogação de membership, entitlement e versão da sessão, além da limpeza de role e contexto por rollback. O job PostgreSQL CI ganhou a etapa correspondente.

**Limites:** é adaptador modular **inerte**, ainda não injetado no `getDb()` nem nas rotas Next.js reais. As permissões, GUCs e contrato de entitlement são somente da fixture, não do banco operacional. A guarda de ambiente impede conexão remota mas não é modelo de autenticação para produção. Cliente SQL com credenciais privilegiadas ainda poderia falsificar GUCs; credenciais do backend nunca devem ser disponibilizadas a clientes finais. O gate próximo exige integrar rotas Next.js reais em CI descartável, com migrações isoladas, sem tocar em Neon.

Status: `operationalEnabled=false`, `stagingAuthorized=false`, `productionAuthorized=false`; PR #36 DRAFT, produção NO-GO. Certificação técnica da ALT-08.10C.24 depende de CI 5/5 GREEN no SHA exato.

## ALT-08.10C.25 — integração Next.js App Router ↔ PostgreSQL16 descartável

- A rota App Router **de ensaio** `app/api/ci/alt0810c25/route.ts` é executada pelo próprio Next.js 16 (Node runtime), com acesso permitido somente quando `ALT0810C25_EPHEMERAL=1` e a guarda `assertAlt0810c24Env` confirmar ambiente GitHub Actions Linux e PostgreSQL16 exclusivo em `127.0.0.1:5432/vigia_alt081_ci`. Em outros ambientes, a rota responde `404` e não abre conexão. `DATABASE_URL` e `RLS_DATABASE_URL` obrigatoriamente vazias.
- A rota consulta `sr_session`, utiliza o adaptador `readAuthorizedFixture` para validar assinatura HMAC, versão de sessão no PG, membership e contrato/entitlement na **mesma transação PG16**. Usa role restrita, `FORCE ROW LEVEL SECURITY`, GUCs locais somente após autorização e encerra a conexão com rollback.
- Teste `scripts/tests/alt0810c25-next-pg-e2e.test.ts`: cria schema e role isolados, inicia Next.js real em loopback `127.0.0.1:3205`, exerce GET HTTP para clientes A/B e revoga membership, entitlement e versão da sessão no PostgreSQL. Cobre cookie adulterado, ausência de cookie, owner indevido, tentativas cross-tenant, versão atualizada, separação de A/B e `Cache-Control:no-store`. Limpa processo, schema e role após ensaio. Etapa incluída no job PostgreSQL16 descartável CI.
- A **integração ponta a ponta validada** é restrita à rota CI recém-criada, não às rotas de negócio existentes nem ao esquema operacional de 62 tabelas. O adaptador SQL é fixture separada. NÃO altera `lib/db/index.ts`, `migrations/` nem o banco Neon. Não demonstra binding resistente a cliente SQL com acesso privilegiado (GUCs permanecem mutáveis).
- Pré-condição: ALT-08.10C.24 CI #441 deve passar no SHA correspondente. Aceitação ALT-08.10C.25 exige todos os 5 jobs GREEN no HEAD exato. PR #36 DRAFT; produção e staging NO-GO, nenhum merge/deploy.

### ALT-08.10C.25 — incidente CI #446 e correção candidata

O CI #446, run `43449535768`, SHA `409cc6fbab6af363d51a0e53957b453ec86d71cd`, terminou RED: `build` falhou no comando `next build` com erro Turbopack `Module not found: Can't resolve 'pg'`, importado pelo adaptador descartável a partir da rota App Router CI; os demais quatro jobs foram SKIPPED por dependência. Lint, type-check e 503 testes unitários tinham passado. O pacote `pg` é instalado com `npm install --no-save --package-lock=false pg` somente no job PostgreSQL descartável; não consta nas dependências de produção. Commit `1b9ffcc3cc6be26597efa4cfa1a6c6e17e13da6f` adiciona `pg` a `serverExternalPackages` em `next.config.ts` para manter o driver fora do bundle Next. **Correção candidata:** aguardar/verificar CI #447 no SHA exato, sem assumir GREEN; se falhar novamente, rever importação/empacotamento de CI sem inserir driver de testes na aplicação de produção.

## ALT-08.10C.26 — build npm ci puro e rota de teste excluída da produção

- CI #449 (run `43452866930`, SHA `950bb6a8fba590aeddc2f181e7cabf64cac5d7c6`) concluiu **GREEN 5/5**, porém o job build dependia da instalação transitória de `pg`, demonstrando que o empacotamento operacional ainda não estava pronto.
- A rota `app/api/ci/alt0810c25/route.ts` foi **retirada da árvore App Router versionada**. Seu código permanece como texto inerte `scripts/tests/fixtures/alt0810c25-route.fixture.txt`; não participa de build Next.js e não cria rota em produção.
- O teste `scripts/tests/alt0810c25-next-pg-e2e.test.ts`, sob guarda rigorosa do runner PostgreSQL CI, injeta essa fixture em `app/api/ci/alt0810c25/route.ts` exclusivamente no checkout descartável, inicia Next.js dev e depois apaga o arquivo/diretório da rota. Rejeita sobrescrever rota preexistente.
- `next.config.ts` foi revertido para retirar o pacote externo temporário `pg`. O job build do CI usa **somente `npm ci`** (sem instalação transitória de PG) e executa o `next build` operacional.
- A verificação offline `scripts/alt0810c26-production-isolation-check.ts` impede presença de rota CI na árvore `app/`, impede `pg` em `package.json` e lockfile, detecta instalação transitória de `pg` no job build e confere `.next/server/app-paths-manifest.json` e artefatos após o build para garantir que a rota `alt0810c25` não seja entregue.
- Nenhuma rota comercial, API real, migração ou banco Neon foi alterado. **Homologação depende de CI GREEN 5/5 no SHA exato**, inclusive teste real Next.js+PG16 com fixture injetada. PR #36 permanece DRAFT e produção NO-GO.

## ALT-08.10C.27 — smoke de artefato standalone e next start (candidato)

- Baseline: ALT-08.10C.26 confirmada GREEN 5/5 no CI #457 (run `43455660366`), SHA `2592076c31216a864f643da447d98865ce85ae97`; logs registraram `npm ci` puro, gate da ausência de rota/driver antes e depois do build e E2E Next.js real+PostgreSQL16 efêmero passando.
- `scripts/alt0810c27-production-http-smoke.ts` verifica, **sem URL de banco e exclusivamente em runner GitHub Linux**, presença de `.next/standalone/server.js`, manifesto sem rota de CI, Dockerfile multiestágio com `npm ci` e `next build`, cópia de standalone e comando `node server.js`, e `.dockerignore` sem `.next`/node_modules. Inicia `next start` e em seguida o servidor standalone real em loopback, ambos com `NODE_ENV=production`, segredo sintético e `DATABASE_URL/RLS_DATABASE_URL` vazios. Envia cookie de sessão HMAC **válido** para `/api/ci/alt0810c25?tenant=101` e exige HTTP 404 (401 indicaria bloqueio por cookie inválido, não prova ausência da rota). Mata os processos ao final.
- Ensaio no job build CI depois de `npm run build` e da verificação do manifesto. **Não executa Docker daemon, imagem nem registry:** a análise Docker neste gate é estática; homologar imagem Docker construída/rodando em gate separado antes de deploy.
- Requer CI GREEN 5/5 no SHA exato para considerar a etapa validada. PR #36 DRAFT, sem merge/deploy e produção NO-GO.

## ALT-08.10C.28 — imagem Docker real sem conectividade com banco operacional

Baseline: CI #465, run `43464376803`, SHA `104d3ff4fa1c9957a2fcb356b96685f22b7cd4b8`, GREEN 5/5. ALT-08.10C.27 confirmou isolamento HTTP da rota CI no `next start` e no standalone fora de Docker.

O ensaio `scripts/tests/alt0810c28-docker-isolated-ci.sh` compila a **imagem Docker real** usando `deploy/Dockerfile` e o `.dockerignore` versionados. A execução ocorre somente em um runner GitHub Actions Linux descartável, com `CI=true`, `GITHUB_ACTIONS=true`, `ALT0810C28_EPHEMERAL=1`, sem `DATABASE_URL` ou `RLS_DATABASE_URL`. Usa `docker run --network none` (sem conectividade externa), `--cap-drop ALL`, `no-new-privileges` e sessão sintética de teste. Inspeciona o usuário e entrypoint da imagem, configurações de rede e variáveis do container, manifesto App Router **dentro da imagem** sem rota `alt0810c25`; verifica HTTP `404`, corpo `not_found` e `Cache-Control: no-store` via `docker exec` localhost (sem publicar portas). Faz cleanup de container e imagem em trap EXIT. Não publica no GHCR e não se conecta a Neon.

`.github/workflows/ci.yml` inclui sexto job `docker-disposable`, nomeado `ALT-08.10C.28 Docker standalone isolado`, dependente do build limpo, permissões de leitura e timeout 25min. Critério de aceitação: **todos os seis jobs GREEN no SHA exato**, incluindo Docker real. Esta prova demonstra operação da rota isolada sem banco operacional; **não demonstra funcionamento das rotas de negócio sem um banco**, nem autoriza deploy ou migração. PR #36 DRAFT, produção NO-GO.

## ALT-08.10C.29 — rota de negócio real x PostgreSQL16 em runner descartável (candidato)

Baseline: ALT-08.10C.28 CI #469 run `43466813766` GREEN 6/6 no SHA `deb60c0f5be8491d09edf0b31fa7b3cb0e8c0492`. O teste Docker real comprovou isolamento da rota exclusiva de CI, sem Neon.

Foi criado `scripts/tests/alt0810c29-real-business-pg.test.ts`, que invoca **a rota de negócio já existente** `GET /api/me/permissions` no Next.js, não uma rota inventada de teste. O ensaio constrói no PostgreSQL 16 descartável as 186 instruções do snapshot legado em schema isolado, provisiona dois clientes/tenants, memberships, plano, assinatura e feature. Inicia Next.js real em loopback; apenas no checkout efêmero, substitui temporariamente o módulo `lib/db/index.ts` por texto inerte versionado em `scripts/tests/fixtures/alt0810c29-db.fixture.txt`, que usa Drizzle node-postgres e uma conexão PostgreSQL sob role LOGIN mínima **NOBYPASSRLS** com `search_path` do schema isolado. Restaura o módulo e apaga schema/role em `finally`. Não modifica o adaptador operacional do repositório, não utiliza Neon e não autoriza migração.

Asserções: sessão HMAC válida/ausente/revogada; isolamento de tenants A/B; `tenant_id` forjado em query não altera vínculo; entitlement derivado do plano, revogação do override para A sem alterar B; com `FORCE ROW LEVEL SECURITY` no cadastro de tenants e policy que requer `app.tenant_id`, a rota atual **não estabelece** contexto transacional autenticado e deve deixar de oferecer a feature ao cliente. Esse último resultado é **diagnóstico fail-closed**, não homologação positiva de RLS. O teste não substitui uma futura integração transacional verdadeira nas rotas de negócio. **Produção permanece NO-GO.**

Critério: novo teste deve passar em CI no SHA exato com 6/6 jobs GREEN. Mesmo GREEN significa apenas cobertura do fluxo existente com diagnóstico de lacuna RLS; não significa autorização de staging/produção. PR #36 DRAFT; sem merge/deploy/Neon.

### Ampliação do ensaio ALT-08.10C.29 — segunda rota comercial

O mesmo teste passa a chamar também a rota de negócio pré-existente `GET /api/console/tenants` com usuário de papel global `owner` (espera 200 e dois tenants), cliente comum e `analyst` (ambos devem ser negados). Um retorno 500 na negativa é registrado como **déficit de tratamento de erros de autorização**, não considerado resposta HTTP 403 homologada. Ensaio limitado ao PostgreSQL CI e ao driver injetado; não altera ou aprova as rotas reais em staging/produção.

## ALT-08.10C.30 — candidato transacional autenticado com RLS PG16

A baseline ALT-08.10C.29, CI #484 run `43472965153`, SHA `2c02ae314fcd254effaa5de2ca6953ec110facaa`, passou 6/6 em PostgreSQL efêmero e duas rotas reais, mas evidenciou falha fechada com RLS ao não estabelecer `app.tenant_id` na mesma transação.

Foi criado `lib/tenant/alt0810c30-transactional-read.ts`, um **primitivo isolado**, sem driver PG ou invocação por rotas de produção, que recebe conexão dedicada e um callback de leitura definido pelo servidor. Dentro do mesmo `BEGIN`/ `ROLLBACK`, verifica cookie HMAC, versão atual da sessão com `FOR SHARE`, papel externo de cliente, membership de tenant validada, status do cliente, assinatura e vigência, entitlement via plano ou override vigente. Só então aplica role PostgreSQL restrita (`SET LOCAL ROLE`) e GUCs de sessão com `set_config(...,true)` (transacionais) e executa o callback de leitura ainda na mesma conexão. Revogações concorrentes da identidade/contrato são protegidas pelos locks antes da leitura; todas as saídas encerram a transação. Sem callback/SQL escolhido pelo cliente, sem escalonamento para owner/analyst, e sem role `BYPASSRLS`.

`scripts/tests/alt0810c30-pg-transactions.test.ts` prepara schema e role descartáveis no PG16 local do runner. Cria usuários/tenants A/B, assinaturas, plano e tabela `evidence` com `ENABLE/FORCE ROW LEVEL SECURITY`; exige leitura A->[1], B->[2], proibição cruzada, sem sessão, owner, feature desabilitada, contrato suspenso, membership removida, sessão revogada; valida `ROLLBACK`, `current_user` restaurado, GUCs ausentes após requisição e role NOBYPASSRLS. Job integrado ao PostgreSQL16 do CI.

**Escopo e NO-GO:** esse candidato NÃO está ligado a rotas Next.js operacionais nem usa hoje o driver Neon HTTP. Não implica produção transacional pronta; a integração runtime exige transporte PostgreSQL de conexão fixa/transactions, revisões dos erros, ciclo de vida dos pools, migrações/roles/policies e autenticação de cada rota. GUCs SQL são mutáveis por papéis que possam executar SQL arbitrário; segurança depende de SQL confiável e role limitada. Não foi feito deploy/merge, publicação ou alteração Neon.

## ALT-08.10C.31 — rota HTTP Next real em PostgreSQL transacional descartável

Baseline ALT-08.10C.30: CI #490 GREEN 6/6 no SHA `d7259b47c3d478f79b799526244e929301b4503a`. O candidato `authorizedTenantRead` provou autenticação/contratos/RLS na mesma conexão, mas não a integração HTTP.

`scripts/tests/alt0810c31-real-next-pg-rls.test.ts` inicia o Next.js real em loopback e chama o caminho **existente** `GET /api/me/permissions`, sob PostgreSQL 16 descartável, sem Neon. A integração experimental fica em `scripts/tests/fixtures/alt0810c31-permissions-branch.fixture.txt` como **texto inerte**: só o runner efêmero injeta temporariamente um ramo no GET real; um `finally` restaura o arquivo original. Nada disso entra no artefato de produção. O ramo extrai o usuário do cookie assinado, escolhe tenant pelo membership no banco (ignora `tenant_id` fornecido no URL) e chama o candidato ALT-08.10C.30 com cliente PostgreSQL exclusivo da requisição, transação, verificações versionadas, contrato/feature e leitura RLS em role restrita.

O ensaio provisiona duas identidades e tenants A/B, duas assinaturas, uma feature comercial e a tabela de evidências com `ENABLE/FORCE ROW LEVEL SECURITY`; verifica respostas reais HTTP 200/A=[1], 200/B=[2], spoof do tenant ignorado, sessão ausente 401, papel owner proibido 403, override e assinatura suspensa 403, revogação da sessão 401 e nova versão válida. Também verifica que a role de leitura não possui `BYPASSRLS`.

**O gate é uma integração HTTP no checkout de CI, NÃO uma migração operacional da rota real.** Não modifica `lib/db/index.ts` nem a rota real versionada; depende de injeção efêmera de código, sem conexão PostgreSQL operacional com transações e sem policies provisionadas no banco real. Não homologa staging/produção, RLS não pode ser habilitado em Neon, PR DRAFT, produção NO-GO.

## ALT-08.10C.32 — ligação versionada da rota real, ativação CI opt-in e rollback

Baseline: ALT-08.10C.31 CI #495 GREEN 6/6 no SHA `928bf200ed20c7aa176e866d912844385e23858f`. O gate anterior usou injeção efêmera de código; esse gate **versiona o desvio no GET real** `/api/me/permissions` e move seu transporte para `lib/tenant/alt0810c32-versioned-route.ts`.

- Padrão `ALT0810C32_MODE` não definido ou `off`: a rota preserva integralmente `resolveTenantContext`, `enabledFeatures` e o transporte operacional existente. Essa é também a operação de rollback (desligar a flag); o teste unitário prova a função determinística, sem efetuar alteração de banco.
- `ALT0810C32_MODE=disposable-ci` só é aceito com `ALT0810C32_EPHEMERAL=1`, CI/GitHub Actions/Linux, PostgreSQL local com credenciais e DB fixados e sem `DATABASE_URL` ou `RLS_DATABASE_URL`, `DEMO_MODE` desativado e `NODE_ENV` diferente de `production`. Qualquer outra ativação falha fechada; `staging` ou `production` não são modos válidos.
- No opt-in, cria-se um `pg.Client` exclusivo por request (driver instalado **somente no job descartável**). Extrai-se o usuário do cookie assinado, seleciona-se o único vínculo no banco, ignora-se o `tenant_id` enviado pelo cliente e invoca-se o primitivo ALT-08.10C.30. Este revalida sessão, memberships, status de contrato e entitlement sob locks `FOR SHARE` na mesma transação; muda para role de leitura `NOBYPASSRLS`, aplica `set_config(..., true)` e lê `alt0810c32_http.evidence` sob `FORCE RLS`; encerra com `ROLLBACK`.
- `tests/alt0810c32-versioned-route.test.ts` valida default-off, desligamento e rejeição de ativação fora do runner; `scripts/tests/alt0810c32-versioned-http-pg.test.ts` chama a rota real sem injetar/modificar o arquivo, com tenants A/B e casos de spoof, revogação e falhas de entitlement. Schema/role são descartados ao final.
- Este módulo **não é um driver PostgreSQL de produção**: `pg` não foi incluído nas dependências de deploy, a role/schema/evidence são apenas do CI e a ativação operacional foi explicitamente proibida. A liberação futura requer aprovação independente, credenciais segregadas e migradas, políticas RLS reais, infraestrutura de pool, revisão das demais rotas e testes de staging. Sem acesso ao Neon, sem migrations, sem deploy, sem merge; PR #36 DRAFT; produção NO-GO.

## ALT-08.10C.33 — projeto operacional de pool, privilégios, RLS e rollback (NO-GO)

Baseline confirmada: ALT-08.10C.32 CI #508 GREEN 6/6, SHA `1dd03af931860fe535bba983eb431da0fa963f41`. Esta fase **não ativa** driver ou RLS operacional.

**Artefato de contrato (não ligado às rotas):** `lib/db/alt0810c33-operational-contract.ts` define `DedicatedPool.connect()` / `DedicatedClient.release(discard?)` e `withDedicatedTenantClient()`. Cada requisição tem cliente dedicado durante todo o `BEGIN`/escopo/SELECT; o wrapper tenta `ROLLBACK` antes de devolver o cliente ao pool e marca a conexão para descarte se não conseguir restaurar o estado. A função atual `authorizedTenantRead()` já encerra a própria transação com `ROLLBACK`; o rollback adicional do wrapper é defesa redundante contra callback incompleto. Não usar `pool.query()` fragmentado para `SET LOCAL`/RLS.

**Preflight de catálogo:** `preflightTenantRls(db,scope)` valida identificadores estáticos e consulta `pg_roles`, `pg_class`, `pg_namespace`, `pg_policies`, `pg_has_role` e `has_table_privilege`, exigindo executor com LOGIN sem SUPERUSER/BYPASSRLS; role de leitura NOLOGIN sem SUPERUSER/BYPASSRLS; executor membro da role; schema USAGE, tabela de evidências com `ENABLE/FORCE RLS`, dono diferente da role de leitura; policy SELECT aplicável; SELECT na evidência, nenhum INSERT/UPDATE/DELETE e **nenhum acesso pela role de leitura** a users, memberships, tenants, subscriptions, plan_features e tenant_features. Uma policy SELECT existente **não comprova** que o predicado protege os tenants; isso exige auditoria SQL independente.

**Ensaios:** `tests/alt0810c33-operational-contract.test.ts` avalia default-off, rollback de saída normal e anormal, descarte da conexão em falha de cleanup e rejeição de identificador/metadata inválidos. `scripts/tests/alt0810c33-pg-privileges-pool.test.ts` usa PostgreSQL16 exclusivamente descartável: pool real com usuário executor de privilégio mínimo, role de leitura NOLOGIN, policy FORCE RLS de dois tenants e teste de vazamento do contexto. Negativos: FORCE RLS removido, concessão inesperada de SELECT sobre identities, vínculo à role de leitura revogado. Todos retornam ao estado fixture em runner efêmero. O passo é adicionado ao job PG16 do CI; `pg` permanece fora do lock/deploy e não há alteração em `next.config.ts`.

**Desenho de rollout operacional futuro (NÃO autorizado):** (1) inventariar tabelas, policies e ownership reais e capturar backup custom-format + ACL/roles com restauração ensaiada; (2) criar roles separadas de migrador, executor e leitor com credenciais não compartilhadas, TLS obrigatório e pool dedicado ao runtime Node; nunca usar SUPERUSER/BYPASSRLS; (3) definir isoladamente as policies de cada tabela e revisar queries, memberships e sessão, incluindo impossibilidade de injeção SQL/role/GUC por usuário; (4) testar preflight fail-closed, carga concorrente, desconexões, saturação do pool e revogação em staging isolado; (5) somente após revisão e autorização habilitar canário por rota/tenant com telemetria; (6) rollback aplicativo por flag OFF **antes** do rollback de policies, abortar conexões em uso, validar read path legado e decidir restauração SQL por tabela, impedindo janela sem RLS. Com `FORCE RLS` ativo, desligar apenas a flag pode deixar rotas legadas incapazes de ler: rollback de banco/rotas deve ser coordenado, sem abrir cross-tenant. Não executar DROP POLICY/ALTER TABLE DISABLE em produção sem janela e evidência.

**Gates não satisfeitos:** nenhuma credencial, pool ou schema operacional homologado; sem verificação de predicados reais, sem ensaio concorrente de produção, sem staging aprovado. PR #36 DRAFT, produção e staging NO-GO; nenhum merge/deploy/Neon.

## ALT-08.10C.34 — políticas exatas e transações de leitura em pool (candidato CI, NO-GO)

**Motivação:** `preflightTenantRls` da C.33 confere existência de policy SELECT, mas isso não basta: permissive policies distintas são combinadas com `OR` e aplicam-se também a `PUBLIC` ou a memberships herdadas. Além disso, concessões somente por coluna não apareciam em `has_table_privilege`. O preflight C.33 passou a usar `has_any_column_privilege` nos grants SELECT/INSERT/UPDATE da evidência e das tabelas de autenticação; passou também a exigir `pg_has_role(executor,reader,'SET')`, além de `MEMBER`, pois PostgreSQL 16 admite `GRANT ... WITH SET FALSE` sem direito a `SET LOCAL ROLE`. Documento oficial: https://www.postgresql.org/docs/16/ddl-rowsecurity.html e https://www.postgresql.org/docs/16/functions-info.html.

**Candidato introduzido:** `lib/db/alt0810c34-policy-pool-guard.ts` com `preflightExclusiveTenantPolicy` combina o preflight C.33 com exigência de **exatamente uma** policy sobre a tabela; SELECT-only, permissiva, exclusiva da role leitora; papel e nome esperados; nenhuma policy PUBLIC/ALL/UPDATE adicional; expressão `pg_get_expr(polqual,polrelid)` com SHA-256 de um manifesto externo aprovado; zero concessões públicas de DML/USAGE sobre tabela, colunas ou schema. No teste descartável, o fingerprint é extraído da policy sintética criada pelo próprio ensaio; **não existe fingerprint operacional revisado**, portanto não há certificado semântico para nenhuma policy do produto. Para rollout futuro, o hash esperado deverá vir de artefato versionado revisado e comparado a baseline externo.

**Wrapper experimental:** `withDisposableScopedRead` aceita somente escopo **já autorizado pelo servidor**, cria `BEGIN READ ONLY`, aplica `SET LOCAL ROLE` e `set_config('app.tenant_id',...,true)` na **mesma conexão**, expõe callback de query com restrição conservadora a SELECT único e termina por `ROLLBACK`. Tentativas de COMMIT, batch SQL, DML, mutação explícita de GUC, SQL comentado ou CTE são negadas antes de alcançar a conexão. Não é um parser SQL nem resolve autenticação; é defesa adicional sobre SQL estático revisado, não pode aceitar SQL ou tenantId diretamente de HTTP. Queries que chamem funções arbitrárias ainda exigem auditoria e menor privilégio. `withDedicatedTenantClient` garante descarte da conexão em falha de rollback; a proteção **não pode desfazer** um COMMIT de outro fluxo.

**Cobertura implementada:** `tests/alt0810c34-policy-pool-guard.test.ts` faz testes negativos de contrato, contexto, callback e cleanup. `scripts/tests/alt0810c34-pg-policy-pool.test.ts` cria roles e schema sintéticos **somente** no serviço PG16 do CI e testa tenant A/B, ausência de GUC, negação de coluna sensível, policies `TO PUBLIC` e herdadas via group role, `USING(true)` com nome preservado, policies DML adicionais, SELECT público no nível de tabela **e coluna**, UPDATE concedido por coluna, USAGE público do schema e privilégios de auth herdados. Com pool max=2, executa duas leituras simultâneas isoladas e exige timeout na terceira; verifica que o escopo não persiste após rollback. Limpeza de roles/schema ao final. Novo step no `postgres-disposable` usa `ALT0810C34_EPHEMERAL=1`, URL operacionais vazias e guarda estrita de CI.

**Critério de aceite limitado:** CI **6/6 GREEN no HEAD exato**, inclusive step C.34, sem afrouxar testes. Gate ainda não prova recuperação após falha física, revogação simultânea em rota real, policy do schema operacional, resiliência real multi-host, homologação staging ou política com predicado revisado independente. Qualquer rollout exige policy/ACL manifest versionado e assinado, inventário/reversibilidade de **roles, grants, policies, tabelas**, backup/restore provado, autorização humana para staging e depois gate distinto para produção. `ALT0810C32_MODE=off` desliga apenas a rota, **não reverte policies nem FORCE RLS**.

**Estado:** PR #36 DRAFT; staging/Neon operacional e produção **NO-GO**; nenhum merge/deploy/DDL RLS remoto.

## ALT-08.10C.35 — manifesto versionado, divergências e rollback (CI-only, NO-GO)

**Baseline conferida:** C.34, CI #533, run `43571609742`, SHA `9c804be802a7ca1b65c9169434302bedff34b6ab`, seis jobs GREEN, incluindo etapa PG16 C.34. A baseline não autoriza produção.

**Manifesto novo:** `schema/operational-rls/alt0810c35-disposable-manifest.json`, versão 1, declarado **exclusivamente para PostgreSQL 16 efêmero em GitHub Actions**. Contém schema/tabela/roles de fixture, policy SELECT única permissiva da role NOLOGIN, predicado SQL `tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer`, SHA-256 fixado de seu **texto-fonte**, lista de colunas legíveis `id,tenant_id` (não `private_text`), dependências `users, memberships, tenants, subscriptions, tenant_features, plan_features`, ausência de privilégios sobre auth e flags explicitamente NO-GO. Essas tabelas são **projeções sintéticas** para provar o contrato; não são aprovação de policies ou ACL operacionais.

**Verificação offline:** `lib/db/alt0810c35-operational-manifest.ts` valida estrutura exata, hash fixado no código, roles, ACLs, dependências, flags NO-GO e sequência de recuperação. `scripts/alt0810c35-manifest-check.ts` lê somente arquivos do checkout, sem driver/banco, e rejeita mutações de SQL, privilégios, dependências ou autorização. `tests/alt0810c35-manifest.test.ts` contém alterações adversariais de manifesto e snapshot, exigindo fail-closed.

**PostgreSQL 16 isolado:** `scripts/tests/alt0810c35-pg-manifest-rollback.test.ts` só executa com guards CI/GitHub Actions/Linux e credenciais locais *exatas* do serviço PG16 descartável, URLs operacionais vazias. Provisiona duas identidades de tenant com role leitora NOLOGIN NOBYPASSRLS e executor LOGIN NOBYPASSRLS, grant de `SET ROLE`, uma única policy, `ENABLE/FORCE ROW LEVEL SECURITY` e SELECT por duas colunas; exerce o preflight C.34 e SELECT 101→1 / 202→2, com coluna privada negada. Captura snapshot tipado/ordenado de `pg_roles`, `pg_auth_members`, `pg_class`, `pg_policy`, `pg_attribute`, ACLs de schema/tabela/colunas, dependências de autorização e linhas sintéticas.

O ensaio aplica mudanças **apenas dentro de transação/savepoint de teste**: `USING(true)`, policy adicional `TO PUBLIC`, remoção de FORCE RLS, grants SELECT públicos em tabela/coluna, exposição de `private_text`, USAGE público de schema, leitura de tabela de auth, remoção de `SET ROLE`, ativação de `BYPASSRLS`, exclusão de uma tabela dependente e mudança cross-tenant em dados. Cada caso deve produzir divergência do snapshot e, depois de `ROLLBACK TO SAVEPOINT`, retornar à mesma estrutura/privilegiamento/dados e digest SHA-256. Os objetos sintéticos são descartados ao fim. O caso `USING(true)` só é permitido dentro da fixture adversarial.

**Limites de evidência:** o fingerprint `pg_get_expr` da C.34 é computado depois da aplicação do SQL de fixture aprovado no manifesto; isso prova regressão/drift da fixture, **não** equivale a hash/parecer de auditor independente sobre o predicado de produção. O rollback com savepoint prova apenas alterações ainda **não confirmadas** por COMMIT; não simula restauração de migrations já aplicadas, backup físico/PITR, concorrência multi-host nem repõe policies reais. `ALT0810C32_MODE=off` só altera roteamento de aplicação, não restaura policies/roles/ACL/DDL. A migração operacional exige inventário e snapshots reais read-only autorizados, revisão formal por tabela, ownership e ACL completos, restore ensaiado em ambiente autorizado, credenciais mínimas, homologação transacional e autorização explícita para cada mudança remota.

**Aceite da C.35:** novo SHA exato com todos os 6 jobs GREEN, step offline do build e step PG16 C.35 concluídos com success. Até lá C.35 é candidata. PR #36 DRAFT; sem merge/deploy/publicação, sem staging/Neon, sem DDL operacional; produção **NO-GO**.

Fontes técnicas: [PostgreSQL 16 pg_policy](https://www.postgresql.org/docs/16/catalog-pg-policy.html), [CREATE POLICY](https://www.postgresql.org/docs/16/sql-createpolicy.html), [SAVEPOINT](https://www.postgresql.org/docs/16/sql-savepoint.html).
