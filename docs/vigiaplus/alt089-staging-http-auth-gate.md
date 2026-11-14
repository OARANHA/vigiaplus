# ALT-08.9 — HTTP assinado + Neon staging (harness isolado)

## Escopo implementado

`scripts/tests/alt089-staging-http-auth-e2e.ts` é um **servidor HTTP Node temporário de teste**, com requisições `fetch()` reais e cookie `sr_session` emitido/verificado por `signSession` e `verifySession` do próprio código VIGIAPLUS (`lib/session.ts`), **não é a rota Next.js operacional**.

A aplicação Next mantém `getDb()` e `resolveTenantContext()` sem substituição. O harness efetua as leituras de sessão, vínculo, assinatura, plano e entitlement **diretamente no mesmo banco Neon staging isolado**, de modo representativo. SQL usa parâmetros; tenant vindo da membership validada, nunca da query `tenant_id`.

## Ambiente e isolamento

Neon project `still-heart-81001946`, branch `br-super-star-bbc317wq`, banco `vigia_alt086_staging_20261112`. Exclusivamente schema sintético `alt089_http_ci` (nenhuma tabela `public`, nenhuma migração operacional). Migração por role `vigia_alt083_ci_20261112_owner`, leitura RLS por `vigia_alt087_staging_reader` sem BYPASSRLS.

No início: exige CI/GITHUB_ACTIONS, `NODE_ENV!=production`, `DATABASE_URL` ausente, `VIGIA_RLS_MODE=ci-experimental`, confirmação `ALT089_STAGING_CONFIRM=SIGNED_HTTP_SYNTHETIC_ONLY` e URLs no mesmo host Neon, com banco e papéis exatos. O namespace reservado deve estar ausente (fail closed).

O schema de fixture tem 7 tabelas: `users`, `memberships`, `plans`, `plan_features`, `subscriptions`, `tenant_features`, `incidents`. O migrador popula tenants sintéticos 771/882, usuários 101/102 clientes, 103 viewer, 104 owner, 105 analyst, e policy `SELECT` por `app.tenant_id`, com grant somente para colunas `id,title` da tabela `incidents`.

## Testes HTTP pretendidos

- GET sem cookie e com cookie inválido → 401.
- Cookie assinado A e tentativa `?tenant_id=882` → apenas tenant 771 / incidente 1001.
- Cookie assinado B e tentativa `?tenant_id=771` → apenas tenant 882 / incidente 2002.
- Owner e analyst sem contrato cliente → 401 (bloqueio, **não homologação de acesso positivo**).
- Usuário A: incremento de `users.session_version` no **mesmo banco** revoga o cookie anterior; cookie com versão atual permite.
- Desabilitar `tenant_features` do tenant A no mesmo banco invalida consulta, sem afetar B.
- Cancelar `subscriptions` B invalida consulta de B.
- Rollback reversível: `DROP POLICY`, disable/NO FORCE, `REVOKE` de colunas/schema, remoção dos sete objetos e do namespace. Exige catálogo pós-rollback **0 schemas/0 tabelas/0 policies**.

## Condição para GREEN

O teste é executado **somente** por `workflow_dispatch` em `.github/workflows/alt083-neon-e2e.yml` com os mesmos dois secrets dedicados do staging. Para afirmar ALT-08.9 GREEN exigir run, SHA e **step ALT-08.9 concluído com sucesso** e logs com mensagem `ALT089 STAGING HTTP` e `ALT089 STAGING: explicit reverse migration`.

## Limitações e NO-GO

Esse ensaio autentica cookies por código real e consulta memberships/entitlements e RLS no mesmo PostgreSQL via HTTP real, mas **não exercita** `app/api/app/evidence/route.ts`, `resolveTenantContext` ou `authenticateSession` do Next diretamente, nem o schema integral da produção. Não autentica positivamente owner, analyst, worker ou webhook: todos permanecem NO-GO na superfície cliente; exigem contratos e papéis de serviço específicos. Verificação de múltiplos memberships, vigência/grace, revogação de membership, políticas de escrita e rollback de objetos preexistentes também ficam pendentes.

**PR DRAFT; não merge, não deploy, nenhuma alteração de produção.**
