# Progresso — Registro de Execução

> Branch de trabalho: `feature/social-intelligence-platform` · Baseline: commit `2c66448` (main, 2026-09-17)
> Formato: cada entrada registra o que foi feito, a evidência e a classificação de qualidade (APROVADO / REPROVADO / PENDENTE / NÃO TESTADO).

## Sessão 2026-11-06

### Fase 0 — Verificação de ambiente — APROVADO

| Item | Resultado | Evidência |
|---|---|---|
| Skill `reap` localizada e lida | OK | `skills/reap/SKILL.md` |
| REA CLI instalado e funcional | OK | `npx rea-agents@latest --help` → `rea@6.8.0` com catálogo completo de comandos |
| REA web-observation (Chrome/CDP) | **INDISPONÍVEL no sandbox** (nenhum Chrome-family browser; `capture-web-screenshot` exige endpoint CDP fornecido) | help do comando + `which chromium` vazio |
| Consequência | Investigação do Talkwalker feita por **fetch de páginas públicas** (método documentado em `talkwalker-capabilities.md`); nenhum resultado inventado | — |
| Radar clonado em workspace isolado | OK | `/workspace/radar-intelligence`, commit `2c66448` |

### Fase A — Investigação Talkwalker — APROVADO (como pesquisa documental)

~20 páginas públicas abertas (talkwalker.com + developer.talkwalker.com); help center exigia login → não acessado (limite ético respeitado). Saída: `docs/research/talkwalker-capabilities.md` (38 capacidades classificadas VERIFICADO / DOCUMENTADO NÃO OBSERVADO / NÃO CONFIRMADO, todas com URL).

### Fase B — Auditoria do Radar — APROVADO

Verificações executadas de fato no baseline: `tsc --noEmit` 0 erros · `npm test` 194/194 · `npm run build` completo (66 rotas). Saída: `docs/research/radar-audit.md` — 30 tabelas no schema, 66 páginas, 55 endpoints, 25 conectores, integração Talkwalker preservada, 10 problemas catalogados (deps mortas, CI sem testes, cron sem auth opcional, sessões não revogáveis etc.).

### Fase C — Gap analysis — APROVADO

`docs/research/gap-analysis.md`: matriz com prioridades P0–P3, separando limitação de implementação vs. limitação de acesso a fontes. Decisão de produto: competir em transparência/custo/self-hosting/BYOK/IA verificável, não em escala de cobertura.

### Fase D — Arquitetura-alvo — APROVADO

`docs/architecture/target-architecture.md`: evolução incremental preservando pipeline/conectores/IA/MCP; multi-tenancy por workspace; 6 ADRs; análise AGPL-3.0 (obrigação de código em serviço hospedado — flag jurídico para o mantenedor).

### Fase F — Incremento 1: pt-BR + CI com testes — APROVADO

**Escopo:** locale `pt` (🇧🇷 Português BR) na interface e no content-locale da IA; dicionário pt-BR com paridade de chaves com o italiano; datas `pt-BR`; `npm test` no CI.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `lib/i18n-dict.ts` | `Locale` + `'pt'`; LOCALES + 🇧🇷; dicionário PT completo (+~200 chaves); novas chaves `ui.noDataYet` e `refresh.*` em IT e PT; `localeTag('pt') = 'pt-BR'` |
| `lib/i18n.ts` | `getLocale()` aceita cookie `sr_locale=pt` |
| `lib/content-locale.ts` | `ContentLocale` + `'pt'`; directiva IA "Brazilian Portuguese"; `kpiLang()` (pt→en documentado) |
| `app/api/locale/route.ts` | aceita `pt` |
| `app/api/content-locale/route.ts` | aceita `pt` |
| `app/api/pov/translate/route.ts` | aceita `pt` |
| `lib/export-data.ts`, `lib/mcp.ts` | usam `kpiLang()` (notas de KPI) |
| `components/ui.tsx` | `docLocale()` mapeia `pt → pt-BR` |
| `components/refresh-button.tsx` | i18n completo (antes hardcoded EN — melhora também o italiano) |
| `components/sidebar.tsx` | `FooterBlock` traduzido + data formatada por locale |
| `tests/i18n-locale.test.ts` | **novo** — 7 testes (paridade IT↔PT, localeTag, directiva, kpiLang, sanidade) |
| `.github/workflows/ci.yml` | passo **Test** adicionado (`npm test`) |

