# ALT-08.10 — homologação do Next.js real com identidade e dados no mesmo Neon staging

**Status:** ESPECIFICADO / AINDA NÃO IMPLEMENTADO. Produção NO-GO. PR #36 DRAFT.

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
