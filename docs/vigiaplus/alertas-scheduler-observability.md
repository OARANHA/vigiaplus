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

### Prova PostgreSQL isolada adicionada ao CI

O job `postgres-disposable` usa um serviço PostgreSQL 16 efêmero criado no runner do GitHub; o teste `scripts/tests/alt081-postgres.test.ts` exige explicitamente `ALT081_EPHEMERAL_POSTGRES=1`, host local `127.0.0.1`, database `vigia_alt081_ci` e ausência de `DATABASE_URL`. Dois pools de conexão independentes executam o código real `claimPendingDeliveries` e `finishClaimedDelivery` com o DDL da aplicação. Os cenários incluem claim concorrente, recuperação de lease, fencing, retries, dead-letter e ledger de tentativas.

**Limitação:** pools independentes no mesmo processo de teste não provam recuperação de crash de processo real, múltiplos hosts, segurança do lock órfão ou exactly-once externo. Não ligar Resend nem apontar este teste a Neon de produção.

### ALT-08.1 — isolamento entre processos e queda real (candidato)

O teste `scripts/tests/alt081-postgres.test.ts` passou a criar **dois subprocessos Node independentes** (`scripts/tests/alt081-worker-process.ts`) no PostgreSQL descartável, com pools próprios e concorrência real. O processo que ganha o claim é encerrado com `SIGKILL` antes de registrar a conclusão. O teste confirma o estado `processing` e o ledger persistido, força a expiração do lease, inicia um terceiro processo e exige recuperação com `attempt_count=2` e status final `sent` (aceite simulado sem transporte real).

O cenário verifica crash de processo e isolamento SQL entre conexões/processos no mesmo runner. Não demonstra concorrência entre hosts físicos, terminação de chamada remota, exactly-once no provedor ou segurança de produção. **Só marcar como validado se o job PostgreSQL concluir GREEN no SHA exato.**

## ALT-08.2 — Agendamento autônomo em modo simulado (candidato)

O supervisor reconhece `VIGIA_NOTIFY_DRY_RUN=1` **junto com** `VIGIA_NOTIFY_SCHEDULER=1`. Nesta configuração não executa `notify.ts`, não lê fila, não chama canais de transporte e registra `worker=notify_dry_run` separadamente de `worker=notify`. O endpoint owner apresenta o último dry-run sem declarar o worker real saudável. O teste `tests/todo-alt082-scheduler-dryrun.test.ts` executa duas passadas independentes num PGlite temporário, confere o livro-razão e ausência de entregas.

**Isolamento padrão:** os runners Windows e Linux usam `.data/notify-dryrun-pglite` e `.data/notify-dryrun-state`, diferentes do banco e da fila operacionais. Portanto, a UI owner conectada ao banco operacional **não exibirá** esses ciclos simulados; consulte o checkpoint isolado ou um painel explicitamente conectado ao banco de teste. Essa separação evita alterar dados de clientes durante o ensaio.

### Windows Task Scheduler (instalação não executada)

1. Fazer checkout da PR #36 em uma **cópia de teste**, preservando `.env.local`, `.data` e a instância da porta 3199; não instalar tarefa em máquina que esteja processando clientes.
2. Conferir Node.js 22 e `npm ci`, sem banco remoto no ambiente. O teste usa `PGLITE_DIR` local, `DATABASE_URL` removida pelo script.
3. Registrar voluntariamente, na pasta da cópia de teste: `powershell -NoProfile -File scripts/ops/install-notify-dryrun-task.ps1 -Install`. A tarefa `VigiaPlus-Notify-DryRun` tenta iniciar a cada cinco minutos, sem terminal aberto, com `MultipleInstances IgnoreNew`.
4. Inspecionar no Task Scheduler o resultado e histórico por **mais de duas janelas**; confirmar `notification_worker_runs.worker='notify_dry_run'` e ausência de `notify`. Para desinstalar: `powershell -NoProfile -File scripts/ops/install-notify-dryrun-task.ps1 -Remove`.
5. O registro padrão pode depender de sessão do usuário. Executar **sem usuário logado** exige configurar manualmente conta de serviço e credenciais/permissões adequadas, nunca embutir senha no script. **Não foi homologado ainda.**