**Ciclos de validação:**

| Ciclo | Resultado | Evidência |
|---|---|---|
| 1 — Técnico (tsc, build) | APROVADO | `tsc --noEmit` 0 erros; build de produção completo |
| 2 — Funcional (testes) | APROVADO | **201/201 testes** (194 originais + 7 novos), 0 falhas |
| 3 — Visual (interface rodando) | APROVADO | servidor de produção local (PGlite, DEMO_MODE documentado); 6 screenshots em `docs/screenshots/inc1-*.png`; validação DOM: navegação, "190 menções encontradas", "Atualizar agora", "Última atualização", `html lang="pt"`, seletor com 🇧🇷 |
| 4 — Produto (requisito da referência) | APROVADO | interface pt-BR entregue conforme requisito da Fase D da missão; Talkwalker não oferece pt-BR de interface como diferencial documentado |
| 5 — Regressão | APROVADO | EN e IT continuam funcionando (cliques testados: "Listening"/"Ascolto"/"Aggiorna ora"); `/api/content-locale` com `pt` → HTTP 200 `{"contentLocale":"pt"}` |

**Limitações conhecidas (documentadas, não escondidas):**

1. Notas de confiabilidade dos KPI (`lib/kpi-standard.ts`, ~50 strings inline it/en) permanecem em inglês para usuários pt-BR — tradução planejada no Incremento 3 (`kpiLang()` já isola o mapeamento).
2. Strings de componentes fora do dicionário (ex.: seções "Facts & checks" com `L(lang, it, en)` próprio) seguem o padrão original it/en — pt usa inglês nelas até o Incremento 2/3.
3. `.env.example` incompleto, deps mortas, hardening de sessão/cron: **pendências do Incremento 2** (ver `roadmap.md`).
4. CI do GitHub não pôde ser executado neste sandbox (sem runner) — o workflow foi editado e validado sintaticamente; classificação do passo Test no GitHub Actions: **NÃO TESTADO** localmente, PENDENTE de execução no push.

### Decisões técnicas registradas

- Código do locale: `'pt'` (2 letras — compatível com os regexes existentes de cookie `sr_locale`), tag de formatação `pt-BR`.
- Paridade IT↔PT garantida por teste (contrato: UI pt-BR não fica pela metade).
- Dicionário pt-BR traduzido com vocabulário de social listening brasileiro ("Escuta", "Menções", "Avaliações", "Pergunte aos dados").
- Novas chaves `refresh.*` adicionadas aos dicionários IT **e** PT (o teste de paridade força isso — benéfico).

## Pendências (próxima sessão)

1. Incremento 2 (hardening): sessões revogáveis, cron auth obrigatória, `.env.example` completo, remoção deps mortas, rota fantasma `/tour`.
2. Incremento 3: busca semântica no `/ask`, alertas com limiares, tradução das notas de KPI para pt-BR.
3. Push da branch + PR quando houver acesso autorizado ao repositório remoto.
4. Revisão jurídica AGPL-3.0 para qualquer modelo de hospedagem comercial (flag para o mantenedor).

## Sessão 2026-11-06 (2ª parte) — Auditoria externa do Incremento 1 + Incremento 2

### Auditoria externa recebida

O auditor analisou o ZIP entregue e encontrou **diferenças entre as conclusões do relatório e as evidências**: telas pt-BR ainda exibiam controles em inglês ("Search text…", "Refresh now", "Export", filtros, títulos de gráficos), embora o dicionário tivesse paridade de chaves. Diagnóstico confirmado: **vários componentes nunca passavam pelo dicionário** (padrão `L(lang, it, en)` que ignora pt, literais hardcoded, `CopyButton` com fallback italiano). A auditoria estava correta e o relatório anterior superestimou a cobertura.

