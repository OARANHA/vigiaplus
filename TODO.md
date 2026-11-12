# VIGIAPLUS — TODO mestre de produto, segurança e operação

**Atualizado:** 2026-11-10 · **Repositório:** `OARANHA/vigiaplus` · **Dono da decisão de merge/deploy:** proprietário  
**Estado comercial:** **NÃO HOMOLOGADO para clientes externos**  
**Base verificada antes deste TODO:** PR #24 DRAFT, commit `57b82de9497ade909b8f6e222df5d8f3af66081f`, empilhada sobre #23; `main` em `d2d9eafe7667b21a4badc14a3161501f5c72513d`.  
**Ambiente de prévia:** `D:\VIGIAPLUS`, porta **3199**. Porta **3100 encerrada** (antigo `D:\CRISE_APP`).  
**Auditoria de origem:** 2026-11-10, proprietário + cliente + notificações + segurança. Este documento é o backlog executável dessa auditoria.

> **Regra operacional:** nenhuma tarefa pode ser marcada `[x]` somente porque existe código, tela, PR ou CI de outro SHA. Fechar apenas após evidência do critério de aceite. Não executar merge, deploy, migrações de banco remoto, cobrança real nem exclusão de dados sem autorização explícita do proprietário.

## Legenda e rotina de acompanhamento

- `[ ]` pendente; `[x]` verificado; `[~]` não é checkbox válido — usar `[ ]` e registrar bloqueio abaixo do item.
- **P0**: segurança, onboarding, confiabilidade dos alertas; impede cliente real. **P1**: operação e produto; impede oferta profissional plena. **P2**: acabamento, performance e diferenciação.
- Em cada entrega: confirmar `HEAD` da branch e base da PR; implementar em PR **DRAFT**; testes unitários + integração PGlite/Neon descartável + E2E; CI dos workflows obrigatórios no **SHA exato**; QA local na **3199**; registrar resultado e pendências no **ELUS Memory Admin / banco `vigiaelus`**.
- Roteiro de atualização local: verificar `git status` e PID/processo da porta 3199, preservar `.env.local`, `.data` e alterações do usuário; fazer backup antes de trocar branch; atualizar via **fast-forward**, sem `reset --hard`; deixar o processo existente em 3199 ativo quando possível; **não abrir segunda instância na mesma porta**. Conferir `http://127.0.0.1:3199/login`, `/console`, `/console/admin`, `/portal` com usuários de teste apropriados. Nunca reabrir 3100 por conveniência.

## Situação confirmada — não confundir código com produção

