# ALT-08.10C.38 — Neon HML operacional isolado (executado)

**Data:** 2026-11-14. **Autorização:** proprietário solicitou expressamente criar a infraestrutura operacional para homologação. **Ambiente:** apenas nova branch filha e nova database do projeto Neon de CI VIGIAPLUS. **Não é produção.** Não houve merge da PR, deploy Next.js, alteração da branch Neon main, dados reais, cobrança ou ativação de rotas.

## Inventário real Neon

| Campo | Valor |
| --- | --- |
| Projeto Neon | `still-heart-81001946` — `vigiaplus-alt083-ws-ci` |
| Parent branch (inalterada) | `br-winter-breeze-bbcj1vxm` — `main` |
| Nova branch HML | `br-ancient-smoke-bbl8rbm3` — `vigiaplus-hml-operational-20261114` |
| Database nova | `vigiaplus_hml_20261114` |
| Owner | `vigia_alt083_ci_20261112_owner` (administrativa, **BYPASSRLS**) |
| PostgreSQL | **18.7** (`server_version_num=180007`) |
| Checkpoint branch | `br-soft-fire-bbvvesma` — `vigiaplus-hml-c38-checkpoint-20261114`, **sem compute** |
| URL Neon | https://console.neon.tech/app/projects/still-heart-81001946/branches/br-ancient-smoke-bbl8rbm3 |

O Neon não aceitou `create_snapshot` em branch filha (HTTP 400, `not allowed to snapshot non-root branch`). Foi criada uma branch descendente *copy-on-write* sem compute como checkpoint do estado HML. **Isso não equivale a backup físico, PITR, pg_dump ou plano de recuperação operacional certificado**; não confundir com as provas de restore C.37 exclusivamente no CI PostgreSQL descartável.

## O que foi criado

1. Nova branch de homologação baseada em `main`, sem dados de clientes.
2. Nova database isolada e inicialmente vazia.
3. Baseline SQL `schema/operational-bootstrap/00001_legacy_snapshot.sql` na íntegra, verificado contra o manifesto Git blob `068db8eaf3f6dc4ad7fbcf5014ffe687d077ae15`: **186 statements, uma única transação**. Tabela de compatibilidade `mentions` recebe um `UPDATE` sem registros em DB vazia. Verificado no `pg_catalog`: **62 tabelas, 128 índices, 57 FKs** no baseline.
4. Criada role de prova `vigia_hml_reader_20261114` **NOLOGIN, NOBYPASSRLS, NOSUPERUSER**, sem DDL/DML, com `SET ROLE` concedido apenas ao owner administrativo para testes. `USAGE` do schema para a role; `REVOKE USAGE ON SCHEMA public FROM PUBLIC` no banco HML, sem alterar outros bancos.
5. Quatro policy SELECT `hml_tenant_select` + `ENABLE/FORCE ROW LEVEL SECURITY`, com **fail-closed sem `app.tenant_id`** e SELECT apenas nas colunas abaixo. Não foi aplicada `migrations/00002_rls.sql`: sua semântica permite acesso sem contexto de tenant, inadequada para identidade cliente.
6. `public.vigiaplus_hml_schema_receipts` criada somente para auditoria: registra code head SHA `4ef54af26baae531f0ae0363eed2b890d8bf759c`, Git blob do baseline, contagem de 186/62/4 e `production_ready=false` imutável por CHECK.

| Tabela protegida | Colunas autorizadas para reader |
| --- | --- |
| `reputation_targets` | `id, name, kind, score` |
| `incidents` | `id, title, status, severity` |
| `notification_channels` | `id, channel, active, verified` |
| `invoices` | `id, amount_brl, status, due_at` |

**Atenção:** as outras 58 tabelas do baseline ainda não têm policies RLS HML; a role de teste **não tem privilégios para lê-las**. Nenhuma aplicação foi apontada ao novo banco. Nunca conectar o backend usando a role owner com `BYPASSRLS`: é identidade administrativa e ignora RLS na prática.

## Evidência de teste direto no Neon

No PostgreSQL 18 real da nova database, em uma transação com dados fictícios:
- Inseridos temporariamente tenants `910101` (A) e `910202` (B), uma linha por tenant em cada uma das quatro tabelas; não foram usados dados de clientes.
- Sob `SET LOCAL ROLE vigia_hml_reader_20261114`, com `SET LOCAL app.tenant_id='910101'`, somente os IDs `99101` ficaram visíveis; com `910202`, somente os IDs `99202`. **8/8 verificações de leitura isolada**.
- Com tenant vazio, as quatro tabelas retornaram **zero linhas (4/4)**.
- Privilegios para `INSERT`, `SELECT` em `memberships` e `invoices.pix_copia_cola`: **falsos**.
- `RESET ROLE` para owner; tenants e dependências sintéticas foram excluídos antes do COMMIT. Snapshot subsequente: **0 tenants**, 63 tabelas incluindo recibo, 129 índices incluindo PK do recibo, 57 FKs, 4 policies, 4 tabelas FORCE RLS, role NOLOGIN/NOBYPASSRLS e PUBLIC sem USAGE do schema.
- O primeiro teste usou `COUNT(*)`, negado por ACL de **SELECT somente por coluna**. Nenhuma permissão foi ampliada; o teste corrigido `COUNT(id)` passou. O teste com erro sofreu rollback automático e não deixou dados órfãos.

O arquivo `schema/operational-homologation/alt0810c38-neon-hml-baseline-wave1.sql` versiona a parte posterior ao snapshot em formato **HML-only**, com guard contra database errada, sem senhas. Não executar contra main/prod e não reaplicar ao banco atual (role já existe).

## Gates ainda necessários para aplicação real

- Auditar e versionar políticas por tabela e papel para `users`, `memberships`, `tenants`, `subscriptions`, `tenant_features`, `plan_features`, `projects`, `mentions`, jobs, pagamentos, tokens e demais dependências. Cobrir permissões de escrita, revogação de sessão, isolamento, webhook e workers.
- Criar identity de conexão **LOGIN NOBYPASSRLS** com grants mínimos, segregando admin, cliente e serviços, em procedimento revisado e com gestão segura de segredos. O owner HML atual não pode ser usado como role de runtime cliente.
- Testar as **rotas Next.js reais** apontando explicitamente para a database HML, com autenticação HTTP, memberships/entitlements, sessões e RLS em conexão PostgreSQL transacional. Não alterar .env, CI secrets ou deploy automaticamente.
- Homologar backup/PITR real do ambiente operacional somente após aprovação de plano específico; checkpoint Neon copy-on-write não substitui backups protegidos e testados.
- Executar auditoria independente de migrations `schema/operational-bootstrap` vs. modelo Drizzle; o manifesto original é `snapshot-only-no-migration-authorization`, e a presente homologação não revoga a restrição para produção.

**Situação:** HML provisionada + wave 1 RLS e isolamento A/B real validados. **Produção NO-GO**. PR #36 permanece OPEN DRAFT, sem merge ou deploy.
