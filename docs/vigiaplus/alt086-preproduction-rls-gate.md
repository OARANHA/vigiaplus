# ALT-08.6 — gate de pré-produção: papéis, rollback e runtime RLS

**Estado:** contratos e ensaios locais de CI preparados. **Homologação em pré-produção real PENDENTE. Produção NO-GO.**

## 1. Fronteiras verificadas

- A aplicação principal continua usando `getDb()` / Drizzle / `neon-http`. Esse runtime **não está certificado** para transportar `SET LOCAL` em uma transação interativa; os testes não o substituem.
- O piloto `/api/app/evidence` experimenta WebSocket somente sob as flags de CI da ALT-08.4, com sessão assinada, autorização de cliente e SQL fixo. Nunca é ativado em produção.
- `client_admin` e `client_viewer` são os únicos papéis elegíveis **para leitura**, exclusivamente na superfície `app`, `system=false`, `userId` positivo e `tenantId` validado da sessão/membership. `owner`, `analyst`, `worker` e `webhook` estão **explicitamente bloqueados** no contrato candidato. Não alegar homologação dessas superfícies.
- O teste `tests/todo-alt086-preproduction-gate.test.ts` rejeita troca de superfície, identidades sem tenant, contextos internos, URLs de DB remoto e `NODE_ENV=production`. O teste `tests/todo-alt086-transaction-contract.test.ts` verifica `BEGIN`, `SET LOCAL`, `COMMIT`, `ROLLBACK` e release da conexão, inclusive com falhas injetadas.
- ALT-08.5 já verificou no PostgreSQL efêmero grants mínimos **por coluna**, RLS A/B, bloqueio de escrita e rollback independente nas quatro tabelas. ALT-08.4 validou fluxo HTTP real de leitura de evidências, mas usando Neon descartável e PGlite local para sessão/entitlements.

## 2. Matriz de autorização pendente de pré-produção

| Ator | Leitura tenant | Escrita tenant | Leitura carteira | Estado |
| --- | --- | --- | --- | --- |
| client_viewer | Somente tenant autenticado, colunas aprovadas | NEGADA | NEGADA | Contrato candidato; integração operacional pendente |
| client_admin | Somente tenant autenticado, colunas aprovadas | NEGADA na Wave 1 | NEGADA | Contrato candidato; políticas de escrita separadas |
| analyst | NEGADA no piloto RLS | NEGADA | NEGADA | Exige vínculo/carteira e auditoria |
| owner | NEGADA no piloto RLS | NEGADA | NEGADA | Exige seleção auditada e modelo próprio, não usar BYPASSRLS |
| worker | NEGADA | NEGADA | NEGADA | Exige identidade de serviço com operações limitadas |
| webhook | NEGADA | NEGADA | NEGADA | Exige autenticação de provedor e idempotência |

## 3. Protocolo de staging real — ainda NÃO executado

1. Obter instância de **pré-produção explicitamente identificada**, dedicada ao VIGIAPLUS, **nunca** reaproveitar base de produção ou outros projetos. Provisionar role sem SUPERUSER/BYPASSRLS e sem ownership das tabelas, TLS e credenciais distintas. O pipeline normal não pode acessar credenciais de staging.
2. Criar snapshot/backup verificável, registrar o nome do banco/branch, commit SHA do código e um manifesto das tabelas: `relrowsecurity`, `relforcerowsecurity`, policies completas `pg_get_expr` / `pg_policies`, ACLs por tabela e coluna, roles, owner, default privileges, dependências e checksum do esquema.
3. Executar um *preflight* somente leitura: falhar diante de tabelas ausentes, políticas desconhecidas, roles privilegiadas, grants herdados via `PUBLIC`, ou diferenças de schema. Nunca assumir que rollback é simplesmente `DISABLE RLS` ou `DROP POLICY`.
4. Aplicar uma tabela por vez em **transação de migração controlada**, com bloqueio contra DDL concorrente, grants mínimos por coluna, `FORCE ROW LEVEL SECURITY`, política específica e testes em sessão não privilegiada. Não usar o usuário owner para testar isolamento.
5. Em pool WebSocket transacional real, provar `BEGIN` → `set_config('app.tenant_id', ..., true)` → SQL parametrizado → `COMMIT` ou `ROLLBACK`, com conexão pinada e limpeza em cada reutilização. Testar A→B→A, concorrência, timeout, falha de SQL, queda de conexão, tentativa de trocar tenant via URL/cabeçalho e papel sem contexto. Inspecionar também regras de `tenant_id` em projeto pai.
6. Provar integração **end-to-end** do runtime autenticado e banco operacional de staging: memberships, planos e entitlements, projeto/evidência, grupos de usuário, PII, logs e trilhas auditáveis. Nenhuma query secundária da rota pode escapar da conexão escopada.
7. Testar rollback **individual por tabela** usando manifesto anterior, sem revogar permissões preexistentes ou apagar policies antigas; conferir igualdade de catálogo após reversão, ausência de dados modificados e funcionamento das rotas legadas.
8. Testar canário com cliente sintético, erro deliberado de migração e recuperação; documentar latência, conexões, lock, métricas de 401/403/500 e sinais de vazamento; proteger contra SQL arbitrário que possa forjar `app.tenant_id`.
9. Gerar relatório com SHA exato, run, logs de A/B, snapshot/rollback restaurado, comparação ACL/policies, responsáveis pelo aceite e duração. **Somente após revisão humana e autorização explícita** abrir gate de deploy.

## 4. Restrições de implementação

- `lib/tenant/rls-preproduction-gate.ts` é **apenas uma política declarativa de CI**. Não fornece credenciais, não executa DDL nem concede acesso novo.
- SQL/roles da ALT-08.5 são **dados de teste** e não migrações aplicáveis a instâncias com políticas anteriores.
- Testes do novo gate rodam em `tests/*.test.ts` no job `build`; **nenhum segredo Neon é necessário**.
- A execução de pré-produção **não está autorizada nem foi feita**; nenhum resultado de CI efêmero deve ser descrito como homologação do staging real.

**Critério de avanço:** CI GREEN no HEAD da PR #36 confirma somente a preparação contratual; homologação em staging e produção seguem NO-GO até aprovação específica.
