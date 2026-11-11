# ALT-01 — Deduplicação multicanal e concorrência (candidata)

**Escopo:** envio de notificações por múltiplos destinatários, sem alterar nem excluir o histórico. **Status:** código em PR DRAFT, homologação por CI/banco local antes de liberar produção.

## Falha anterior

A chave era `rule:<id>:fact:<kind>:<id>:dia:<UTC>`, igual para qualquer canal e endereço. O planejamento descartava silenciosamente o segundo e-mail do mesmo canal e a fila verificava existência por `SELECT` antes de executar `INSERT`, permitindo corrida de dois workers.

## Contrato novo da chave

`v2:<SHA-256(JSON.stringify([ruleId, factKind, factId, dayUtc, channel, destination]))>`

- `channel` é normalizado para minúsculas; `destination` recebe trim; e-mails passam a minúsculas, outros destinos preservam caixa porque podem ser sensíveis a maiúsculas/minúsculas.
- O identificador persistido **não contém o destinatário em texto claro**.
- O índice UNIQUE existente `notification_deliveries_dedupe (tenant_id,dedupe_key)` continua sendo a proteção no banco. O `INSERT ... ON CONFLICT DO NOTHING RETURNING id` agora decide atomicamente qual worker enfileirou.
- A mesma regra e fato no mesmo dia gera uma entrega por canal **e destino**. Outro tenant tem escopo independente pelo índice.

## Compatibilidade sem migração destrutiva

As linhas pré-existentes conservam a chave antiga. O planejador fornece temporariamente `legacyDedupeKey` (somente na memória), e a fila verifica se já existe a entrega histórica correspondente ao **mesmo canal e mesmo endereço canônico**. Se existe, **não duplica**. Para outro destinatário, a fila grava uma nova chave v2. Não há `DELETE`, `TRUNCATE`, reescrita de dados ou disparo retroativo de envio no processo de atualização.

**Limitação assumida:** uma linha antiga só prova o histórico de **um** destinatário. A versão anterior pode ter perdido tentativas de outros endereços, portanto esses novos destinatários podem receber o fato do dia ao executar novamente o worker. A aceitação de HTTP 2xx pelo provedor não prova entrega final, e o status `sent` atual exige mudança separada no ALT-06.

## Aceite por teste

- 2 e-mails e 1 Telegram geram 3 linhas e 3 chaves.
- 3 reexecuções/concorrências deixam apenas 3 linhas por cliente (índice UNIQUE).
- Dois clientes podem receber o mesmo fato sem colisão.
- Um registro legado `sent` é preservado, não reenviado para o mesmo endereço, enquanto os dois outros destinos recebem suas primeiras entradas.
- Não usar credenciais Resend nem Telegram neste teste: verifica-se **enfileiramento**, não entrega.

**Ainda pendente:** ALT-02 (reserva exclusiva de worker, lease e retry), ALT-04/06 (e-mail real e prova de entrega) e gate completo de alerta ao cliente.
