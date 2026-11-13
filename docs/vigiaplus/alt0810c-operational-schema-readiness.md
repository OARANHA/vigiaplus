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