### Revisão do Incremento 1 — APROVADO (após correções)

**Correções:** 23 arquivos. Controles, gráficos, filtros e títulos das 6 telas auditadas agora renderizam pt-BR: banner demo, ExportBar completo, SearchBox, TranslateBar, CopyButton (bug "copia" italiano), MentionCard/ArticleBody/MentionBody, painel Radar e títulos de gráficos do dashboard, filtros e linha de cobertura da Escuta, hub de insights completo (7 grupos + 16 perguntas via dicionário; remove literal italiano "I tuoi grafici"), benchmark (títulos, tabela, badges), KPI completo (86 strings do data-reliability + kpi-standard + kpi-export com 4º argumento pt; números pt-BR "1.234,5", "n/d", vereditos), `kpiLang('pt')→'pt'`, legenda do SentimentPie, `BRIEF_SYSTEM` não força mais inglês nos headings.

**Testes:** 213 (12 novos em `tests/i18n-rendered.test.ts`) — afirmam **valores renderizados** (não só paridade de chaves) e fazem checagens anti-regressão nos fontes; paridade de argumentos L() na pilha KPI verificada por tokenizador de teste.

**Telas recapturadas** (`docs/screenshots/inc1-*.png`, servidor de produção local, cookie `sr_locale=pt`): reauditoria visual por VLM confirmou — dashboard sem resíduos de UI em inglês (restam apenas dados: nome do projeto "Artificial Intelligence", tópicos/descrições gerados pela IA no seed, marcas); KPI aprovado ("Taxa de engajamento sobre o alcance" visível); brief com data pt-BR "SEXTA-FEIRA, 6 DE NOVEMBRO DE 2026", botão "copiar", chip "a IA escreve em 🇧🇷".

**Decisões de escopo registradas (UI vs. dados externos):**
- **Dados (permanecem no idioma original):** títulos/corpos de menções e artigos, tópicos e descrições de tendências (gerados pela IA e persistidos no seed), nome do projeto ("Artificial Intelligence"), nome da conta demo ("Demo viewer"), marcas (GitHub, fontes).
- **Nomes de produto mantidos em inglês (decisão deliberada):** Studio Graph, Point of View, Share of Voice, Content Studio, War Room — prática também do material pt-BR do próprio Talkwalker/Lumen.
- **NÃO TESTADO:** resposta real da IA em pt-BR — não existe chave autorizada neste ambiente (ANTHROPIC_API_KEY ausente; em DEMO_MODE a IA é desligada por design). O bug do prompt do brief (forçava inglês) foi corrigido no código, mas a geração real fica NÃO TESTADA até existir chave autorizada.

### Investigação com REA — APROVADO (engenharia executada, limites respeitados)

O impedimento anterior (sem Chrome/CDP) foi **resolvido**: Chromium headless (binário do Playwright, Chrome/143) lançado com `--remote-debugging-port=9222`; REA conectou via `http://127.0.0.1:9222`. Observação **passiva** de páginas públicas do Talkwalker (home + social-media-listening + screenshot), sem autenticação, help center SAML não tocado. Evidence IDs: `ev_9dd34d44…` (targets), `ev_28feb590…` (home), `ev_86af5535…` (produto), `ev_29bf3e28…` (screenshot sha256 `dee74285…`). Bundles: `docs/research/evidence/`. Descobertas promovidas para "observed" em `talkwalker-capabilities.md`: rebranding "Lumen by Talkwalker" no DOM ao vivo, arquitetura de navegação produtos/soluções/personas, visual listening, stack público (Optimizely, centro de cookies, rodapé Hootsuite). **O produto logado permanece DOCUMENTADO NÃO OBSERVADO.**

### Incremento 2 — Hardening — APROVADO

