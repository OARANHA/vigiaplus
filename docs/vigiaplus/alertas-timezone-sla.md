# ALT-07 — Hora civil, silêncio, prioridade, SLA e controle de frequência

**Implementação candidata.** O código desta PR ainda depende do CI no SHA exato e de homologação de um worker agendado. Não realizar merge/deploy ou aplicar migração em PostgreSQL remoto sem autorização do proprietário.

## Configuração e governança

- O campo `tenants.time_zone` contém um timezone IANA, inicializado em `America/Sao_Paulo`, e pode ser alterado pelo proprietário. Cálculos passam por `Intl.DateTimeFormat(...).formatToParts()`: nenhum offset UTC-3 fixo, sem dependência do timezone do sistema.
- `tenants.alert_rate_limit_per_hour` tem padrão **100 tentativas de transporte por hora UTC** (ajustável entre 1 e 1000 por organização); inclui retries, não só eventos distintos. A cota é independente por tenant e reinicia a cada hora UTC. Alertas não são apagados quando a cota é atingida: permanecem `queued`/ `retry` até a próxima execução.
- `tenants.critical_bypass_silence` vale 1 por padrão. Quando ativado, apenas severidades `critica`, `critico` e `critical` atravessam silêncio. **Não ultrapassam a cota horária** (mecanismo anti-flood).
- Uma API exclusiva do proprietário, `GET/PATCH /api/console/notifications/policy`, permite alterar timezone, cota, bypass e os horários/SLA de regras específicas, com autorização owner e auditoria. A tela **Admin → Alertas e crises** oferece esses controles sem polling.

## Silêncio e agendamento

- A janela de regra `silencio_de`/ `silencio_ate` usa `HH:mm` no timezone da organização; cobre intervalos comuns e aqueles que atravessam a meia-noite. Os extremos são inclusivos, conforme o comportamento legado. Deve-se informar ambos ou remover ambos.
- Ao detectar um fato em silêncio, o **planejador não descarta a notificação**: enfileira-a com `next_attempt_at` no primeiro minuto permitido. A busca respeita os ajustes IANA de horário de verão, incluindo horas inexistentes/repetidas, limitando o avanço a 48 horas.
- O claim da outbox consulta novamente o silêncio da regra e a política atual. Assim, uma janela adicionada depois do enqueue também impede novo disparo indevido. Não se cancelam nem eliminam linhas históricas.
- A data usada para deduplicar incidentes, reputação e faturas passa a ser a **data civil local do tenant**. Eventos analíticos imutáveis permanecem vinculados ao dia UTC de criação do evento para preservar a identidade estável das PRs anteriores.

## Frequência segura, prioridade e reação

- A reserva SQL usa `FOR UPDATE OF t SKIP LOCKED` sobre a linha da organização e, dentro da mesma instrução, conta tentativas já iniciadas na hora UTC (`last_attempt_at`). Isso serializa o consumo da cota entre workers concorrentes. Não se faz `SELECT` separado seguido de atualização vulnerável à corrida.
- As mensagens elegíveis são priorizadas por criticidade, prazo SLA, criação e ID. Não se marca `sent` sem aceite HTTP ou `delivered` sem webhook assinado.
- O `sla_due_at` persiste um prazo **previsto**: para incidente e anomalia parte da criação do evento; para faturas e avaliações periódicas, parte do horário da avaliação. O histórico do owner o exibe como prazo estimado, **não** como resposta/solução confirmada — reconhecimento pelo cliente integra ALT-09.
- A fatura `open`/ `overdue` só vira fato vencido se `due_at` (data civil válida) for anterior ao dia local no timezone do cliente, não ao dia UTC do servidor.

## Migração e riscos

Migrações SQL são aditivas. Em `tenants`: `time_zone`, `alert_rate_limit_per_hour` e `critical_bypass_silence`, com defaults; em `notification_deliveries`: `sla_due_at`. Dados, hashes de dedupe, histórico de Resend, `.env.local` e `.data` devem ser preservados.

**Nota:** alterações de janela ou timezone após a criação de uma mensagem já adiada podem exigir a execução periódica do worker para revisitar `next_attempt_at`; a checagem de claim evita disparar indevidamente durante novas janelas. Como ALT-08 (worker agendado) ainda está aberto, não se promete pontualidade real em produção.

## Testes e critérios de homologação

- BRT: UTC 01h30 ainda corresponde ao dia civil anterior; vencimento correto de `open` antes/depois da meia-noite local.
- Horários noturnos 22h→06h: preservação da fila, `next_attempt_at`, minutos limítrofes e exceção crítica configurável.
- DST em `America/New_York`: salto 01h59→03h00 e repetição 01h00 no outono sem criar horários fictícios.
- Dois tenants com cotas distintas, dois workers simultâneos, prioridade de mensagens críticas, retenção do terceiro alerta excedente e retomada ao liberar quota.
- Rechecagem SQL de silêncio durante claim após alteração da política.
- API estrita, auditável, protegida por owner; UI de configuração.
- Requisitos pendentes: CI final SHA exato, teste real de worker periódico em PostgreSQL descartável com role sem BYPASSRLS, prova de SLA e reconhecimento, controle de picos, confirmação Resend. **NO-GO para clientes externos**.

Referência técnica: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts
