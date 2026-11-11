# ALT-03 — Anomalias analíticas → notificações rastreáveis

**Branch:** `feat/todo-alt03-analytic-alert-notifications-20261110` sobre a PR #31. **Status:** candidata não homologada até CI SHA exato e E2E do worker.

## Integração

```text
lib/alerts.ts
detectAlerts(projectId) → alerts(project_id, type, severity, data, created_at)
                             │
                             ▼
lib/notifications/analytics-facts.ts
  SELECT alerts INNER JOIN projects WHERE projects.tenant_id = tenant
  somente volume_spike/sentiment_drop das últimas 24h com métricas válidas
                             │
                             ▼
worker:notify → RuleInput + FactInput (analytics) → planDeliveries
                             │
                             ▼
enqueue (event_ref, source_project_id) → outbox ALT-01/ALT-02
                             │
                             ▼
API e UI proprietário: origem, projeto, destinatário, estado e tentativas
```

**Regras explicitamente opt-in:** `volume_pico` casa apenas `volume_spike`; `sentimento_queda` casa apenas `sentiment_drop`. São cadastráveis pela API de regras já existente; nenhuma regra ou destinatário é criado automaticamente. Sem regra ativa e canal verificado, nenhum aviso é enfileirado.

**Fato rastreável:** cada entrega nova grava `event_ref` como `analytics:<alertId>`, `incident:<incidentId>`, `billing:<invoiceId>` ou `reputation:<targetId>`. Somente análises têm `source_project_id`. A relação com o cliente vem obrigatoriamente do join `alerts.project_id → projects.tenant_id`; nunca do corpo da solicitação. Dados antigos recebem campos NULL, sem exclusão/recriação.

**Sem fatos fabricados:** volume só é elegível se o alerta persistido tiver `data.last24` e `data.avgDaily` numéricos; sentimento só com `avg24` e `avgPrev` finitos e queda constatada; linhas incompletas, antigas, futuras ou de outro tenant são ignoradas. O worker não chama IA e não executa `detectAlerts`; mantém a separação coleta/detecção/notificação.

**Sem reaviso na meia-noite:** para anomalia imutável a chave v2 usa o dia UTC de `alerts.created_at`, e não a data da execução do worker; reexecuções do mesmo fato em dias adjacentes mantêm a mesma chave. Outros fatos preservam seu comportamento de dedupe diário, pendente de revisão por tipo.

**Faturas:** status `open` não equivale a vencida. Somente status `open`/`overdue` com data civil de vencimento válida **anterior** ao dia da execução vira fato de cobrança; comparação UTC provisória, a correção para timezone do tenant continua no ALT-07.

## Critérios cobertos por testes PGlite

1. Dois tenants e dois projetos isolados; alerta do tenant B não entra nas notificações do tenant A.
2. Alerta de volume medido e sentimento medido geram fatos de tipos diferentes e a regra correta é aplicada a cada um.
3. Dois e-mails verificados geram duas entregas por anomalia; Telegram não verificado não recebe.
4. `event_ref` e `source_project_id` são persistidos; `dedupe_key` não expõe destinatários.
5. Reexecuções duplicadas e virada UTC não criam notificações extras.
6. Projeto sem anomalia e alerta incompleto ou antigo não geram notificações.
7. Faturas ainda não vencidas não viram `fatura_vencida`.

**Não comprovado:** a rotina real de detecção automática `detectAlerts` em toda fonte ativa, agendamento e SLAs, confirmação real por e-mail (ALT-04/06), RLS/entitlements completos e timezone do cliente (ALT-07). A PR permanece DRAFT; nenhum disparo real, merge, deploy ou DDL remoto foi autorizado.