| Requisito do audit | Status | Evidência |
|---|---|---|
| Sessões revogáveis | FEITO | cookie `<uid>.<version>.<hmac>`; coluna `users.session_version`; `POST /api/auth {revokeAll}` = sair de todos os dispositivos |
| Invalidação após troca de senha | FEITO | `changePassword` faz bump da versão e reemite o cookie do dispositivo atual; cookies antigos morrem no `getCurrentUser` |
| Auth obrigatória nas rotas cron | FEITO | `lib/cron-auth.ts` fail-closed: produção sem `CRON_SECRET` → 500 recusando executar; Bearer errado → 401; dev sem segredo permitido (local) |
| `SESSION_SECRET` obrigatório em produção | FEITO | `sessionSecret()` lança erro em produção sem `SESSION_SECRET`/`APP_PASSWORD` (fim do fallback público) |
| Testes de acesso não autorizado | FEITO | 15 testes (`tests/security-hardening.test.ts`); E2E contra build de produção: demo cron/refresh/content-locale → 403; produção sem segredo → 500; sem/errado Bearer → 401; páginas sem login → 307/401 |
| Revisão de configs e dependências | FEITO | deps mortas `jspdf`/`modern-screenshot` removidas; bypass fantasma `/tour` removido do proxy; `.env.example` +16 variáveis `cfg()` ausentes |
| Nenhum modo demo expõe operações privilegiadas | FEITO | cron 403, refresh 403, content-locale 403 em demo; IA já era desligada em demo; escrita de projetos/queries já bloqueada em demo |

**Validação final:** `tsc` 0 erros · lint 0 erros (43 avisos pré-existentes; o erro pré-existente de `require()` no test de report-sections foi corrigido — o CI roda lint e quebraria) · **228/228 testes** · build de produção sem segredos OK.

**Nota de deploy:** cookies de sessão emitidos antes desta mudança são rejeitados (mudança do formato assinado) — revogação de massa intencional; `SESSION_SECRET` explícito passa a ser pré-requisito em produção.

### Rastreabilidade dos commits (branch `feature/social-intelligence-platform`)

| Incremento | Commit |
|---|---|
| Incremento 1 (i18n + CI) | `d062a6b` |
| CI com testes | `2717102` |
| Pesquisa/arquitetura/roadmap | `b94bc66` |
| **Revisão do Incremento 1 (pós-audit)** | `069bd79` |
| Pesquisa Talkwalker via REA (evidências) | `bbdcce9` |
| **Incremento 2 (hardening)** | `a029ce0` |

**CI no GitHub Actions: NÃO EXECUTADO** — este ambiente não tem runner nem acesso autorizado ao remoto (sem push, conforme instruído). Todos os passos do workflow (lint, tsc, test, build) foram executados localmente no commit `a029ce0` com sucesso. A classificação de CI no GitHub permanece **NÃO TESTADO** até o push autorizado; nada aqui é apresentado como "CI GREEN".

## Sessão 2026-11-07 (3ª parte) — Correções P0 da auditoria dos Incrementos 1 e 2

### Auditoria externa recebida (falhas P0 confirmadas no código)

O auditor aprovou commits/HEAD, investigação REA e i18n, mas reprovou o Incremento 2 por falhas de segurança. Cada falha foi **confirmada no código antes de corrigir**:

| # | Falha apontada | Diagnóstico confirmado |
|---|---|---|
| 1 | `proxy.ts` valida só a assinatura; rotas dependiam do middleware | O proxy não abre o DB (sem PGlite no runtime do proxy); `getCurrentUser` verificava a versão, mas rotas como `/api/refresh` não passavam por ele — encadeamento: cookie revogado → usuário nulo → projeto nulo → `runPipeline({projectId: undefined})` |
| 2 | `POST /api/auth {revokeAll}` aceitava cookie de sessão já revogada | Só `verifySession` (firma), sem confronto com `users.session_version` |
| 3 | `/api/refresh` transformava ausência de projeto em operação global | `project?.id` → `undefined` → pipeline sobre TODOS os projetos |
| 4 | Endpoints de refresh especiais sem bloqueio em DEMO_MODE | `reviews/wikipedia/facts/trials/sport/refresh`, `timeline`, `translate`, `pov`, `brief` etc. executavam ingestão/persistência na demo |
| 5 | `SESSION_SECRET` aceitava fallback para `APP_PASSWORD` | `sessionSecret()` usava `SESSION_SECRET \|\| APP_PASSWORD`; sem política de comprimento/entropia; sem validação no boot |
| 6 | Datas incorretas nos registros | Sessões anteriores datadas de 07/11/2026, mas os commits são de 06/11/2026 (corrigido em progress.md, roadmap.md e cabeçalhos das pesquisas) |

