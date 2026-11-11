# ALT-08 — Executor supervisionado de alertas (candidato, NÃO homologado)

Esta primeira entrega **não** ativa cron, envio nem deploy. Separa o worker de passagem única (`worker:notify`) da invocação supervisionada (`worker:notify:supervised`). Por padrão o segundo comando recusa executar; exige `VIGIA_NOTIFY_SCHEDULER=1` e `DEMO_MODE!=1`.

## Contrato operacional

- Invocar a cada 5 minutos por agendador externo confiável, com uma única instância **por host** (Windows Task Scheduler ou systemd timer). **Não** manter terminal aberto nem criar loop no processo da aplicação.
- `VIGIA_NOTIFY_STATE_DIR` define o diretório do checkpoint (padrão `.data/notify`). `latest.json` é gravado por rename atômico e contém início, fim, resultado, duração, contagens permitidas e código de saída. O arquivo não registra destinatários, tokens ou texto de incidentes.
- `notify.lock` é lock **local** criado em modo exclusivo; se o processo cair abruptamente, um lock órfão bloqueia novas passadas até diagnóstico e remoção manual. **Não** apagar automaticamente o lock apenas por idade, pois isso poderia duplicar execução.
- Tempo máximo inicial: 180 s. Timeout retorna não zero. A fila possui leases, quota e idempotência, mas o **envio externo não é exactly-once**.
- `latest.json` registra somente a **última** execução e não substitui trilha persistente em banco. Monitoramento externo deve verificar status e frescor (por exemplo, `finishedAt` inferior a 10 min), falha/timeout e bloqueio recorrente. Não expor esses arquivos diretamente pela web.
- A ativação em produção depende de uma única configuração autorizada, segredos de transporte homologados, isolamento do banco e métricas visíveis ao proprietário. Não colocar `VIGIA_NOTIFY_SCHEDULER=1` em ambientes de demonstração.

## Exemplo de scheduler Windows (NÃO executar automaticamente)

Use Task Scheduler com: **não iniciar nova instância se já estiver executando**; repetir a cada 5 minutos; executar mesmo sem login; configurar usuário de serviço, diretório de trabalho da aplicação e variáveis seguras no ambiente do serviço. Programa: `npm.cmd`; argumentos: `run worker:notify:supervised`; diretório inicial: `D:\\VIGIAPLUS`. A ativação depende do proprietário.

## Observabilidade implementada nesta candidata

- Tabela aditiva `notification_worker_runs` contém ID idempotente da execução, timestamps, resultado, código de saída e apenas resumo numérico permitido. A migração local é criada por `ensureSchema`; banco remoto permanece sem alteração até aprovação.
- Ao fim do supervisor, o relatório é persistido no banco. Falha na gravação produz código de saída não zero e o checkpoint local permanece para diagnóstico.
- Endpoint `GET /api/console/notifications/operations` exige sessão owner e fornece últimas 20 execuções e contagens globais de pendências, processamento, dead-letter, atraso >10 min, SLA ultrapassado e item mais antigo pronto.
- Interface `Admin → Alertas e crises` mostra saúde, horário da última execução, métricas e histórico. Consulta apenas ao abrir seção (sem polling). Não declara agendador instalado e trata ausência de execução como `not_observed`.
- O estado `healthy` significa **apenas** último registro de sucesso com menos de 10 min; não comprova serviço ativo após a consulta, capacidade externa de envio ou entrega ao destinatário.
- Teste PGlite do ledger, unicidade por run ID e contagens da fila. Necessário validar CI antes de considerá-lo aprovado.

## Gates ainda abertos

1. Tests, lint, tsc, build e CI GREEN no HEAD da PR candidata.
2. Integração PGlite/Neon descartável com duas instâncias e simulação de falha/lease; demonstrar recuperação da fila.
3. Ledger em banco, endpoint e dashboard owner implementados como candidatos; **pendente** validar banco descartável remoto, segurança/RLS, métricas end-to-end e comportamento de crash.
4. Provar que o scheduler permanece ativo sem terminal e gera histórico após múltiplas execuções, em ambiente autorizado.
5. QA 3199 e E2E owner; cron e transporte **desativados** durante o QA sem homologação.

O scheduler de **coleta de fontes** da PR #11 não é o scheduler de **envio de notificações** ALT-08.

## ALT-08.1 — Matriz de resiliência (candidata, sem homologação)

| Cenário | Evidência em código | Limitação |
| --- | --- | --- |
| Dois consumidores disputam item | PGlite, claim SQL concorrente e ledger | Validar em PostgreSQL com conexões/processos distintos |
| Worker morre após claim | Lease forçado a expirar e reclaim por outro worker | Crash real do processo e queda durante chamada externa ainda não simulados |
| Worker anterior conclui atrasado | `lost_lease` esperado e CAS por lease_owner + attempt_count | Não impede efeito externo se provedor já aceitou envio antes de crash |
| Falha transitória | Retry com `next_attempt_at` futuro e backoff | Sem chamadas externas; verificar provedor homologado posteriormente |
| Falha definitiva | Quinta tentativa vira `dead_letter`; sem claim posterior | Reprocessamento manual exige owner e auditoria |

**Protocolo:** nenhuma mensagem real; testes usam canal interno `ledger` e PGlite temporário. A existência dos testes não representa aprovação; validar CI específico do commit e reproduzir em banco descartável real antes de classificar ALT-08.1 como concluída.
