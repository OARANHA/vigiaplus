# ALT-08.5 — Migração operacional RLS por ondas (PREPARAÇÃO, SEM ATIVAÇÃO)

**Estado:** desenho e testes no GitHub Actions descartável. **PRODUÇÃO: NO-GO.**
A aplicação operacional usa `getDb()` com Drizzle + `neon-http`, sem transação interativa com `SET LOCAL`. A homologação HTTP WebSocket ALT-08.4 ocorreu apenas num banco Neon isolado. Não copiar o SQL de CI nem os grants de CI para produção.

## Superfícies e grupos

| Grupo | Exemplos | Plano | Status |
| --- | --- | --- | --- |
| Escopo direto | `reputation_targets`, `incidents`, `notification_channels`, `invoices` | Wave 1: SELECT por `tenant_id` | Implementado em catálogo INERTE; ensaio em CI |
| Escopo direto mais sensível | `subscriptions`, `memberships`, `tenant_features`, `notification_deliveries`, `mcp_tokens` | Política própria por papel + minimização de colunas/destinatários | Bloqueado |
| Escopo herdado | `projects`, `mentions`, `collection_runs`, `alerts`, `reviews`, `reports`, `incident_actions` | Derivar tenant via FK verificada; não confiar em `project_id` enviado pelo cliente | `projects/mentions` somente ALT-08.4 experimental |
| Global, sistema e segredos | `users`, `plans`, `llm_providers`, `notification_worker_runs`, `audit_events`, `payment_events` | APIs de serviço específicas, role separada, não expor ao leitor | Bloqueado |
| Processadores | workers de notificações e dunning, webhooks, coleta, billing | Papel de serviço por operação, contratos idempotentes, escopo transacional, auditoria | Bloqueado |

### Wave 1 — implementação de preparação

`lib/tenant/rls-operational-wave1.ts` declara, **sem executá-las**, políticas `SELECT` exclusivas da role de teste `vigia_alt085_client_read_ci` para quatro tabelas com `tenant_id` direto. O catálogo inclui sequência de `GRANT SELECT`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` e `CREATE POLICY` por tabela, além de rollback inverso: `DROP POLICY`, `NO FORCE`, `DISABLE` e `REVOKE SELECT`.

**Esta role é apenas de CI; jamais adotá-la como role operacional sem um projeto separado de provisionamento.** Ela não tem `SUPERUSER`, `BYPASSRLS`, `CREATEROLE` ou `CREATEDB`, e recebe apenas `USAGE` de schema e `SELECT` da tabela sob prova. O teste `scripts/tests/alt085-operational-wave1-rls.test.ts` usa o PostgreSQL 16 iniciado pelo runner, nunca Neon; exige as variáveis de CI, `DATABASE_URL` vazio e nome de banco `vigia_alt081_ci`.

### Contrato do rollback por tabela

1. Antes de qualquer mudança, conferir **catalogação e baseline** de RLS, `FORCE`, policies existentes, grants, ownership e dependências. O ensaio se recusa a alterar tabelas que já tenham policies ou RLS.
2. Aplicar apenas UMA tabela e uma role por etapa. Não ativar RLS em tabelas lidas por rotas não migradas.
3. Verificar sob role não privilegiada: sem `app.tenant_id` => zero linhas; tenant A => somente A; tenant B => somente B; `UPDATE` negado; `SET LOCAL` não vaza.
4. Reverter a política e o grant exclusivos da tabela; confirmar zero policies novas e `relrowsecurity=false`, `relforcerowsecurity=false` e `has_table_privilege(...,SELECT)=false` porque o baseline de CI era desativado.
5. Falha no teste impede GREEN. Em ambiente pré-produção real, o rollback precisa restaurar o **baseline capturado**, não simplesmente desativar RLS. Não usar rollback CI contra tabelas que já tinham RLS.

### Gate operacional não satisfeito

- Criar configuração de conexão transacional WebSocket separada, com role sem `BYPASSRLS`; nunca usar conexão owner ou client-controlled claims.
- Provar que **todas** as queries operacionais da rota percorrem o contexto autenticado e transação em conexão pinada. O `tenant_id` passado pelo usuário não governa o SQL.
- Mapear autorização por papel: `owner` na carteira, `analyst`, `client_admin`, `client_viewer`, trabalhadores e webhook. Não transformar acesso global em bypass.
- Definir matriz de `SELECT/INSERT/UPDATE/DELETE` por papel, colunas PII, assinaturas, dados de cobrança, tabelas de alertas; implementar políticas próprias de escrita ou roles restritas.
- Eliminar ambiguidades de vínculo cliente, avaliar membership múltiplo, integridade `project_id`→`tenant_id`, referências cruzadas, GUC adulterável por SQL arbitrário e privilegio `PUBLIC`/grants herdados.
- Adicionar rollback com restauração de permissões/policies e sinais de saúde, canário por tenant e auditoria no ambiente pré-produção.
- Aprovação explícita do dono, revisão de migrations e homologação com snapshots antes de qualquer deploy.

**Separação garantida pela entrega ALT-08.5:** nenhuma integração desse catálogo com `getDb()`, jobs de migração, inicialização ou rotas HTTP. Nenhum banco operacional foi alterado. PR #36 segue DRAFT.
