# VIGIAPLUS — mapa técnico operacional

**Estado:** arquitetura observada em código e gates (não é certificação de produção). **Atualização:** 2026-11-12.

## Camadas e fluxo

```text
Browser (owner / analyst / client_admin / client_viewer)
   -> Next.js app/api/** e páginas
       -> lib/session.ts (HMAC cookie; verifySession só firma)
       -> lib/session-auth.ts e lib/auth.ts (usuário + session_version DB)
       -> lib/tenant/context.ts (tenant da membership; owner tem exceções auditadas)
       -> lib/tenant/entitlements.ts + contratos (status, plano, feature)
       -> lib/db.ts (getDb; caminho operacional atualmente neon-http / PGlite)
       -> dados tenantizados / workers / alertas
   [PILOTO CI/STAGING — NÃO PRODUÇÃO]
       -> lib/tenant/neon-rls-adapter.ts (WebSocket/pool)
       -> lib/tenant/rls-transaction.ts (BEGIN, SET LOCAL tenant_id, COMMIT/ROLLBACK)
       -> PostgreSQL RLS + roles sem BYPASSRLS
```

Não interpretar a rota `app/api/app/evidence/route.ts` com opt-in de CI como troca global de driver. `resolveTenantContext()` e o fluxo principal `getDb()` ainda precisam de homologação Next + PostgreSQL no mesmo domínio de dados.

## Contratos de dados centrais

- Identidade: `users` (inclui `global_role`, `session_version`, `must_change_password`), `memberships` (usuário, tenant, papel), `tenants`.
- Comercial: `plans`, `plan_features`, `tenant_features`, `subscriptions`, `invoices`.
- Dados de vigilância e crise: `projects`, `mentions`, `reputation_targets`, `incidents`, `notification_channels`.
- Serviço operacional: scheduler/coleta 1 cliente a cada 15 minutos, outbox de alertas, entregas, retries, webhooks e logs, sujeitos à homologação.
- Autorização: `client_admin` e `client_viewer` escopados; `owner`, `analyst`, `worker`, `webhook` requerem contratos separados. Nenhuma role global implica SELECT cross-tenant diretamente no banco de cliente.

## Fronteiras de confiança

1. Cookie HMAC é pré-filtro: é preciso conferir usuário e versão da sessão contra DB em cada autenticação.
2. O request nunca determina `app.tenant_id`; tenant vem da membership/identidade autenticada e autorização contextual.
3. Membership não equivale a entitlement: contrato, feature, status e limites são checados no servidor.
4. RLS é defesa adicional; GUC customizada **não** protege contra SQL arbitrário. Queries fixas e parametrizadas com menor privilégio são mandatórias.
5. Staging Neon `vigia_alt086_staging_20261112` é isolado: testes sintéticos ALT-08.7 a 08.9 executaram, limparam seus schemas; não comprovaram o schema operacional integral.
6. `AGENTS.md` é o contrato de colaboração; `TODO.md` e `docs/engineering/CHANGE_PROTOCOL.md` definem gate e evidência.

## Sistemas externos e pendências

Stripe/Pix, Resend, APIs de coleta (GDELT/Google News), provedores OpenAI-compatible e alarmes requerem configurações por ambiente e testes reais controlados. Nunca exibir como “operacional” com base em mocks, status HTTP de aceite ou interface visual.

## Próximo gate

ALT-08.10 — validar rota Next.js real com auth/membership/entitlements no mesmo banco de staging e matriz de papéis, incluindo expiração/revogação e rollback de baseline preexistente. `main`/produção NO-GO sem autorização.