### Correções implementadas (branch `feature/social-intelligence-platform`, commits anteriores preservados)

**1. Desacoplamento firma/revoga resolvido na arquitetura certa.** O proxy (middleware) continua sendo um **pre-filtro de firma** — documentado no próprio arquivo: ali não existe DB. A autenticação real (firma + existência do usuário + **versão da sessão contra o banco**) passou a acontecer DENTRO de cada rota protegida:

- `lib/session-auth.ts` (novo, sem `next/headers` — testável contra DB isolado): `authenticateSession(db, cookie)` → `{ok, user}` \| `{status:401, reason: 'no-cookie'|'bad-signature'|'unknown-user'|'revoked'}`; `bumpSessionVersion`; `revokeAllSessions`.
- `lib/api-guard.ts` (novo): `requireProject({write})` (demo → 403; não autenticado → 401; **sem projeto acessível → 404, nunca fallback global**), `requireUser`, `requireWriteUser`, `requireAdminProject`.
- `lib/project-access.ts` (novo): regra de escopo (`member` = próprios + compartilhados; `admin` = todos) extraída de `lib/data.ts` para verificação com DB isolado.

**2. `revokeAll` recusa cookie revogado.** `POST /api/auth {revokeAll}` agora passa por `revokeAllSessions`: firma + versão no ANTES do bump. Cookie revogado → 401 `{"error":"sessione già revocata"}` e **nenhum bump adicional**.

**3. `/api/refresh` nunca mais global.** `requireProject({write:true})`: sem projeto acessível → 404 `{"error":"nessun progetto accessibile"}` ANTES de `runPipeline`; a pipeline sempre recebe `projectId` explícito.

**4. DEMO_MODE estritamente read-only.** Guards `write` aplicados a todos os endpoints que ingerem/persistem: refresh especial (reviews/wikipedia/facts/trials/sport), `timeline`, `pov`, `pov/translate`, `brief`, `compare`, `insights/causal`, `insights/clusters`, `influencer`, `playbook`, `translate`. AI sob demanda já era bloqueada no provider (`callClaude` recusa em demo); studio/import/report já eram admin-gated (o usuário da demo é `member`).

**5. Segredos de produção.** `SESSION_SECRET` obrigatório, explícito e **independente de `APP_PASSWORD`** (o fallback foi removido); política: ≥ 32 caracteres, ≥ 4 caracteres distintos, nada de valores notórios, não pode igualar `APP_PASSWORD` (`lib/config-check.ts`). Validado **no boot** por `instrumentation.ts`/`instrumentation-node.ts`: produção fora da demo com segredo ausente/ruim → `process.exit(1)` com mensagem clara (fail closed; o throw simples era engolido pelo runtime — descoberto e corrigido durante o E2E). Fail-closed do cron preservado. `.env.example` e `SECURITY.md` atualizados.

**6. Datas corrigidas:** sessões anteriores re-datadas para 2026-11-06 (data real dos commits `d062a6b`…`253cb53`).

### Inventário auditado — todos os endpoints mutáveis (POST/PUT/PATCH/DELETE)

Colunas: autenticação · versão de sessão no DB · autorização · escopo de projeto · comportamento em DEMO_MODE.

