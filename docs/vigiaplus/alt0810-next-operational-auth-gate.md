# ALT-08.10 — homologação do Next.js real com identidade e dados no mesmo Neon staging

**Status:** IMPLEMENTAÇÃO PARCIAL DO CONTEXTO NEXT; HOMOLOGAÇÃO OPERACIONAL PENDENTE. Produção NO-GO. PR #36 DRAFT.

## Hipótese a provar

O caminho autenticado da **aplicação Next.js real** (não o harness HTTP de ALT-08.9) confere cookie assinado, existência do usuário e `session_version`, membership, role, status tenant, assinatura/feature e limites no **mesmo banco operacional de staging**, e só então consulta dados tenantizados por papel PostgreSQL de menor privilégio e transação RLS.

## Prerequisitos não negociáveis

1. Staging isolado criado e reconhecido, sem usar branch de produção. Snapshot do baseline, schema operacional e ACL/policies existentes, mais rollback reproduzível.
2. `users`, `tenants`, `memberships`, `subscriptions`, `plans`, `plan_features`, `tenant_features` e tabelas operacionais existentes no **mesmo banco**, com migrações controladas. Não confundir namespace de fixture da ALT-08.9 com schema real.
3. Roles distintas: migrator DDL, autenticador limitado, client reader, owner/analyst especializados, worker e webhook com identidade e permissões próprias. Proibir owner de DB como reader de segurança.
4. Desligado por padrão: flag experimental exclusiva de CI/staging com validação fail-closed de host/db/role; nunca substituir globalmente `getDb()` sem ADR, rollback e aprovação.
5. Rotas Next instrumentadas em teste HTTP real: login, troca senha/revokeAll, `/api/app/evidence`, exports, client-admin, owner-portfolio e integrações de serviços, com cookies e dados de dois tenants e múltiplos memberships.

## Casos mínimos de aceitação

| Caso | Esperado |
|---|---|
| A lê A, B lê B (HTTP) | 200 + apenas registros do respectivo tenant |
| A força query/header de B, ou usa IDs cruzados | 403 ou escopo original, jamais vazamento |
| Cookie HMAC alterado / sessão revogada / usuário deletado | 401 |
| `must_change_password=1` | APIs de negócio negadas |
| Membership removida ou tenant suspenso | 403/401 imediato |
| Assinatura vencida/cancelada, feature desabilitada | dados empresariais negados; contas/faturas conforme contrato explícito |
| Usuário com duas memberships | seleção explícita autenticada; nenhuma escolha arbitrária da primeira membership |
| Client reader usa SQL direto | RLS impede cruzamento; PII/UPDATE negados |
| Owner / analyst | permitir apenas fluxos positivos especificados, auditados e com role própria (não client reader) |
| Worker / webhook | identidades de serviço autenticadas e escopos mínimos por tenant/job |
| Rollback por tabela | restaura **ACL/policies preexistentes**, não apenas schema sintético 0/0/0 |
| Falhas de pool, transação e auth | sem fallback para DB sem RLS; sem tenant leak |

## Sequência de implementação

1. Inventariar `getDb()`, `authenticateSession`, `getCurrentUser`, `resolveTenantContext`, `requireFeature`, todas as rotas e os pontos de troca de driver.
2. Especificar adapter de sessão/autorização com contratos testáveis e leitura operacional segura dentro de uma unidade de confiança.
3. Criar schema operacional de staging (apenas banco isolado) e migrações reversíveis com snapshot de policies, ACLs e dependências.
4. Implementar teste HTTP do **servidor Next** no workflow manual com casos A/B, revogações e papéis de serviço.
5. Executar CI do SHA exato, workflow de homologação manual e registrar logs/rollback no `TODO.md`, docs e ELUS Memory.

## Não fazer

Não declarar que ALT-08.9 já homologou Next.js; não ativar RLS em produção, trocar `getDb()` globalmente, usar banco do usuário, enviar notificações ou fazer merge/deploy sem autorização explícita.

## Incremento ALT-08.10A — seleção de tenant por membership (2026-11-12)

Implementado em `lib/tenant/authorized-membership.ts`, integrado ao **resolver real** `lib/tenant/context.ts` e coberto por `tests/todo-alt0810-authorized-membership.test.ts`.

- Antes, a consulta `db.select().from(memberships).where(userId)` tomava a primeira linha arbitrária e podia atribuir um tenant não escolhido a uma conta com dois ou mais vínculos.
- Agora, **zero vínculos** → 403; **um vínculo** → tenant autenticado (tentativa de selecionar outro tenant é registrada como spoof, sem conceder acesso); **múltiplos vínculos** → exigência de tenant explicitamente selecionado e comprovadamente presente na membership do usuário; sem escolha ou escolha não autorizada → 403; vínculos duplicados, tenant inválido ou papel inesperado → 403; ID inválido → 400.
- A mudança protege o ponto existente de criação de `TenantContext`, não troca a sessão, o transporte de DB ou o fluxo de pagamentos.
- **Limitação:** a seleção autenticada na UI para usuário multi-tenant ainda não foi desenvolvida; até lá o cliente multi-tenant sem seleção recebe 403 por segurança. Ainda não demonstra que todas as rotas consumam `TenantContext` corretamente.
- A prova RLS/HTTP operacional completa do restante desta especificação permanece aberta. Não classificar ALT-08.10 como GREEN por CI unitário.

**Pendente:** testar HTTP Next.js na aplicação real com DB operacional completo em Neon staging, matriz positiva dos serviços e rollback que preserve ACL/policies preexistentes.
