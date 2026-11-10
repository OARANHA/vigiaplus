# VIGIAPLUS — Integridade comercial P0 (2026-11-10)

## Escopo

Esta alteração cobre a persistência de planos contratados, permissões individuais e a trilha de auditoria. **Não habilita cobrança real, integrações financeiras nem coleta automática.**

## Invariantes verificados no PostgreSQL

1. `tenant_features (tenant_id, feature_key)`: no máximo um override por organização/capacidade, por índice UNIQUE `vpx_tenant_feature_unique`.
2. `subscriptions (tenant_id)`: no máximo uma assinatura com `status IN ('active', 'past_due')`, por índice UNIQUE parcial `vpx_subscription_live_unique`. Assinaturas antigas canceladas podem coexistir para histórico.
3. Somente proprietário autenticado pode alterar plano manual ou override. Contrato manual exige `manualApproval=true` e justificativa; não aciona Stripe/Pix.
4. Alteração comercial e evento de auditoria são executados no **mesmo comando SQL**, com CTEs `INSERT ... ON CONFLICT ... RETURNING`, `UPDATE ... RETURNING` e `INSERT INTO audit_events ... RETURNING`.
5. A aplicação **não reconcilia duplicatas automaticamente**. Se há duplicidades históricas, os índices correspondentes não são criados; a escrita falha com `COMMERCIAL_CONSTRAINT_PENDING` HTTP 409. Consultas continuam disponíveis para diagnóstico.

## Procedimento seguro de homologação

Em uma **cópia descartável** do banco:

- Rodar a suíte `npm test`, `npx tsc --noEmit`, `npm run build` e inspecionar `/console/admin?section=integridade` autenticado como owner.
- Verificar presença dos índices sem alterar dados:

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public'
  AND indexname IN ('vpx_tenant_feature_unique','vpx_subscription_live_unique');

SELECT tenant_id, feature_key, COUNT(*) AS duplicados
FROM tenant_features GROUP BY tenant_id, feature_key
HAVING COUNT(*) > 1;

SELECT tenant_id, COUNT(*) AS assinaturas_vigentes
FROM subscriptions WHERE status IN ('active','past_due')
GROUP BY tenant_id HAVING COUNT(*) > 1;
```

- Simular duas ativações manuais para o mesmo tenant: somente uma assinatura vigente; confirmar `tenants.plan_key`, `tenants.status` e `audit_events` coerentes.
- Simular pedido sobre contrato `gateway='stripe'` ou `'pix'`: HTTP 409 sem mudança de tenant, assinatura ou auditoria.
- Simular duas alterações da mesma capacidade: exatamente um `tenant_features` com histórico de dois eventos.
- Simular falha de banco na alteração: confirmar ausência de atualização parcial.
- Verificar que usuário sem `globalRole='owner'` não acessa a rota nem APIs.

## Duplicidade pré-existente

Se o diagnóstico encontrar duplicatas: **não executar DELETE automático**. Identificar cada registro, canal de pagamento, data, contrato e justificativa. Conciliar sob aprovação do proprietário, registrar a decisão e somente então criar os índices. O bootstrap tenta criar índices somente quando os dados já estão íntegros.

## Limitações restantes

- A trilha de auditoria de **edição de planos** ainda é inserida após o comando principal; sua atomicidade também deve ser tratada em etapa separada.
- Outras rotas de atualização de assinaturas (notadamente webhooks/dunning) devem ser integradas aos mesmos invariantes e testadas. PR #15 para conciliação financeira precisa homologação própria.
- Índice parcial protege contra concorrência de assinaturas vigentes; históricos legados não são reestruturados.
- A seleção e alteração de plano não garantem, por si sós, limites de menções e retenção em todos os coletores.
- PR #14 RLS e PR #11 scheduler ainda requerem integração/homologação.
- Sem autorização, **nenhum merge/deploy/migração de ambiente remoto**.