| Endpoint | Auth | Versão sessão | Autorização | Escopo | DEMO_MODE |
|---|---|---|---|---|---|
| `/api/refresh` | cookie | ✔ guard | usuário | projeto acessível; sem projeto → **404, nunca global** | **403** |
| `/api/reviews/refresh` | cookie | ✔ guard | usuário | idem | **403** |
| `/api/wikipedia/refresh` | cookie | ✔ guard | usuário | idem | **403** |
| `/api/facts/refresh` | cookie | ✔ guard | usuário | idem | **403** |
| `/api/trials/refresh` | cookie | ✔ guard | usuário | idem | **403** |
| `/api/sport/refresh` | cookie | ✔ guard | usuário | idem | **403** |
| `/api/timeline` | cookie | ✔ guard | usuário | idem (persiste eventos) | **403** |
| `/api/pov` · `/api/pov/translate` | cookie | ✔ guard | usuário | idem (persiste tese/tradução) | **403** |
| `/api/brief` | cookie | ✔ guard | usuário | idem (persiste brief) | **403** |
| `/api/compare` | cookie | ✔ guard | usuário | idem (cache meta pós-IA) | **403** |
| `/api/insights/causal` · `/api/insights/clusters` | cookie | ✔ guard | usuário | idem (cache meta) | **403** |
| `/api/influencer` | cookie | ✔ guard | usuário | idem (persiste perfil) | **403** |
| `/api/playbook` | cookie | ✔ guard | usuário | idem (atualiza alertas) | **403** |
| `/api/translate` | cookie | ✔ `getCurrentUser` | usuário | mention própria do escopo (persiste tradução) | **403** |
| `/api/ask` · `/api/expand` · `/api/studio/hooks` · `/api/studio/kit` · `/api/studio/refine` | cookie | ✔ guard | usuário | projeto acessível (só leitura + IA sob demanda) | leitura ok; **IA desligada no provider** |
| `/api/studio` · `/api/studio/comment` · `/api/studio/countries` | cookie | ✔ `getCurrentUser` | **admin** | projeto atual | demo user é `member` → **403** |
| `/api/report/custom` · `/api/report/comment` · `/api/report/periodic` · `/api/report/schedule` | cookie | ✔ `getCurrentUser` | **admin** | projeto atual (id nunca vem do client) | idem |
| `/api/import/*` (files, agent, analyze, preview, normalized) | cookie | ✔ `getCurrentUser` | **admin** | projeto `mode=upload` | idem |
| `/api/reviews/import` | cookie | ✔ `getCurrentUser` | **admin** | projeto atual | idem |
| `/api/locale` | cookie | ✔ `getCurrentUser` | usuário | — só cookie de UI, **sem persistência** (exceção deliberada) | permitido |
| `/api/content-locale` | cookie | ✔ `getCurrentUser` | usuário | — preferência de idioma da IA | **403** |
| `/api/auth` | pública (login) / cookie (logout, revokeAll) | ✔ `revokeAllSessions` para revokeAll | própria conta | — | logout ok; revokeAll **403**; login sem usuários → 401 |
| `/api/admin/mcp-test` | cookie | ✔ `getCurrentUser` | **admin** | — | demo user é `member` → **403** |
| `/api/mcp` | token `RADAR_MCP_TOKEN` (sem token → 503) | — (token) | token | ferramentas **somente leitura** | exige token do operador |
| `/api/cron/daily` · `/api/cron/reports` (GET) | `CRON_SECRET` Bearer | — | segredo | todos os projetos (job noturno, por design) | **403**; produção sem segredo → **500 fail-closed** |

Exceções deliberadas e documentadas em DEMO_MODE: `/api/locale` (cookie de interface, zero persistência), exportações GET (leitura), lookups GET (yelp/wikipedia/sport: consulta externa pontual sem persistência; sem chaves salvas na demo), e o plano de query-builder pré-gerado (`DEMO_PLAN`).

### Testes de regressão reais (o que o audit exigiu)

**Integração com banco isolado** — `tests/security-integration.test.ts` (13 testes, PGlite usa-e-getta em tmpdir, sem `next/headers`):

