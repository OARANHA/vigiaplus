# Gateway RLS transacional — implementação preparatória

O driver padrão de \`getDb()\` continua sendo Neon HTTP e executando DDL/seed.
**Não existe homologação global de isolamento multi-tenant.**

O novo \`runInTenantScope\` usa um Pool WebSocket Neon separado por invocação
em produção, com \`TENANT_DATABASE_URL\`, transação interativa, \`SET LOCAL\`,
verificação de role (sem superuser/BYPASSRLS), dono da tabela e políticas de
RLS existentes. A operação é rejeitada sem credencial, transação ou política.

Este caminho não executa \`getDb()\` e por isso não executa DDL nem seed com a
role restrita. Para desenvolver localmente com PGlite, mantém-se o driver
embutido. Não foi criado ou aplicado usuário, policy ou migration no banco real.

## Próxima homologação obrigatória

1. Criar role PostgreSQL dedicada \`vigiaplus_app\` sem BYPASSRLS ou propriedade
   das tabelas, com grants mínimos e senha exclusiva (sem compartilhar OWNER).
2. Preparar nova migration versionada com policies default-deny para
   \`tenant_id\` e filhos ligados por \`project_id\` (sem \`OR current_setting IS NULL\`).
3. Testar em PostgreSQL descartável: duas contas/tenants, SELECT/INSERT/UPDATE/
   DELETE, joins/subqueries, escopo vazio, troca de escopo, concorrência.
4. Revisar TODAS as rotas e workers que ainda usam \`getDb\`: não podem acessar
   dados de clientes sem a transação restrita. A implantação continua NO-GO
   enquanto essa migração e os testes não existirem.
5. Fornecer \`TENANT_DATABASE_URL\` somente no backend, nunca NEXT_PUBLIC_.

Fontes: https://orm.drizzle.team/docs/connect-neon e
https://www.postgresql.org/docs/18/ddl-rowsecurity.html
