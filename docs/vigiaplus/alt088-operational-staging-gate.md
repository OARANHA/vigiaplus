# ALT-08.8 — Contratos operacionais no mesmo banco de staging

**Status:** implementado o ensaio no código, execução manual do GitHub Actions pendente. O teste não substitui autenticação HTTP nem migração completa do schema em produção. Produção permanece NO-GO.

## Ambiente imutável
- Projeto Neon CI `still-heart-81001946`, branch `br-super-star-bbc317wq`, banco `vigia_alt086_staging_20261112`.
- Somente schema reservado `alt088_operational_ci`, inicialmente inexistente. Sem acesso a dados reais, sem alterações a `public`.
- Role migradora `vigia_alt083_ci_20261112_owner` usada **somente** em schema isolado para DDL e leituras de autenticação/entitlements de fixture.
- Role `vigia_alt087_staging_reader` sem `BYPASSRLS`, apenas `USAGE` do namespace e `SELECT` por coluna nas quatro tabelas.

## Contratos representados

`scripts/tests/alt088-staging-operational-rls-e2e.ts` cria tabelas sintéticas com nomes e colunas essenciais da aplicação: `tenants`, `users`, `memberships`, `plans`, `plan_features`, `subscriptions`, `tenant_features`, `reputation_targets`, `incidents`, `notification_channels` e `invoices`. Não é um clone exato de `lib/db/schema.ts`: há colunas e regras omitidas intencionalmente.

A fixture inclui tenants 771 e 882, usuários clientes com papéis `client_admin` e `client_viewer`, papéis internos `owner`/`analyst`, planos e duas assinaturas ativas. A leitura dos contratos de membership+plan+entitlement acontece **no mesmo banco de staging**, mas em conexão privilegiada de preparação, de forma sintética; não usa cookies ou `resolveTenantContext` reais.

O reader não tem leitura das tabelas `users/memberships/subscriptions`; a query de decisão em staging representa o backend autenticado. Somente após essa decisão os testes disparam consultas em Neon WebSocket com `SET LOCAL app.tenant_id` na role não privilegiada.

O ensaio confere:
- Cliente A só pode obter seu tenant 771 e cliente B 882; seleções cruzadas e owner/analyst sem membership elegível são negadas pela decisão simulada.
- Role reader sem tenant vê zero registros; sob tenants 771 e 882 vê somente o registro sintético correspondente em cada uma das quatro tabelas da primeira onda RLS.
- `SELECT *` de usuários e leitura `notification_channels.destination` negados; `UPDATE` de incidentes negado.
- Depois de cada transação, `app.tenant_id` não vaza; as políticas RLS usam o mesmo `tenant_id` que as regras da wave 1.
- Migração: grants por coluna, ENABLE/FORCE RLS e política `SELECT` individualmente em cada tabela. Rollback: DROP POLICY, NO FORCE, DISABLE, REVOKE SELECT por tabela, REVOKE USAGE e remoção explícita somente dos onze objetos artificiais. Catálogo final obrigatório 0 schemas / 0 tabelas / 0 policies.

## Execução e restrições

O passo `ALT-08.8 staging contratos operacionais RLS e rollback (sintetico)` foi adicionado ao workflow manual `.github/workflows/alt083-neon-e2e.yml`, condicionado aos mesmos dois secrets privados usados na ALT-08.7. **GREEN do CI principal não comprova execução da ALT-08.8**: exigir workflow dispatch na branch atual e logs do passo, SHA idêntico ao da PR.

**Ainda não homologados:** autenticação HTTP assinada e memberships em banco operacional único sob o runtime real da aplicação; plano/entitlement integral (prioridades, revogação, vencimento); owner/analyst/worker/webhook positivos e legítimos; isolamento com múltiplos memberships; esquema completo e policies de escrita; rollback preservando ACLs de um banco já povoado; substituição de `getDb()` neon-http por uma integração transacional em produção.

**Gate de produção: NO-GO.** Sem merge/deploy/ativação operacional.

## Evidência de execução direta no Neon — 12/11/2026

Foi executado **ensaio SQL real** no Neon staging isolado, banco `vigia_alt086_staging_20261112`, schema exclusivo `alt088_operational_ci`. Criadas em transação as 11 tabelas sintéticas descritas neste documento, 2 tenants e usuários fictícios, memberships, planos, features, subscriptions e quatro tabelas da Wave 1.

A consulta SQL combinando `memberships`, `users`, `subscriptions`, `plan_features` e `tenant_features` retornou **somente** os usuários sintéticos 101/tenant 771/`client_admin` e 102/tenant 882/`client_viewer`.

A role `vigia_alt087_staging_reader` não privilegiada retornou **zero linhas sem `app.tenant_id`** em `reputation_targets`, `incidents`, `notification_channels` e `invoices`. Em transações distintas com `set_config('app.tenant_id', ..., true)`: tenant 771 retornou somente id 1001; tenant 882 retornou somente id 2002; repetido separadamente para cada uma das quatro tabelas.

A reversão física foi executada em transação com `DROP POLICY`, `NO FORCE`, `DISABLE RLS`, `REVOKE SELECT` em cada tabela, `REVOKE USAGE` no schema e `DROP TABLE` dos 11 objetos seguido de `DROP SCHEMA`. Consulta final confirmou **0 schemas, 0 tabelas e 0 policies** no namespace `alt088_operational_ci`.

**Limite da prova:** leitura de auth/entitlements foi feita por consulta SQL de fixture com role de administração no mesmo banco; o teste direto foi via conector PostgreSQL, não o aplicativo HTTP nem o driver Node WebSocket. O passo automatizado ALT-08.8 do workflow manual permanece sem resultado até ser disparado e verificado no HEAD exato; não alegar autenticação operacional completa.