| Cenário exigido | Teste | Resultado |
|---|---|---|
| Cookie válido antes da revogação | `authenticateSession` aceita | ✔ |
| Cookie revogado recusado | API: 401 `revoked`; **e documenta que o proxy de sola firma o deixaria passar** (2a/2b) | ✔ |
| Usuário deletado | 401 `unknown-user` | ✔ |
| Troca de senha invalida sessões anteriores | bump + re-emissão: cookie velho morto, novo vivo | ✔ |
| `revokeAll` com cookie revogado recusado | 401 `revoked` e **versão no DB intacta** (4a) | ✔ |
| Usuário sem projeto não executa refresh global | escopo no DB: member sem projetos → 0 projetos → alvo nulo (5a/5b); membro com projeto compartilhado enxerga só ele (5c) | ✔ |
| Segredos ausentes/inválidos bloqueiam operações privilegiadas | boot/produção sem segredo falha; `APP_PASSWORD` não substitui; curto/noto/ripetitivo/igual à senha recusados (7a–7d) | ✔ |

**E2E contra build de produção** — `scripts/e2e-security.mjs` (27 verificações, servidores reais `next start` com DB isolado por cenário; evidência em `docs/research/evidence/e2e-security/e2e-security.log`):

| Cenário | Verificações | Resultado |
|---|---|---|
| A — revogação | login → API 200 com cookie → `revokeAll` 200 → cookie velho 401 → **`revokeAll` com cookie revogado 401** → novo login funciona | 6/6 ✔ |
| B — usuário sem projeto | member sem projetos: `/api/refresh` → **404 `nessun progetto accessibile`**; `/api/reviews/refresh` → 404; sem cookie → 401; **DB: zero locks de pipeline** (prova diferencial: antes da correção o fallback global gravava `pipeline_lock`) | 5/5 ✔ |
| C — demo read-only | home 200; 13 POSTs de ingestão/persistência → 403; cron → 403 | 14/14 ✔ |
| D — boot fail-closed | produção sem `SESSION_SECRET` → servidor **recusa arrancar** com mensagem explícita (`process.exit(1)`; nada é servido) | 1/1 ✔ |

Credenciais dos testes: sintéticas, em bancos usa-e-getta destruídos após o run — nenhum segredo real exposto.

### Ciclos de qualidade

| Ciclo | Resultado | Evidência |
|---|---|---|
| 1 — Técnico | APROVADO | `eslint` 0 erros (44 avisos pré-existentes); `tsc --noEmit` 0 erros; `next build` ✓ |
| 2 — Funcional | APROVADO | **245/245 testes** (228 anteriores + 13 de integração + 4 de política de segredos); 0 falhas |
| 3 — E2E de segurança | APROVADO | 27/27 verificações contra `next start` de produção (log arquivado) |
| 4 — Regressão | APROVADO | todos os 228 testes pré-existentes seguem passando; i18n e CI inalterados |
| CI no GitHub Actions | **NÃO TESTADO** | sem runner/remoto autorizado (sem push); workflow válido sintaticamente, passos executados localmente |

### Classificação das pendências

| Pendência | Classificação |
|---|---|
| P0-1 Revogação de sessões (middleware × APIs) | **CORRIGIDO / APROVADO** (integração + E2E) |
| P0-2 `/api/refresh` sem fallback global | **CORRIGIDO / APROVADO** (E2E com prova diferencial no DB) |
| P0-3 Auditoria de endpoints mutáveis + DEMO_MODE | **CORRIGIDO / APROVADO** (inventário acima + 14 verificações E2E) |
| P0-4 Segredos de produção | **CORRIGIDO / APROVADO** (política + boot fail-closed verificado) |
| P0-5 Testes de regressão reais | **ENTREGUE / APROVADO** (13 integração + 27 E2E) |
| Datas dos registros | **CORRIGIDO** (sessões anteriores → 2026-11-06) |
| Retenção configurável + exportação antes do descarte | **PENDENTE (P0 novo)** — registrada no roadmap |
| Geração real de IA em pt-BR | NÃO TESTADO (sem chave autorizada) |
| CI no GitHub / push / merge / deploy | NÃO TESTADO / NÃO EXECUTADO (sem autorização) |

### Nota de deploy

`SESSION_SECRET` independente passa a ser pré-requisito absoluto de produção (boot recusado sem ele). Deployments que usavam `APP_PASSWORD` como segredo de sessão devem gerar `SESSION_SECRET` próprio (`openssl rand -hex 32`) — trocar o segredo revoga todas as sessões existentes (comportamento desejado).

