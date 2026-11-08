# Auditoria Técnica do Radar Intelligence

> **Data:** 2026-11-06 · **Baseline:** commit `2c6644884c3515d7316ce8023a799d529b14351c` (2026-09-17, branch `main`) do repositório `Scognamiglio1969/radar-intelligence`, clonado em workspace isolado.
> **Verificações executadas de fato neste baseline:** `npx tsc --noEmit` → **0 erros** · `npm test` → **194/194 testes passando** (~49s) · `npm run build` → **build de produção completo** (66 rotas + Proxy/Middleware reconhecido pelo Next 16).

## 1. Arquitetura real

- **Stack:** Next.js 16.2.10 (App Router, React 19), TypeScript strict, Tailwind 4, Drizzle ORM, Recharts + three.js, zod, `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`.
- **Persistência dupla** (`lib/db/index.ts`): `DATABASE_URL` → Neon serverless; sem URL → **PGlite embutido** em `.data/pglite`. Schema por DDL `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (drizzle-kit apenas em devDependencies).
- **Fluxo de dados:** cron Vercel (`vercel.json`: `/api/cron/daily` 05:00, `/api/cron/reports` 07:00) ou botão "Refresh now" (`app/api/refresh`) → `lib/pipeline.ts` `runPipeline()` → ingestão por conector (`lib/ingest.ts`) → enriquecimento de artigos (`lib/article-enrich.ts`) → seções autônomas (reviews/sport/trends/wikipedia/fact-checks/trials) → análise IA (`lib/claude.ts`) → alertas/trends/narrativas/stories/brief/POV → notificações Telegram (`lib/notify.ts`).
- **Middleware:** `proxy.ts` (middleware do Next 16) — gate de sessão em toda a app; exclui `/landing`, `/login`, `/api/auth`, `/api/cron/*`, `/share/*`, `/tour` (rota fantasma — não existe), `/api/mcp`. `DEMO_MODE=1` desliga o gate.
- **Idioma:** código/comentários em italiano; i18n UI EN/IT (`lib/i18n.ts`, `lib/i18n-dict.ts`); "content locale" independente para a IA (`lib/content-locale.ts`).

## 2. Páginas (66 `page.tsx`) — inventário

| Grupo | Rotas | Status |
|---|---|---|
| Core | `/` (dashboard), `/landing`, `/login` | Existente e funcional |
| Monitor | `/listening`, `/source/[source]`, `/alerts`, `/timeline`, `/brief` | Existente e funcional |
| Projetos | `/import`, `/measures`, `/people`, `/query` | Existente e funcional |
| Analyze | `/kpi`, `/media`, `/benchmark`, `/audience`, `/content`, `/messages`, `/emv`, `/narratives`, `/stakeholders`, `/graph` | Existente e funcional |
| Insights (17) | `/insights/{topics,constellation,flow,clusters,network,pyramid,crisis,galaxy,geo,heatmap,momentum,sov,emotions,waterfall,causal,owned,health}` + hub | Existente e funcional |
| Interpret | `/pov`, `/ask`, `/riscontri`, `/verifiche`, `/evidenze`, `/podcast`, `/reviews`, `/sport`, `/wikipedia` | Existente e funcional |
| Create | `/studio`, `/report`, `/report/periodic`, `/tv`, `/story`, `/share/[token]` | Existente e funcional |
| Setup | `/settings`, `/impostazioni/{account,team,fonti,budget,credits}`, `/mcp`, `/account`, `/team`, `/changes` | Existente e funcional |

**Nenhuma página órfã** (sem backend): todas leem do DB via `lib/data.ts` ou módulos próprios.

## 3. API endpoints (55 `route.ts`) — principais

| Endpoint | Método | Função | Status |
|---|---|---|---|
| `/api/auth` | POST | login/logout, cookie HMAC (`lib/session.ts`), delay anti-bruteforce 400ms | Funcional |
| `/api/refresh` | POST | pipeline full do projeto corrente (`maxDuration=300`) | Funcional |
| `/api/cron/daily`, `/api/cron/reports` | GET | pipeline de todos + digest Telegram; **proteção só com `CRON_SECRET`** | Funcional; **risco se secret unset** |
| `/api/ask`, `/api/brief`, `/api/playbook`, `/api/influencer`, `/api/translate`, `/api/pov`, `/api/expand` | POST | features IA (chat, brief, crisis playbook, perfil influenciador, tradução, POV) | Funcional |
| `/api/studio/*`, `/api/report/*`, `/api/timeline`, `/api/insights/*`, `/api/compare`, `/api/facts/refresh`, `/api/trials/refresh`, `/api/wikipedia/*`, `/api/sport/*`, `/api/reviews/*` | POST/GET | CRUD e features de seções | Funcional |
| `/api/import/{agent,analyze,audit,files,normalized,preview,spotcheck}` | GET/POST/PATCH | workspace de importação; **admin-guard** (`isAdmin`) em agent/analyze/spotcheck/PATCH | Funcional |
| `/api/export/{pdf,docx,pptx,xlsx,report,periodic}` | GET | exportações | Funcional |
| `/api/mcp` | POST/GET | servidor MCP streamable-HTTP; 503 sem `RADAR_MCP_TOKEN`, 401 token inválido (comparação constant-time) | Funcional |
| `/api/locale`, `/api/content-locale` | POST | preferências de idioma (só aceitam `en`/`it`) | Funcional |

## 4. Modelo de dados (`lib/db/schema.ts`, 30 tabelas)

`users` (role admin/member, `aiEnabled`, `mustChangePassword`) · `projects` (mode listening/upload/talkwalker, `talkwalkerProject/Topics`, `queryPlan` JSONB, ownerId + visibility private/shared, keywords/allTerms/excludeTerms, languages, countries, keyMessages, telegramChannels, rssFeeds, brandVoice, semanticContext, evidenceTerms) · `benchmark_entities` (isOwnBrand) · `mentions` (~35 colunas: kind article/post, sentiment/score, emotion (6 Plutchik), relevance 1–5 + reason, translations cache, topics/entities/quality JSONB, custom JSONB, queryIds, storyId, importFileId, country, engagement, reach) · `stories`, `alerts`, `briefs`, `api_usage` (tokens/custo por chamada), `meta` (KV: locks, orçamento, credenciais cifradas), `trends`, `narratives`, `influencer_profiles`, `content_ideas`, `share_links`, `timeline_events`, `review_sources`/`reviews`, `sport_sources`/`sport_matches`/`stock_prices`, `search_interest`, `wiki_pages`/`wiki_edits`, `import_files`/`import_rows`, `custom_reports`/`periodic_reports`, `metric_points`, `studio_charts`, `fact_checks`, `clinical_trials`.

## 5. Sistema de IA — o que existe de fato

Tudo passa por `lib/claude.ts` (`callClaudeDetailed` → `lib/ai-provider.ts`): **4 provedores** (Anthropic, OpenAI, Grok, Azure OpenAI) com tier fast/smart, modelos editáveis pela UI. **Orçamento mensal rígido** (`API_BUDGET_USD`, default $6) com medição real de custo por tokens (`api_usage`) e frenagem antes de cada chamada. Features implementadas (prompts lidos no código): análise de menções em batch (idioma, sentimento, emoção, relevância 1–5, tópicos, entidades), quality scores, clustering de stories, daily brief (janela adaptativa 24h→7d→30d, recusa sobre zero dados), query builder NL→boolean testado ao vivo (`lib/query-builder.ts`), POV com fact-pack SQL + validação de citações (`lib/pov.ts`), narrativas, trends explicados, alertas com contexto, "ask the data", translate, content studio (kit/hooks/refine), comentário de relatório, agente de importação (`lib/import-agent.ts`), playbook de crise. Erros tipados (`AiFailure`: no-key/budget/call-failed/empty/demo).

## 6. Conectores/fontes — 25 registrados em `lib/connectors/index.ts`

Googlenews, GDELT, Reddit, Bluesky, Mastodon, HackerNews, YouTube, Telegram, RSS, LinkedIn-web (via Tavily), StackExchange, GitHub, Discord, SEC-EDGAR, arXiv, Lemmy, Newsdata, PodcastIndex (free/freekey) + premium: X, Instagram, Facebook, TikTok, LinkedIn, NewsAPI, **Talkwalker**. Fora do modelo de menções: App Store/Google Places/Yelp (`lib/reviews/`), football-data.org/Alpha Vantage (`lib/sport/`), Google Trends (`lib/search-interest/`), MediaWiki (`lib/wikipedia/`), Google Fact Check Tools (`lib/factcheck.ts`), ClinicalTrials.gov (`lib/trials.ts`), OpenAlex (`lib/openalex.ts`). A ingestão (`lib/ingest.ts`) tem: limite de concorrência por conector, rotação de termos, batching, filtro booleano central, dedupe, classificação article/post, retenção de 90 dias (só dados coletados; imports preservados).

## 7. Integração Talkwalker — detalhes técnicos

`lib/connectors/talkwalker.ts` (218 linhas) + `lib/ingest.ts` + `tests/talkwalker.test.ts` (14 testes):

- **Token:** `TALKWALKER_ACCESS_TOKEN` via `cfg()` (UI cifrada em `meta` com AES-256-GCM, `lib/connector-credentials.ts`, ou env como fallback). Sem token: `enabled()=false` e `fetchMentions` retorna `[]` — nenhuma chamada, nenhum custo.
- **Endpoints:** `GET /api/v1/search/p/<project>/results` (ou `/api/v1/search/results`), params `access_token`, `q`/`topic[]`, `hpp` (≤500, default 100), `time_range=7d`; topics via `/api/v2/talkwalker/p/<id>/topics/list` com fallback `/resources`.
- **Modelo:** projeto mode `talkwalker` = Talkwalker é a única fonte; precedência topic > query booleana (`talkwalkerQuery`, teto 50 operandos/4096 chars) > tudo.
- **Créditos:** orçamento diário estimado (`TALKWALKER_DAILY_CREDITS`, default 1000; 10/chamada + 1/resultado) contado em `meta` por dia; esgotado → ingestão pulada com erro explícito.
- Mapeamento doc→mention preserva autor, fonte, país, reach.

**Conclusão:** a integração existente está preservada e é sólida — deve ser mantida e estendida, não substituída.

## 8. Autenticação / multi-tenancy — realidade

- Login funcional: `users` + scrypt (`lib/password.ts`), cookie assinado HMAC (`sr_session`, httpOnly, 30d), admin default `admin@example.com/changeme` com troca forçada, gestão de equipe em `/impostazioni/team`.
- **Isolamento parcial single-instance:** `projects.ownerId` + `visibility`; `getProjects()` filtra por dono+shared; AI por usuário desativada até admin ativar (`users.aiEnabled`).
- **Não é multi-tenant enterprise:** base única; credenciais de conectores globais por instância; token MCP vê todos os projetos; rotas de import admin-only; sessão não revogável server-side.

## 9. Exportações

`app/api/export/*`: **PDF** (`lib/report-pdf.ts`, pdfkit), **DOCX** (docx), **PPTX** (pptxgenjs), **XLSX** (exceljs) + disclosure AI Act (art. 50) em notas (`lib/ai-disclosure.ts`). **`jspdf` e `modern-screenshot` são dependências mortas** (sem nenhum import no código).

## 10. Testes e CI

- **194 testes** (`node:test` + tsx), 20 arquivos em `tests/`: forte em import (~110) e Talkwalker (14); **zero testes** para auth/sessão, ingest de rede dos conectores, export, pipeline.
- **CI (`.github/workflows/ci.yml`):** npm ci → lint → `tsc --noEmit` → build. **NÃO executa `npm test`** — lacuna real (corrigida no Incremento 1).
- `scripts/`: 4 utilitários de smoke test manuais contra APIs vivas.

## 11. Bugs e problemas encontrados (com evidência)

| # | Problema | Evidência |
|---|---|---|
| 1 | Dependências mortas `jspdf`, `modern-screenshot` | `package.json` sem nenhum import correspondente |
| 2 | **CI não roda os testes** | `.github/workflows/ci.yml` (steps: lint, tsc, build — sem test) |
| 3 | `/api/cron/daily` sem auth se `CRON_SECRET` unset | `app/api/cron/daily/route.ts` |
| 4 | Sessões irreversíveis (senha trocada não invalida cookies) | `lib/session.ts` |
| 5 | Exclusão de rota fantasma `/tour` | `proxy.ts` |
| 6 | README inconsistente (badge "25 connectors" vs "21, 15 free") | `README.md` |
| 7 | `.env.example` incompleto (~16 variáveis usadas via `cfg()` ausentes) | `.env.example` vs `rg cfg\(` |
| 8 | Retenção 90 dias hard-delete silenciosa de menções coletadas | `lib/pipeline.ts:221-224` |
| 9 | Import features admin-only sem documentação | `app/api/import/*` (guard `isAdmin`) |
| 10 | Chat "ask" com match de palavras ingênuo (ILIKE, sem stemming) | `app/api/ask/route.ts` |

## 12. Resumo executivo

**Pontos fortes:** (1) maturidade de engenharia incomum para open source — build/tsc/testes verdes, tratamento de erro tipado, locks, throttling; (2) orçamento e transparência de IA de nível enterprise (medição por token, cap rígido); (3) arquitetura de conectores plugável com BYOK cifrado AES-256-GCM; (4) regras anti-alucinação consistentes (fact-pack SQL, citações validadas, "cannot_say"); (5) MCP real e bem protegido (11 tools read-only, 9 prompts, token constant-time).

**Lacunas vs. plataforma enterprise:** (1) sem multi-tenancy verdadeira (credenciais globais, sem SSO/RBAC granular/audit log); (2) segurança de sessão fraca (sem revogação/expiração server-side; cron possivelmente aberto); (3) sem histórico além de 90 dias, sem warehouse/backups; (4) cobertura de fontes premium não verificável sem chaves e sem streaming em tempo real; (5) testes/CI assimétricos — o CI não roda os testes existentes.

**Classificação geral:** projeto notavelmente completo — quase tudo que o README promete tem código real, chamado e testado. As lacunas são estruturais (enterprise) e de processo (CI), não de funcionalidade de produto.
