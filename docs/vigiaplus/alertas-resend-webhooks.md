# VIGIAPLUS — ALT-06 · Reconciliação da entrega de e-mails Resend

**Implementação candidata em PR DRAFT.** Não enviar e-mails reais, instalar segredos ou aplicar migração em PostgreSQL de produção sem aprovação do proprietário.

## Arquitetura

```text
worker outbox → POST /emails Resend (2xx + provider_message_id)
                      │
                      └─────→ notification_deliveries
                                 status='sent'        [aceito HTTP]
                                 delivery_state       [resultado externo]
                                        ▲
Resend → POST /api/webhooks/resend ──┐   │
      svix-id, timestamp, signature  ├─ assinatura raw-body
                                    ├─ notification_provider_events (UNIQUE webhook_id)
                                    ├─ correlação provider_message_id + destinatário
                                    └─ estado/horário + código sanitizado
```

A requisição pública é admitida pelo proxy **somente para o caminho exato** `/api/webhooks/resend`; isso não equivale a permissão de escrita. A rota exige `RESEND_WEBHOOK_SECRET` (`whsec_...`), valida HMAC-SHA256 Svix sobre o **corpo cru**, ID e timestamp com janela de 5 minutos e comparação resistente a tempo. Tamanho máximo 64 KiB. Sem segredo, devolve 503; sem assinatura, 401; em `DEMO_MODE=1`, 403. Nenhum log grava token, cabeçalho, payload integral ou texto de bounce.

**Eventos consumidos:** `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`. Outros webhooks são ignorados e respondidos com 200, sem mutar estado.

## Modelo e identidade

Migração aditiva:
- Em `notification_deliveries`: `delivery_state` (padrão `unconfirmed`), `delivery_state_at`, `delivered_at`, `delivery_failure_code`; `status` e `sent_at` permanecem os indicadores **internos** de envio aceito.
- Em `notification_provider_events`: `webhook_id` com UNIQUE, ID da mensagem, destinatário normalizado, tipo, horário do evento, ID de entrega vinculada (nullable) e horário de recebimento. Não armazenar o corpo inteiro nem mensagens de erro com PII.
- Índice de busca por `provider_message_id` e eventos não conciliados.

A assinatura é verificada **antes de desserializar JSON**, e somente `data.to` com exatamente um destinatário é usado. O match exige **ID da mensagem e e-mail normalizado**, e exige exatamente uma linha de entrega compatível. Eventos sem correspondente ficam no ledger como órfãos e podem ser conciliados quando a resposta HTTP registrar o ID. Retentativas repetidas do mesmo `svix-id` são idempotentes e podem refazer a conciliação após crash.

**Importante:** a Resend passou a enviar um evento por resultado de destinatário em 22/01/2026 (campo `to` continua array). Não relacionar eventos apenas por e-mail nem apenas por `tenant_id`. O tenant decorre da entrega identificada, nunca do corpo recebido.

## Estado, concorrência e prevenção

- `accepted` **não é** `delivered`. O status externo muda para `delayed`, `delivered`, `bounced`, `complained`, `failed` ou `suppressed` apenas com evento verificado.
- A prioridade é monotônica: reclamação > falha/bounce/suppress > entregue > atraso > aceito. Um atraso recebido depois da entrega não regride o estado. Em mesma prioridade, vence o evento mais recente.
- A conclusão do worker não sobrescreve estado terminal do webhook; um reprocessamento manual limpa o ID antigo e o estado externo para a próxima tentativa, preservando o ledger histórico.
- Bounce, complaint ou suppression desativam o canal **somente do mesmo tenant e destino correspondente**, impedindo novos envios até revisão.
- Se o provedor aceitar o envio e o processo cair antes de persistir o ID, não há como garantir exactly-once absoluto sem estratégia externa de idempotência; a chave Resend da PR #33 ajuda nas tentativas dentro da janela oficial.

## Visibilidade no proprietário

`GET /api/console/notifications?tenant_id=N` requer owner e retorna estado externo, horário, `deliveredAt` e código de falha normalizado. Em **Admin → Alertas e crises**, as colunas **Fila** e **Entrega pelo provedor** deixam claro o que está aceito, em atraso ou entregue; atualização manual, sem polling.

## Testes e gates

A suíte de PGlite testa verificação HMAC, tolerância, corpo adulterado, replay, mensagens iguais em paralelo, isolamento de dois tenants e destinatários, órfãos antes do aceite, atraso após entrega e bounce/complaint com desativação. Teste de rota cobre segredo ausente, assinatura inválida, demo bloqueada e path público restrito. Não há conexão Resend real.

**Pendente antes de marcar ALT-06 concluído:** CI GREEN do SHA exato, verificação de assinatura com endpoint Resend real em ambiente de homologação, teste externo de entrega/atraso/bounce controlado, registros de entrega e auditoria de prazo, retenção LGPD dos metadados e política RLS para o ledger (tenant derivado de delivery_id). Nenhuma migração remota, merge ou deploy.

**Documentação oficial:** https://resend.com/changelog/webhook-event-visibility ; https://resend.com/features/webhooks ; https://docs.svix.com/receiving/verifying-payloads/how