### Linux systemd (templates não instalados)

Os arquivos `deploy/systemd/vigiaplus-notify-dryrun.service` e `.timer` usam intervalo de cinco minutos, `Type=oneshot` e conta `vigiaplus`. Paths e usuário são **exemplos**; sua instalação/revisão por administrador é explícita, não executada por esta PR. Verificar `systemctl list-timers`, histórico no journal e estado no banco após múltiplos ciclos. Nenhum `systemctl enable --now` autorizado.

### Critérios ainda abertos

- Provar execução independente do terminal na máquina-alvo e consistência do heartbeat por múltiplas janelas.
- Avaliar lock órfão, reinicialização e observabilidade de job não disparado. O lock local não é distribuído.
- Dry-run não equivale a entrega real; autorização separada para qualquer ativação de transporte.
- E2E owner e QA visual da página em 3199; políticas RLS/Neon descartável.

Não instalar tarefas, não fazer merge/deploy, não enviar mensagens e não alterar banco remoto sem autorização explícita.

### ALT-08.2 — corretiva de CI (11/11/2026)

Falha reproduzida no workflow 43027899738: 426/427 testes passaram; integração dry-run ficou sem código de saída antes de 60 s no runner e o passo `Test` falhou (job PostgreSQL dependente foi skipped). O teste foi movido de `tests/` para `scripts/tests/alt082-scheduler-dryrun.test.ts` e ganhou job dedicado `dryrun-isolated` após build, usando subprocessos assíncronos com timeout explícito e fechamento do PGlite. O supervisor em modo dry-run encerra o processo CLI após persistência e liberação do lock, porque os handles PGlite podem manter o processo vivo. Confirmar GREEN no novo HEAD antes de homologar; o teste não instala cron nem envia mensagens.

### ALT-08.2 — três ciclos, restart e recuperação conservadora de lock

Os três ciclos são invocados por **processos Node independentes** no teste isolado; entre o segundo e o terceiro ciclo é criado um lock simulado de processo morto (`pid` inexistente e `startedAt` anterior a cinco minutos). O supervisor recupera o lock **somente** quando `VIGIA_NOTIFY_DRY_RUN=1`, após verificar formato, tempo decorrido, PID inexistente (`ESRCH`) e conteúdo/inode estáveis, e tenta readquirir o lock por `open('wx')`. Lock novo, malformado, sem timestamp, de PID ativo ou inacessível é recusado. Em modo de entrega **real**, a recuperação automática permanece proibida (fail-closed).

**Limite:** a checagem do arquivo não é uma operação atômica contra troca por terceiro processo; é aceitável apenas no diretório isolado de simulação, nunca deve ser habilitada para envio real sem projeto de lock distribuído. Teste de reinicialização = processo CLI reiniciado, **não** reinicialização de host Windows/Linux. Os três ciclos são acionados pelo harness de CI, **não demonstram que Task Scheduler/systemd estejam instalados**.

**Próximos gates:** CI do SHA exato; instalar voluntariamente o agendador em ambiente descartável e comprovar execução sem sessão interativa durante três janelas reais (5 minutos), incluindo lock e checkpoint. Não instalar no host operacional sem autorização.

### ALT-08.2 — homologação de timer systemd em runner efêmero

O workflow ganhou job `systemd-scheduler-ephemeral`: no runner Ubuntu hospedado pelo GitHub, o script `scripts/tests/alt082-systemd-ci.sh` exige `CI=true`, `GITHUB_ACTIONS=true`, `systemd` como PID 1 e diretório `/home/runner/work/`. O teste instala um **timer transitório (não habilitado no boot)** via `systemd-run`, agendado após 2 segundos e repetido 4 segundos depois da conclusão anterior. Esse intervalo curto é **exclusivamente do CI**; templates do produto permanecem a cada 5 minutos.