- [x] **BASE-01** — Console owner, catálogo de planos, cadastro inicial de organizações e permissões implementados em PRs #22–#24 (DRAFT, **não integradas à main**).
- [x] **BASE-02** — Proteção de unicidade comercial + SQL atômico em PR #24; **CI GREEN do SHA `8f198aef...`** ([run 42756850646](https://github.com/OARANHA/vigiaplus/actions/runs/42756850646); 369 testes). **Não vale como aprovação do HEAD atual**.
- [x] **BASE-03** — Prévia local VIGIAPLUS atualizada para commit `57b82de...`, em porta 3199, e porta 3100 encerrada; backup local anterior `D:\VIGIAPLUS_LOCAL_SAFETY_20261110`.
- [x] **BASE-04** — Smoke HTTP **sem sessão**: `/api/health` 200, `/portal` e `/console` 307, `/api/console/tenants` e `/api/app/evidence` 401; **não substitui teste com dois clientes**.
- [ ] **BASE-05** — CI completo no **HEAD atual da PR #24**, QA autenticado desktop/tablet/mobile e validação de sessão real. É uma pendência de homologação, não uma afirmação de falha.
- [ ] **BASE-06** — Revisar conflitos e dependências entre as PRs DRAFT [#11 scheduler](https://github.com/OARANHA/vigiaplus/pull/11), [#14 RLS](https://github.com/OARANHA/vigiaplus/pull/14), [#15 webhooks](https://github.com/OARANHA/vigiaplus/pull/15) e [#20–#24 UI/owner](https://github.com/OARANHA/vigiaplus/pull/24). Produzir matriz de compatibilidade antes de sugerir integração.

## Fase 1 — P0 · Cliente real consegue entrar SEM acessar dados de outro cliente

**Entrega-alvo:** proprietário cadastra organização → vincula usuário → convida → usuário define senha → login no portal → acesso limitado ao contrato e tenant.

- [ ] **SEC-01 — Bloqueio contratual server-side em todas as consultas de cliente.** Em `app/api/app/evidence/route.ts` e demais APIs/exports, exigir tenant **ativo**, assinatura elegível e feature correspondente; preservar acesso mínimo e explícito a conta/fatura/suporte. Aceite: tenant pending/suspended/cancelled recebe 403 nas evidências, inclusive por URL direta; owner consegue diagnosticar sem burlar auditoria.
  - [x] 2026-11-10 — `app/api/app/evidence`, `summary`, notificações e projetos/exports legados protegidos no servidor (PR #25).
  - [x] 2026-11-10 — testes com banco PGlite e clientes Alfa/Beta, incluindo suspensão/cancelamento.
  - [ ] Inventário de todas as demais rotas, RLS/Neon descartável e E2E autenticado de dois clientes — **item SEC-01 ainda aberto**.
- [ ] **SEC-02 — Imposição de senha temporária no servidor.** Negar APIs/páginas de negócio para `mustChangePassword=1`; liberar apenas autenticação, troca de senha e logout. Aceite: tentativas diretas em REST não funcionam antes da troca; após troca a versão da sessão é renovada, a sessão antiga deixa de funcionar.
  - [x] 2026-11-10 — gate central de `mustChangePassword` em `lib/auth.ts` e teste de política, com a tela de alteração permitida (PR #25).
  - [ ] Prova E2E de REST com cookie real e da rotação da sessão pós-alteração — **item SEC-02 ainda aberto**.
- [ ] **CL-01 — Onboarding transacional da organização.** Criar usuário ou vincular existente a `memberships` com papel `client_admin`/`client_viewer` e tenant explícito, auditando alterações. Aceite: cliente sem vínculo não entra, cliente com vínculo entra apenas no próprio tenant; duplicidades concorrentes não criam membros extras.
  - [x] 2026-11-10 — aceite de convite cria **novo** usuário + membership com tenant/papel e auditoria numa instrução SQL (PR #26), teste PGlite.
  - [ ] Vinculação autenticada de conta preexistente e E2E do fluxo completo owner→cliente — **item CL-01 ainda aberto**.
- [ ] **CL-02 — Convites seguros e recuperações.** Token aleatório de uso único armazenado somente como hash, expiração, aceite, revogação, reenvio, throttling e recuperação de senha sem enviar senha em texto claro. Aceite: convite expirado/reutilizado/revogado inválido; endereço informado recebe convite **apenas se transporte certificado**; estado visível na ficha do cliente.
  - [x] 2026-11-10 — token 256 bits persistido apenas como hash, validade 48h, aceite único, revogação e UI do proprietário (PR #26).
  - [x] 2026-11-10 — produção bloqueia emissão sem Resend, remetente e URL HTTPS configurados; local permite apenas link manual de teste.
  - [x] 2026-11-10 — recuperação de senha com token 256 bits/sha256, TTL 30 minutos, uso único, cooldown de 10 minutos, revogação das sessões, respostas sem enumeração e páginas /recuperar /redefinir (PR #27); 378 testes PGlite/TS/build no SHA `4e4e72ae...`.
  - [ ] Teste E2E autenticado no navegador e envio/recebimento reais via Resend, reenvio, limitador distribuído por IP e webhook de entrega — **item CL-02 ainda aberto**.
- [ ] **SEC-03 — Proteção integral do modo demo.** Em `DEMO_MODE=1`, qualquer mutação (inclusive ações owner e APIs SaaS) responde 403 no servidor, sem depender do proxy. Aceite: suíte parametrizada POST/PATCH/PUT/DELETE para rotas administrativas/cliente, nenhuma linha alterada.
  - [x] 2026-11-10 — proteção central no proxy para POST/PUT/PATCH/DELETE e qualquer método não seguro, cron e webhooks GET; cabeçalho de método sobrescrito pelo proxy. Identidade sintética bloqueada no servidor para requisições não-leitura e login negado antes de tocar no banco. PR #28.
  - [x] 2026-11-10 — teste que percorre rotas `app/api/**/route.ts`, verifica 403 e estado PGlite inalterado; **382/382 testes GREEN no SHA `e0e81e41cc7e33e41f7202ddca6091553bbc935c`**, run 42936613997.
  - [ ] E2E HTTP de `DEMO_MODE=1` com banco descartável, auditoria de GETs com efeitos colaterais e prova de que a demo nunca consulta uma base de clientes reais — **item SEC-03 ainda aberto**.
- [ ] **SEC-04 — Isolamento de dois tenants e RLS.** Inspecionar e homologar [PR #14](https://github.com/OARANHA/vigiaplus/pull/14) no PostgreSQL/Neon descartável com role sem `BYPASSRLS`, transaction-scoped tenant e cobertura das tabelas; validar atual uso de Neon HTTP. Aceite: matriz A/B com endpoints, exports, jobs e acesso por ID cruzado sempre negados; não ativar política em base real antes de teste e autorização.
  - [ ] Auditoria de 2026-11-10: candidata RLS da PR #14 omite `llm_providers` e `llm_routes` (ambas possuem `tenant_id`, nullable para escopo global). Corrigir cobertura e definir política de linhas globais sem expor credenciais a clientes; executar em banco descartável antes de qualquer migração.
- [ ] **SEC-05 — MFA real + sessão de proprietário.** Implementar desafio verificável (TOTP/passkey) para owner e admins, recuperação segura, revogação e gestão de sessões. Aceite: `two_factor_enabled` só habilita depois da prova; segunda etapa é obrigatória no login; dispositivos revogados recebem 401.
- [ ] **SEC-06 — Gate de entrada sem regressão.** Testar servidor/cliente para `/`, `/login`, `/console`, `/portal`; sem flash de sidebar antiga, sem troca de tema após hidratação, sem informação de cliente anterior. Aceite: capturas autenticadas e sem sessão em 390/768/1440 px, light/dark, sem hidratação inconsistente.

**Gate Fase 1:** dois clientes reais de teste em banco descartável + owner passam E2E; nenhuma rota lê dados cruzados; cadastro-convite-login-troca de senha funciona; CI GREEN no SHA exato. **Sem esse gate, não há cliente externo.**

## Fase 2 — P0 · Alerta detectado se transforma em aviso confiável

**Entrega-alvo:** registrar evento → gerar destinos verificados → enfileirar sem perda → enviar → acompanhar aceitação/entrega/falha → consultar histórico pelo proprietário e cliente.

- [ ] **ALT-01 — Corrigir dedupe multicanal e concorrência.** Idempotência por `tenant + regra + tipo/id de evento + canal + destino` (identificador canônico sem expor PII), com índice único e migração conservadora. Aceite: 2 e-mails e 1 canal adicional criam 3 entregas; rerun não duplica nenhuma; concorrência não gera colisões.
  - [ ] Implementação candidata na branch `fix/todo-alt01-notification-dedupe-20261110`: chave SHA-256 v2 por destinatário, `INSERT ON CONFLICT DO NOTHING` usando UNIQUE preexistente, preservação de linha legado sem reenviar; testes PGlite de dois clientes, três destinos e concorrência. **Aguardar CI no SHA exato, teste real de worker e homologação antes de marcar concluído.** Referência: `docs/vigiaplus/alertas-dedupe-v2.md`.
- [ ] **ALT-02 — Fila/outbox confiável.** Reserva atômica `queued → processing` com lease, tentativas, retry/backoff e dead-letter; manter auditoria do erro. Aceite: dois workers concorrentes não fazem envio duplo, timeout é recuperado, falha permanente fica visível e reprocessável.
  - [ ] 2026-11-10 — Implementação candidata em `fix/todo-alt02-outbox-lease-retry-20261110`: outbox com reserva SQL `SKIP LOCKED`, lease por mensagem, 5 tentativas, retry/backoff, expiração recuperável, `dead_letter`, reprocessamento owner com auditoria; testes PGlite concorrentes sem disparo externo. **Não marcar concluído antes de CI do HEAD exato, E2E do worker e monitoração real.** Documentação: `docs/vigiaplus/alertas-outbox-lease.md`.
- [ ] **ALT-03 — Unificar eventos analíticos e operacionais.** Ligar `lib/alerts.ts` (picos/sentimento) aos fatos consumidos por `worker:notify`; conciliar incidentes, faturamento e alertas com ID de correlação. Aceite: anomalia real detectada gera entrega; ausência de fato não gera alerta falso.
  - [ ] Candidata 2026-11-10: fatos analíticos de `alerts` vinculados por `projects.tenant_id`, regras opt-in `volume_pico` e `sentimento_queda`, correlação persistida `event_ref`/`source_project_id`, dedupe estável entre dias, cobranças só após vencimento civil. Testes PGlite dois tenants, prova das métricas, replay e falsos positivos. **Aguardar CI SHA exato, E2E da detecção real e do worker agendado para fechar ALT-03**. Documento `docs/vigiaplus/alertas-analiticos-integracao.md`.
- [ ] **ALT-04 — E-mail Resend real, sem segredos na UI/banco.** Configurar `RESEND_API_KEY` e `ALERT_EMAIL_FROM` via ambiente seguro, domínio e remetente verificados; botão owner de diagnóstico, nunca envio automático para terceiros de teste. Aceite: teste controlado de envio com credencial real, logs e ID do provedor; se sem chave, tela exibe “não configurado”, não “ativo”.
  - [ ] 2026-11-10 — implementação candidata em `fix/todo-alt04-alt05-email-verification-20261110`: transporte sem remetente de fallback, diagnóstico owner-only sem segredos, teste **somente para a própria conta mediante clique**, idempotency-key Resend e ID de aceite persistido. **Pendente** CI SHA exato, credenciais/dominio reais, teste do proprietário e prova de entrega. Documentação `docs/vigiaplus/alertas-resend-verificacao.md`.
- [ ] **ALT-05 — Verificação de destinatários.** Proibir `PATCH verified=true` sem token de prova de posse; habilitar/desabilitar canais por tenant e perfil. Aceite: só endereço verificado pode receber aviso; tentativa de autoaprovação sem token falha.
  - [ ] 2026-11-10 — implementação candidata: flag legado `verified=1` não libera worker nem claim, `PATCH verified=true` negado, desafio por e-mail de token 256 bits hash SHA-256, TTL 30 min, cooldown 10 min, confirmação pública de uso único/auditada e UI. **Pendente** CI, E2E com endereço real e mecanismos próprios para canais não-e-mail; todos esses canais permanecem bloqueados até prova.
- [ ] **ALT-06 — Confirmação real de entrega.** `accepted`/HTTP 2xx não significa `delivered`; consumir webhooks autenticados de delivered/bounced/complained quando disponíveis. Aceite: histórico mostra estados e horários distintos, destinatário, tentativas e motivo sanitizado de falha.
  - [ ] Candidata 2026-11-11 na branch `feat/todo-alt06-resend-delivery-webhooks-20261111`: assinatura Svix HMAC do raw-body + tolerância/replay; ledger único de eventos, match por ID de mensagem+destinatário, estado externo/horários/códigos sanitizados, tratamento de eventos fora de ordem e conciliação de webhook adiantado; proprietário vê aceite vs. entrega e bounce/reclamação desativa canal. Testes PGlite e rota sem rede. **Só fechar após CI GREEN no HEAD, webhook real homologado e revisão RLS/retenção.** Referência: `docs/vigiaplus/alertas-resend-webhooks.md`.
- [ ] **ALT-07 — Fuso horário e regras de crise.** Silêncio com timezone por tenant, rate de alertas, severidade e SLA de reação; só considerar fatura `open` vencida pela data civil correta. Aceite: testes em `America/Sao_Paulo`, virada de dia e quiet hours atravessando meia-noite.
  - [ ] PR #35 DRAFT: timezone IANA `America/Sao_Paulo` por tenant, UI/API owner auditadas, faturas pelo dia civil, silêncio diferido até a próxima janela (inclusive DST), exceção crítica configurável, SLA como previsão e priorização. Cota do transporte **por tentativa**, inclusive retries, ledger aditivo `notification_dispatch_attempts`, claim atômico por item e limite de lote, com testes PGlite de dois tenants e concorrência. Regras com silêncio integral/horários inválidos não podem ser cadastradas, legado fica retido sem derrubar worker. **Não marcar concluído até CI no HEAD exato e homologação de execução programada/Neon descartável.** Ver `docs/vigiaplus/alertas-timezone-sla.md`.
- [ ] **ALT-08 — Worker agendado e observável.** Integrar scheduler de envio, health e métricas de atraso; permitir execução de teste segura e limitada ao owner. Aceite: execução periódica registrada, falhas visíveis, sem processo dependente de terminal aberto.
  - [ ] Candidata PR #36 DRAFT: supervisor opt-in, lock local, timeout, checkpoint JSON sanitizado, ledger `notification_worker_runs`, endpoint owner agregado, painel de saúde/fila e testes PGlite. **Ainda não atende aceite:** falta CI no HEAD exato, execução programada comprovada sem terminal, teste com dois workers e PostgreSQL/Neon descartável, RLS e E2E autenticado; sem envio real/deploy. Ver `docs/vigiaplus/alertas-scheduler-observability.md`.
  - [ ] **ALT-08.1 — Resiliência:** testes PGlite acrescentados em `tests/todo-alt081-resilience-db.test.ts`: concorrência de 2 workers no mesmo DB, lease expirado/fencing do worker antigo, retry/backoff até dead-letter e ledger de tentativas. **Suíte CI PostgreSQL 16 com pools e subprocessos Node/SIGKILL já GREEN no SHA `ad75e3466ca9`; multi-host ainda não homologado**; testes não provam exactly-once no provedor nem a segurança de lock local órfão.
  - [ ] **ALT-08.2 — Scheduler autônomo seguro:** candidato com `VIGIA_NOTIFY_DRY_RUN=1` (sem fila/transporte), ledger separado `notify_dry_run`, API/UI owner diferenciando simulado de real, scripts Windows Task Scheduler e templates systemd não instalados, teste de três passadas em PGlite (job `dryrun-isolated`) com restart independente e recuperação conservadora de lock órfão apenas em dry-run; locks recentes/ativos permanecem bloqueados e entrega real não autorrecupera. **Timer systemd transitório no GitHub CI GREEN 4/4 no SHA `c8b42cb041c4`; Windows e reboot de host-alvo ainda pendentes.** Ainda faltam host-alvo, reboot real e QA owner. Sem ativar mensagens reais.
  - [ ] **ALT-08.3 — Homologação operacional e segurança:** iniciado com funções fail-closed de saúde do worker (nunca saudável se relógio futuro, execução ausente/atrasada ou dry-run), allowlist dos contadores da API e testes de owner/analyst/cliente em `tests/todo-alt083-operations-security.test.ts`. **CI 5/5 GREEN no SHA `3f7005312f35` (run `43153762544`) para adaptador Neon WS isolado. Próxima etapa: teste E2E remoto Neon WS `scripts/tests/alt083-neon-ws-e2e.test.ts` e workflow manual `.github/workflows/alt083-neon-e2e.yml`, ambos com gate fail-closed: CI real, URL Neon de banco CI exclusivo `vigia_alt083_ci_*`, sem tabelas pré-existentes, role sem BYPASSRLS/SUPERUSER, RLS A/B, rollback e limpeza. **Teste remoto NÃO EXECUTADO: requer URL/secret de banco Neon descartável criado separadamente.** CI principal no novo HEAD a verificar. Produto permanece `neon-http`, RLS operacional NO-GO, reboot de host pendente**. Não houve instalação no host nem envio.
- [ ] **ALT-09 — Telas de alertas.** Configurar regra, destinatários, verificação, último disparo, histórico, falhas, reconhecimento e responsável no owner e no portal do cliente (conforme papel). Aceite: usuário distingue “evento encontrado”, “notificação pendente”, “aceita pelo provedor” e “entregue”.

**Gate Fase 2:** disparar evento real em ambiente de teste → 2 e-mails + 1 canal alternativo → comprovar 3 registros, idempotência, retry e pelo menos um estado de entrega real, sem misturar clientes.

## Fase 3 — P0/P1 · Coleta e prestação de serviço comprováveis

- [ ] **OPS-01 — Integrar e homologar [PR #11](https://github.com/OARANHA/vigiaplus/pull/11).** Rodízio de **1 cliente a cada 15 minutos (4/hora)**, lease por execução, dedupe, rate limits por fonte, 429 GDELT com retry controlado e histórico por projeto. Aceite: teste com quatro tenants, sem coletas paralelas indevidas, última e próxima execução reais.
- [ ] **OPS-02 — Centro operacional do proprietário.** Painel por cliente: fontes ativas, última coleta, novas menções, erros, backlog, tempo de processamento e incidentes. Aceite: falha de fonte visível, sem exibir 0 como sinônimo de sucesso.
- [ ] **OPS-03 — Health vs readiness.** Manter `/api/health` como liveness; criar readiness restrito com banco, fila, worker, coleta, provedores/credenciais (somente status, nunca segredos). Aceite: banco indisponível implica readiness degradado, não serviço operacional.
- [ ] **OPS-04 — Fontes e políticas por cliente.** Termos, entidades, fontes e frequência gerenciados na ficha da organização; validar isolamento, quotas e permissões no backend. Aceite: cliente A não vê ou altera a coleta do cliente B.
- [ ] **OPS-05 — Cobrança e limites comerciais.** Integrar [PR #15](https://github.com/OARANHA/vigiaplus/pull/15) em sandbox: assinatura, webhook, reconciliação, idempotência, dunning e recebimento verdadeiro; aplicar limites de menções, IA e retenção por plano. Aceite: webhook repetido não duplica, pagamento manual não aparece como recebido; excedente bloqueia conforme contrato.
- [ ] **OPS-06 — LGPD e backups.** Definir retenção executável, exportação, exclusão auditada, papel do controlador/operador, política de consentimento quando aplicável, backup e restauração testada. Aceite: demonstração de expurgo/restore em ambiente descartável; aprovação explícita antes de ação destrutiva.

## Fase 4 — P1 · Produto que dono e cliente entendem e confiam

- [ ] **ADM-01 — Ficha única do cliente.** Unificar cadastro/contato, status da organização, pessoas com acesso, convites, plano, recursos, fontes, última coleta, alertas, consumo, faturas e eventos de auditoria. Aceite: owner resolve abertura e suspensão sem navegar por 17 seções.
- [ ] **ADM-02 — Ciclo de vida explícito.** Estados `rascunho → convite → primeiro acesso → configurar fontes → testar alertas → operacional → suspenso/encerrado`; suspender/restabelecer com motivo e trilha. Aceite: “operacional” só após login, coleta e envio de teste certificados; suspensão corta acessos de negócio.
- [ ] **ADM-03 — Provedor LLM de verdade.** Corrigir `app/api/console/llm-providers/[id]/test/route.ts`, que hoje injeta `fetchImpl`/DNS mock (HTTP 200 simulado). Aceite: teste real seguro, timeout, validação de resposta OpenAI-compatible e diagnóstico sem expor chave, com testes mock só na suíte.
- [ ] **UX-01 — Portal centrado na decisão.** Mostrar período real, entidades monitoradas, fontes disponíveis, menções verificáveis, tendências calculadas, incidentes, providências, notificações e histórico. Aceite: cada número tem janela e fonte; dados ausentes ficam “não medido”, nunca KPI fictício.
- [ ] **UX-02 — Reputação calculada ou retirada.** Resolver `score=null` fora da demo com cálculo por alvo auditável, amostra e confiança; ou usar apenas métricas confiáveis até existir modelo homologado. Aceite: números reproduzíveis no banco e explicação de método no portal.
- [ ] **UX-03 — Filtros e relatórios.** Busca, período, fonte, relevância, paginação, export por tenant e relatórios com evidências e período. Aceite: 200+ menções navegáveis, PDF/export sem cruzamento de tenants.
- [ ] **UX-04 — Design e consistência.** QA de login, admin e portal nas resoluções 390/768/1440, light/dark sem flash e sem sidebar legada, contraste, teclado, estados loading/error/empty e somente pt-BR. Aceite: screenshots antes/depois e revisão manual autenticada.
- [ ] **UX-05 — Marca comercial.** Identidade própria, rodapé, domínio, e-mails transacionais, páginas de política/contato e white-label somente quando contratado. Aceite: portal transmite origem, atualidade, responsabilidade e segurança sem alegações não verificadas.

## Gate final — liberar primeiro cliente externo SOMENTE com evidências

- [ ] **GO-01** — Onboarding de owner + administrador cliente + leitor, convite seguro, MFA owner e troca obrigatória de senha.
- [ ] **GO-02** — Isolamento cross-tenant A/B, autorização para todas as APIs/exports e RLS no PostgreSQL homologado.
- [ ] **GO-03** — Coleta agendada e observável; 4 clientes/hora com falhas recuperáveis.
- [ ] **GO-04** — E-mail real com múltiplos destinatários, regra, retry, logs e estados de aceitação/entrega.
- [ ] **GO-05** — Portal e console com informações verificáveis, ações reais e QA de dois temas e três viewports.
- [ ] **GO-06** — Limites de plano e retenção impostos; cobrança em sandbox homologada, se habilitada.
- [ ] **GO-07** — CI GREEN no **HEAD exato**, teste de restore, revisão de segurança e autorização **explícita do proprietário** para merge/deploy.

**Regra de decisão:** qualquer item do gate sem evidência = **NO-GO**, independentemente de screenshots, PR aberta, testes parciais ou feedback visual positivo.

## Controle de execução / checkpoint

| Campo | Valor inicial |
|---|---|
| Próximo lote recomendado | Fase 1: `SEC-01` + `SEC-02` + testes cross-tenant; em seguida `CL-01`/`CL-02` |
| Branch de prévia local | `preview/owner-admin-pr24-20261110` |
| PR de referência | [#24](https://github.com/OARANHA/vigiaplus/pull/24) (DRAFT, base #23) |
| Último SHA verificado antes deste documento | `57b82de9497ade909b8f6e222df5d8f3af66081f` |
| Estado CI do SHA acima | **Não confirmado** — último GREEN conhecido é de SHA anterior |
| Ambiente local | `http://127.0.0.1:3199`; 3100 fechada |
| Banco de memória | ELUS Memory Admin → `vigiaelus` |
| Merge/deploy | **NÃO AUTORIZADO** |

### Template de atualização a cada lote

```text
TODO IDs: SEC-01, ...
PR / branch / base:
HEAD SHA:
Mudanças feitas:
Testes (comando, resultado, banco):
GitHub Actions run + conclusão do HEAD exato:
QA local 3199 (rotas, login, dark/light, screenshots):
Riscos e bloqueios:
Estado: PENDENTE | GREEN | RED
ELUS Memory Admin (vigiaelus): checkpoint registrado?
Merge/deploy: não autorizado
```

### ALT-08.4 — integração gradual RLS por rota e tabela (piloto em CI)

- [x] Piloto **desativado por padrão** em `/api/app/evidence`: rota preserva o caminho atual, opt-in apenas com `VIGIA_ALT084_EVIDENCE_MODE=ci-read-only` e guardas de CI/não-produção; no piloto não existe fallback para consultas sem RLS.
- [x] SQL de leitura com projeção fixa e LIMIT parametrizado em `lib/tenant/rls-evidence.ts` e políticas SELECT-only, ENABLE/FORCE RLS em `projects` / `mentions`, com rollback explícito em `lib/tenant/rls-evidence-policies.ts`.
- [x] Suíte unitária `tests/todo-alt084-rls-evidence.test.ts` e prova adversarial em schema real no PostgreSQL descartável `scripts/tests/alt084-evidence-rls.test.ts`, integrada a `postgres-disposable`.
- [ ] Confirmar CI completo no SHA exato atual, verificando logs do novo teste (somente conclusão de todos os jobs permite GREEN).
- [ ] Homologar HTTP real do caminho opt-in usando banco Neon descartável, incluindo autenticação e feature gate.
- [ ] Projetar políticas/grants e fluxo de rollback para as demais tabelas operacionais; homologar owner/analyst/worker e migração por etapa antes de ativar em produção.

**Gate de implantação:** NO-GO. `getDb()` continua `neon-http`, sem policies no banco operacional e sem migração/merge/deploy. Prova de reboot físico do host ainda pendente.

### ALT-08.4 — gate HTTP autenticado e Neon WebSocket em base descartável

- [x] Adicionado `scripts/tests/alt084-http-neon-setup.ts` com preflight sem escrita em DB `vigia_alt083_ci_*` vazio, role sem BYPASSRLS, fixtures sintéticas `public.projects` + `public.mentions`, `ENABLE/FORCE RLS`, rollback de policies e cleanup que sinaliza falha.
- [x] Adicionados `scripts/tests/alt084-http-fixture.ts` (sessões/vínculos/entitlements em PGlite temporário), `alt084-http-verify.ts` (HTTP real, clientes A/B, cookies assinados, spoofing, no-store) e `alt084-http-ci.sh` para orquestração isolada no GitHub Actions.
- [x] Workflow manual `alt083-neon-e2e.yml` na branch da PR passa a executar também o HTTP experimental (arquivo já registrado na `main`, porém versão atualizada apenas na branch).
- [x] Leitura `selectRlsEvidence` falha fechada se `FORCE RLS`, políticas SELECT exatas ou role sem bypass não forem comprovadas; testes unitários da barreira adicionados.
- [ ] Confirmar CI normal GREEN no SHA atual.
- [ ] Disparar workflow manual na branch `feat/todo-alt08-notify-supervisor-20261111` e conferir log do teste `ALT084 HTTP Neon WS` e cleanup no SHA exato.
- [ ] Reavaliar arquitetura de identidade/entitlements em banco comum antes de implantação operacional.

**Produção segue NO-GO:** sem merge, sem deploy, sem alteração de policies/tabelas reais e sem troca do driver `getDb()`.

### ALT-08.5 — preparação da migração RLS operacional (NÃO ativada)

- [x] Inventário e matriz de superfícies `docs/vigiaplus/alt085-operational-rls-migration.md`, distinguindo tenant direto, relacionamento por projeto e tabelas globais/sensíveis.
- [x] Catálogo **inerte** `lib/tenant/rls-operational-wave1.ts` com role CI somente leitura, `GRANT SELECT`, `ENABLE/FORCE RLS`, `CREATE POLICY`, `DROP POLICY`, `REVOKE SELECT` e reversão individual para `reputation_targets`, `incidents`, `notification_channels`, `invoices`.
- [x] Prova adversarial integrada ao job PostgreSQL efêmero `scripts/tests/alt085-operational-wave1-rls.test.ts`: baseline, role sem bypass, tenants sintéticos A/B, ausência de escopo, SELECT só do tenant, UPDATE negado, sem vazamento de SET LOCAL, rollback e remoção de grants por tabela.
- [ ] Confirmar CI GREEN no HEAD exato, especialmente o passo ALT-08.5 no runner PostgreSQL.
- [ ] Revisar query/colunas PII e política específica de cada rota real; não liberar SELECT indiscriminado em dados sensíveis.
- [ ] Planejar papéis separados para owner/analyst/worker/webhook e integração com auth+billing+entitlements em Neon no mesmo contexto de confiança.
- [ ] Preparar rollback de staging que restaure **baseline real**, não aplique rollback CI em bases já protegidas, e ensaio completo antes de autorização de produção.

**Gate final: NO-GO para RLS operacional/produção; nenhum merge/deploy e nenhuma tabela real foi alterada.**

### ALT-08.6 — gate de homologação em pré-produção (sem ativação operacional)

- [x] Matriz declarativa de papéis: clientes `client_admin`/`client_viewer` somente leitura; `owner`/`analyst`/`worker`/`webhook` explicitamente NO-GO em `lib/tenant/rls-preproduction-gate.ts`.
- [x] Regressão fail-closed de superfície, tenant autenticado, sessão do cliente e URLs de banco proibidas: `tests/todo-alt086-preproduction-gate.test.ts`.
- [x] Testes do contrato de pool pinado: BEGIN, SET LOCAL, COMMIT, ROLLBACK, release, falhas injetadas e tenant inválido em `tests/todo-alt086-transaction-contract.test.ts`.
- [x] Protocolo detalhado de snapshot, preflight, rollout e rollback **por tabela** e homologação E2E real: `docs/vigiaplus/alt086-preproduction-rls-gate.md`.
- [ ] Verificar CI completo no SHA exato, sem aprovar um SHA anterior.
- [ ] Provisionar e identificar staging realmente isolado (somente após autorização); não usar Neon operacional nem outros projetos.
- [ ] Executar migração reversível e restaurar policies/ACLs a partir de baseline capturado no staging real.
- [ ] Homologar `owner`, `analyst`, serviços `worker`/`webhook`, escopos múltiplos e transação WebSocket com runtime de auth+billing+entitlements no mesmo domínio de dados.
- [ ] Obter autorização explícita antes de deploy/merge/ativação de RLS operacional.

**Produção: NO-GO. Contratos de CI NÃO equivalem a homologação em staging.**

### ALT-08.7 — Staging Neon isolado real (integração WebSocket pendente)

- [x] Provisionar branch Neon isolada `br-super-star-bbc317wq`, banco `vigia_alt086_staging_20261112` (0 tabelas/policies na criação), sem acessar bases de produção.
- [x] Criar role dedicada `vigia_alt087_staging_reader` (`rolsuper=false`, `rolbypassrls=false`). O owner do banco tem BYPASSRLS e não pode certificar isolamento.
- [x] Executar transação SQL real sob role restrita: `set_config('app.tenant_id', ..., true)` e reset confirmado em consulta independente.
- [x] Guard + teste Neon WebSocket `scripts/tests/alt087-staging-ws-preflight.ts` com checagem do DB exato, role exata, commit/rollback/contexto isolado e recusas de produção.
- [x] Conectar passo opcional ao workflow manual `alt083-neon-e2e.yml`; executa somente após configurar secret `VIGIA_ALT087_STAGING_URL`.
- [ ] Configurar URL privada do banco/role no GitHub Actions secret dedicado, sem expor em logs; disparar o workflow manual e verificar execução no SHA atual.
- [ ] Migrar schema operacional e autenticação no **mesmo staging**; verificar policies A/B, papéis, HTTP WebSocket E2E, reversão de cada tabela e restauração de grants/ACLs/policies.
- [ ] Fazer aprovação de staging e autorização específica antes de qualquer efeito em produção.

Status real: **staging provisionado e SQL transacional básico verificado; homologação WebSocket + rollback operacional no staging ainda NÃO executados.** Ver `docs/vigiaplus/alt087-isolated-staging.md`.

### ALT-08.7B — ensaio de migração reversível no staging Neon dedicado

- [x] Implementar `scripts/tests/alt087-staging-reversible-e2e.ts`: guards DB/role/host, schema sintético exclusivo, RLS real para A/B, grants de SELECT por coluna, leitura PII e escrita negadas, transações WebSocket 771→882→771, rollback de transação e remoção física de schema/policies/grants em finally.
- [x] Adicionar passo opcional ao workflow manual `alt083-neon-e2e.yml` condicionado a credenciais exclusivas de reader `VIGIA_ALT087_STAGING_URL` e migrator `VIGIA_ALT087_STAGING_MIGRATOR_URL`; migrator ausente produz RED (não um GREEN enganoso).
- [x] Documentar contratos, cleanup e separação total do staging operacional em `docs/vigiaplus/alt087-isolated-staging.md`.
- [ ] Validar CI completo do HEAD exato (incluindo TypeScript) após a implementação.
- [ ] Configurar os dois secrets de staging de forma privada; disparar workflow manual e inspecionar os logs dos passos ALT-08.7.
- [ ] Certificar staging de verdade com schema operacional/memberships/entitlements/HTTP no mesmo banco: o ensaio sintético NÃO satisfaz esse gate.
- [ ] Migrar cada tabela operacional em staging sob baseline completo de ACL/policies e rollback comprovado; nenhum deploy sem autorização.

### ALT-08.7C — prova real de rollback RLS no staging (somente objetos sintéticos)

- [x] Em banco Neon staging isolado, antes de DDL: schema `alt087_staging_e2e` inexistente, zero policies/tabelas.
- [x] Migração real transacional: schema+tabela sintética, grants de SELECT por coluna, FORCE RLS e policy de tenant para reader sem BYPASSRLS.
- [x] Testes SQL reais reader: sem tenant zero; tenant 771 somente A; tenant 882 somente B; sem escopo após transação zero; `private_payload` e `UPDATE` negados com SQLSTATE 42501.
- [x] Rollback físico real transacional: policy, flags de RLS, grants, tabela e schema removidos; baseline 0/0/0 restaurado.
- [ ] Configurar secrets de staging WS e executar prova pelo driver Node + workflow manual.
- [ ] Autenticação HTTP, memberships, entitlement e dados operacionais no mesmo staging; incluir owner/analyst/worker sob papéis operacionais separados.

### ALT-08.8 — contratos operacionais sintéticos no mesmo Neon staging

- [x] Revisão de `lib/db/schema.ts`: distinguir auth `users/memberships`, comercial `plans/subscriptions/tenant_features` e Wave 1 `reputation_targets/incidents/notification_channels/invoices`.
- [x] Criar `scripts/tests/alt088-staging-operational-rls-e2e.ts`: ambiente CI protegido, URL/role staging exatas, onze tabelas sintéticas no namespace `alt088_operational_ci`, role reader mínima, validação de membership+entitlement A/B no mesmo banco e leitura RLS das quatro tabelas.
- [x] Ensaiar rollback SQL por tabela em `finally` e exigir catálogo final 0/0/0.
- [x] Adicionar etapa explícita ALT-08.8 ao workflow manual Neon staging atrás dos mesmos dois secrets.
- [x] Documentar limites em `docs/vigiaplus/alt088-operational-staging-gate.md`.
- [ ] CI GREEN no SHA exato e execução real da etapa ALT-08.8 no workflow manual (não confundir etapas puladas).
- [ ] Homologar autenticação HTTP verdadeira + memberships e entitlements no próprio banco operacional de staging (não fixture/consulta privilegiada).
- [ ] Positivar papéis internos owner/analyst/worker/webhook com roles e privilégios separados, e proteger ambientes com roles herdadas/PUBLIC.
- [ ] Validar schema integral, múltiplos vínculos, assinaturas vencidas/revogadas, rollback preservando ACL/policies preexistentes e aprovação explícita antes de qualquer deploy.

Produção **NO-GO**, PR #36 DRAFT, nenhum merge ou deploy.

### ALT-08.9 — autenticação HTTP assinada no mesmo Neon staging (harness)

- [x] Inspecionar `lib/session.ts`, `lib/session-auth.ts`, `lib/tenant/context.ts`, `rls-runtime.ts` e rota Next `/api/app/evidence`; autenticação produtiva ainda usa `getDb()` (PGlite/neon-http), não a sessão WebSocket do staging.
- [x] Criar `scripts/tests/alt089-staging-http-auth-e2e.ts`: servidor HTTP Node efêmero + cookies `sr_session` reais assinados por `signSession/verifySession`, leitura do mesmo banco Neon por role migradora, `withTenantRlsTransaction` com role sem BYPASS, políticas e escopo A/B, revogação de sessão e membership, cancelamento de plano e desabilitação de feature.
- [x] Operar exclusivamente em namespace `alt089_http_ci` com sete tabelas sintéticas, migração e rollback integral reversível `0/0/0`, nunca em `public`.
- [x] Exigir URL/host/role/banco exatos, CI manual, flags específicas e dois secrets de staging; adicionar passo no workflow `alt083-neon-e2e.yml`.
- [x] Documentar restrições em `docs/vigiaplus/alt089-staging-http-auth-gate.md`.
- [ ] CI GREEN no SHA exato da ALT-08.9.
- [ ] Executar workflow manual com ALT-08.9 realmente executada e certificar logs de revogação HTTP e cleanup no SHA.
- [ ] Homologar rota Next real com `resolveTenantContext`/`authenticateSession`/entitlements apontando para **mesmo banco**, schema integral e papéis internos positivos com identidades separadas.
- [ ] Certificar múltiplos memberships, revogação simultânea, expiração de planos e políticas reais com snapshot/rollback preservando ACLs preexistentes.

O harness não substitui a autenticação Next operacional. **Produção NO-GO; sem merge/deploy.**
