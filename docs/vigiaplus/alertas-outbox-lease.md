# VIGIAPLUS · ALT-02 · Outbox de alertas com lease e retry

**Situação:** implementação candidata em PR DRAFT; somente testes isolados, sem comunicação com destinatários reais e sem migração de banco remoto.

## Máquina de estados

```text
queued ──claim──> processing ──HTTP 2xx──> sent
                     │
                     ├─falha; tentativa < 5──> retry ──aguarda próxima execução──> processing
                     │
                     ├─falha; tentativa = 5──> dead_letter
                     │                              └─owner + motivo + audit──> queued
                     │
                     └─lease expirado ──outro worker reassume──> processing
```

- **queued:** pronto para envio. **processing:** posse temporária de um trabalhador. **retry:** aguarda horário de nova tentativa. **dead_letter:** revisão manual necessária.
- **sent** continua significando resposta de sucesso HTTP do transporte, **não prova de entrega** (o webhook de delivery/bounce é uma etapa posterior, ALT-06).
- Status `failed` do legado não é reprocessado automaticamente, para não gerar envio retroativo ou duplicidade sem conciliação.

## Segurança de concorrência

- Uma instrução PostgreSQL com `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` + `UPDATE ... RETURNING` reivindica a entrega, grava `lease_owner` aleatório e expiração em 60 segundos e incrementa `attempt_count`.
- Reserva **uma entrega imediatamente antes de cada envio**. A fila não reivindica 100 mensagens de uma vez para depois deixá-las expirarem durante o lote.
- Atualizar o resultado exige `id + lease_owner + attempt_count + status=processing + lease não expirado`. Um worker tardio não pode sobrescrever a conclusão de quem assumiu o lease.
- O transporte usa timeout HTTP de 10 segundos; lease de 60 segundos oferece margem. Se a resposta externa foi aceita mas o processo morreu antes de registrar, o reenvio após o vencimento do lease é possível. **Não alegar exactly-once do provedor externo** sem um mecanismo de idempotência ou confirmação adicional.

## Tentativas e recuperação

- Máximo **5 tentativas**, com backoff exponencial: **60, 120, 240, 480 segundos** para as tentativas 1–4; a falha da quinta tentativa leva a `dead_letter`.
- Cada erro do transporte é guardado sem token ou stack trace; o log interno mantém apenas estado e código HTTP quando aplicável.
- Leases expirados são recuperados na próxima execução; se o limite de tentativas foi atingido, a entrega vai para `dead_letter` sem novo disparo.
- O proprietário pode consultar a fila por cliente com `GET /api/console/notifications?tenant_id=N` e reprocessar uma `dead_letter` por `POST /api/console/notifications` com `tenantId`, `deliveryId` e `reason` (5–300 caracteres). A operação requer sessão owner, é proibida na demo e registra `NOTIFICATION_REQUEUED` **no mesmo SQL**; não altera a chave idempotente.

## Migração e limites

- Adicionam-se colunas `attempt_count`, `lease_owner`, `lease_expires_at`, `next_attempt_at` e `last_attempt_at` com `ALTER TABLE ADD COLUMN IF NOT EXISTS`; as linhas antigas são preservadas. Índice adicional para recuperar registros elegíveis.
- Nenhuma exclusão de dados, alteração de destino, nova credencial ou cobrança real.
- O worker `scripts/workers/notify.ts` continua disparando **uma passada** quando `npm run worker:notify` é executado. Agendamento autônomo confiável e monitoramento de SLA dependem de ALT-08.
- Testes PGlite executam substitutos de transporte, **nunca** Resend/Telegram reais; devem verificar dois workers concorrentes, retry, vencimento de lease, stale worker, dead letter, auditoria e impossibilidade de reprocessar outro tenant.
- Para liberar clientes: teste E2E com worker agendado, envio real controlado, confirmação externa, observabilidade e isolamento RLS/contrato continuam pendentes.

**Decisão:** preservar PR como DRAFT e não executar migração remota até aprovação expressa do proprietário.