## Homologação cloud independente — 2026-11-06 (America/Sao_Paulo)

Fonte desta execução: ZIP `radar-intelligence-correcoes-p0.zip`, inicialmente sem Git. O proprietário autorizou sua importação no repositório limpo `OARANHA/crises`; baseline verdadeiro `875aac37f58925b7ddf502843c75c184a1b7dc22`. Os commits históricos acima não vieram no ZIP e não foram reconstruídos.

Resultado e evidências atuais: [docs/homologacao/README.md](homologacao/README.md). A reprodução encontrou **14 testes de integração**, incluídos nos 245 originais. A suíte atual tem 261 testes totais, mais 27 E2E de produção e 7 verificações extras de Server Actions/Studio. Uma lacuna P0 real nas Server Actions foi reproduzida e corrigida; portanto o antigo 27/27 não cobria sozinho a alegação de demo estritamente read-only.

Código em execução na demo de produção: `746e509320fe72bd91981f740d19127b4c4ec4d1`, branch `fix/radar-homologacao-p0`; evidências de fechamento podem estar em commit documental posterior. Não houve merge. PR/CI remoto permanecem dependentes da API GitHub acessível e de conferência do HEAD exato. Retenção/exportação segue P0 pendente; IA real em pt-BR não validada; Incremento 3 bloqueado.


## Sessão 2026-11-07 — VigiaElus / CRF-RS — Etapas 1 e 2

**Origem:** ordem explícita do proprietário para implementar o piloto `CRF-RS — Reputação e Comunicação`, em branch isolada de `fix/radar-homologacao-p0`. Esta entrada registra mudanças verificáveis no Git; **o status de qualidade continua PENDENTE até CI, banco e navegador efetivamente testados**.

- Reconciliados: repositório privado `OARANHA/wmemory` (`MEMORY.md` e `OPERATING_RULES.md`); banco ELUS Memory Admin `vigiaelus`; AGENTS.md, homologação P0 e roadmap do repositório.
- HEAD P0 usado como base: `e8d127e1c1b706fe05bb5a87af22d59e753328c3`.
- CI do HEAD P0: run https://github.com/OARANHA/crises/actions/runs/42323441870 = **FAILURE**; install/lint/TS/261 testes/build/security E2E (27 controles) passaram, mas runner Server Actions falhou no Node 22 por inline `tsx -e` / import ESM não disponível. Correção incluída apenas na branch do piloto; verificar novo CI antes de atribuir GREEN.
- Branch criada: `feat/vigiaelus-crfrs-etapas-1-2`; app P0 e branch original preservados, nenhuma PR mergeada.
- Implementado: definições de três entidades, aliases restritos, canonicalização de URL e razão de descarte; fonte por projeto; piloto idempotente, coleta autenticada explicitamente pelo ID, preservação de DEMO_MODE e ownership.
- Migradas estruturas aditivas: `projects.enabled_sources/pilot_key`, `mentions.canonical_key`, `collection_runs`, `collection_run_sources`, `mention_entities` e `mention_discoveries`.
- Isolado o estado global `source_status` por ID de projeto; RSS passa a receber feeds diretamente na consulta, sem memória global mutável.
- Interface operacional `/vigia`: entidades, habilitação de fontes, status, histórico e menções filtradas.
- Testes criados: `tests/vigia-core.test.ts` e `tests/vigia-integration.test.ts` (stubs sintéticos, PGlite de teste, histórico após reabertura e falhas parciais).
- RSS real, notícia estruturada do portal CRF-RS, verificação de resultados públicos e teste visual **PENDENTES / NÃO TESTADOS**. Google News e GDELT configurados mas não declarados operacionalmente validados.
- **Bloqueio produtivo preservado:** P0 de retenção e exportação antes do descarte. Não houve modificação de banco produtivo, purge, deploy nem merge.
- Rastreabilidade completa e limites em `docs/vigiaelus-crfrs.md`.