Cada disparo usa o supervisor com `VIGIA_NOTIFY_DRY_RUN=1` em PGlite isolado no `RUNNER_TEMP`, sem `DATABASE_URL`, chamadas de transporte ou envio. O harness observa pelo menos três `runId` distintos no checkpoint e, após parar o timer e serviço, consulta o banco para confirmar três ou mais registros `notify_dry_run` bem-sucedidos e zero `notification_deliveries`. O `trap` interrompe timer e serviço e elimina os arquivos de teste mesmo em falha. Logs de `systemctl`/journal são inspecionados em falhas.

**Gates:** resultado do novo job no SHA exato ainda não verificado; GitHub runner é um host descartável, mas não demonstra reinicialização do SO nem serviço ativo no computador/VPS operacional. Nenhum agendador foi instalado na máquina do proprietário e nenhum deploy foi realizado.

### ALT-08.2 — CI RED de permissões do systemd e corretiva

No run `43035281344` (HEAD `41be5c46198f`), três jobs passaram; o job `systemd-scheduler-ephemeral` falhou. O journal registrou **múltiplas execuções reais e bem-sucedidas** de `notify_dry_run`, mas o verificador da máquina GitHub não conseguia ler `latest.json` com permissão `0600`, pois a unidade transitória criada via `sudo systemd-run` executava como `root`. Resultado aparente falso: `0 distinct scheduled dry-run cycles observed`; a limpeza `rm -rf` também recebeu `Permission denied` em arquivos PGlite root-owned. A corretiva em `scripts/tests/alt082-systemd-ci.sh` configura explicitamente `--property="User=$(id -un)"` na unidade transitória e protege a remoção do diretório temporário com `sudo rm -rf` estritamente restrito ao prefixo criado por `mktemp` dentro de `RUNNER_TEMP`. **Novo HEAD requer CI 4/4 GREEN; não extrapolar para host de produção.**

### ALT-08.2 — segunda corretiva do gate systemd

O run `43048978940` do HEAD `2df58cf366fe` terminou RED somente no job systemd (os outros três jobs GREEN). A falha deixou de ser permissão: o script `scripts/tests/alt082-verify-systemd.ts` foi executado via `tsx` em formato CommonJS, mas possuía três `top-level await`, produzindo erro de transformação. A corretiva encapsula a verificação em `async function main()` e a chama com tratamento de erro sanitizado. Novo HEAD `b3ca2af8bc3b9a0dfdee9a8a5d03f32d763c60bb`, CI ainda pendente na última verificação. Sem certificar GREEN até 4/4 jobs concluídos no HEAD exato.

### ALT-08.3 — auditoria inicial da observabilidade e autorização (candidato CI)

O endpoint `GET /api/console/notifications/operations` já exige contexto autenticado e `requireOwner(ctx)` **antes** de consultar dados, sem aceitar `tenant_id` do request. A ALT-08.3 extrai `lib/notifications/operations-health.ts` para que a saúde do worker real seja `not_observed` na ausência de execução, `degraded` em erro/atraso, datas inválidas, datas no futuro ou evidência de `notify_dry_run`, e `healthy` somente após uma execução real de `notify` bem-sucedida dentro de 10 minutos. O campo `summary` proveniente do banco passa por allowlist de contadores inteiros não negativos e nunca retorna campos arbitrários de destinatários, token ou mensagem.

Os testes `tests/todo-alt083-operations-security.test.ts` cobrem a função de saúde (inclusive tolerância zero a clock futuro), a sanitização, os papéis owner/analyst/client_admin/client_viewer e um contrato estático que confirma `requireOwner` antes da primeira consulta. Esses testes de papel e contrato **não substituem** uma chamada HTTP autenticada ponta a ponta. A certificação da RLS entre tenants requer banco descartável e uma matriz de identidades com privilégios reais; não alegar conformidade sem esse teste.

**Gates ALT-08.3 restantes:** CI GREEN no novo HEAD; E2E HTTP com sessões owner/client/analyst e matriz de responses 200/403; teste RLS PostgreSQL descartável com identidade mínima; reinicialização de host de teste (sem infraestrutura produtiva) e aferição do heartbeat. Não aprovar merge/deploy nem ativar transporte de alertas antes da autorização.
