# VigiaPlus — bloqueio e plano de ativação RLS

**Situação:** NO-GO para homologação de isolamento somente por RLS; o `migrations/00002_rls.sql` já existe, mas deixa o escopo ausente passar e a role proprietária da tabela pode ignorar a política.

## Mudanças deste ciclo

- `runInTenantScope` agora falha sem transação, nunca prossegue executando callbacks fora do escopo.
- `npm run security:rls-check` consulta SOMENTE o catálogo PostgreSQL com a conexão fornecida em `DATABASE_URL`, sem `getDb()` nem seed e sem alterar dados. Saída NO-GO quando detectar driver sem transação, role com bypass, tabelas sem RLS, políticas permissivas ou ausência de policy.
- **Não modifica a migration 00002 já possivelmente aplicada**; editar o arquivo quebraria o checksum registrado pelo migrador.
- Não instala uma política nova automaticamente, pois o runtime legado ainda acessa tabelas sem contexto RLS e bloquearia operações legítimas.

## Sequência obrigatória para promoção

1. Inventariar todas as queries e rotas, incluindo console global, jobs, MCP, billing, relatórios e subqueries de `incident_actions`; classificar permissões por papel e surface.
2. Preparar driver transacional de produção (Neon WebSocket/Pool, ou driver `pg`/Postgres.js) separado de credenciais de migração; atual `neon-http` não suporta transações interativas.
3. Definir papéis DB distintos: migrador proprietário com grants estritos; runtime `NOBYPASSRLS`, não proprietário das tabelas, com RLS aplicável.
4. Criar migration versionada **nova**, com policy **default-deny** quando `app.tenant_id` não estiver definido; exceção explícita e auditada para operações de carteira do proprietário sob role operacional separada, nunca um `OR IS NULL` global.
5. Integrar todas as operações por tenant a um executor transacional que faça `SET LOCAL app.tenant_id` e receba exclusivamente o `tx` para queries. Cobrir associações indiretas (`incident_actions`, `mentions`, `collection_runs`, `projects`) e auditoria.
6. Validar com banco PostgreSQL descartável, role real de runtime e pelo menos dois tenants: SELECT/INSERT/UPDATE/DELETE/joins/subqueries sem contexto devem negar; tenant A não lê/escreve B; proprietário só amplia escopo com auditoria.
7. Executar `npm run security:rls-check` e registrar resultado + SHA + versão/schema. O script atual **continuará NO-GO** até que o driver seja de fato migrado; atualizar a constatação de driver junto à alteração comprovada, nunca apenas por variável de ambiente.

**Nenhum merge/deploy/migration foi executado neste ciclo.**
