# Roadmap — Evolução Incremental

> Princípios: cada incremento é pequeno, testável, reversível e demonstrável. Nenhum incremento é declarado concluído sem testes + validação na interface. Prioridades derivadas de `docs/research/gap-analysis.md`.

## Incremento 1 — Fundação pt-BR + CI com testes (P0) — **status: executado e revisado pós-audit**

**Escopo:** interface em português brasileiro (locale `pt` + 🇧🇷, dicionário completo, datas `pt-BR`), content-locale pt-BR (IA escreve em pt-BR), CI passando a rodar `npm test`, testes novos de i18n.

- Critérios de aceitação:
  - [x] Seletor de idioma exibe 🇧🇷 e alterna a interface para pt-BR.
  - [x] `tFor('pt')` traduz as mesmas chaves cobertas pelo italiano; teste garante paridade de chaves IT↔PT.
  - [x] `localeTag('pt')` → `pt-BR` (formatação de datas).
  - [x] `/api/locale` e `/api/content-locale` aceitam `pt`; IA gera conteúdo em português (directiva `Brazilian Portuguese`).
  - [x] CI (`ci.yml`) executa lint + tsc + **test** + build.
  - [x] Testes existentes (194) + novos passam; `tsc --noEmit` sem erros; build de produção ok.
  - [x] Validação visual na interface rodando localmente.

**Revisão pós-auditoria externa (2026-11-06, commit `069bd79`):** a auditoria encontrou telas com controles ainda em inglês apesar da paridade de chaves — componentes que não passavam pelo dicionário. Corrigido em 23 arquivos (ExportBar, SearchBox, TranslateBar, CopyButton, dashboard, listening, insights hub, benchmark, pilha KPI completa com 4º argumento pt em todas as chamadas L(), legenda do SentimentPie, prompt do brief sem forçar inglês). 12 testes novos de **texto renderizado** + anti-regressão nos fontes; 6 telas recapturadas e reauditadas visualmente. Notas de KPI agora entregues em pt-BR (`kpiLang('pt')→'pt'`) — a limitação anterior foi eliminada antes do Incremento 3. Geração real de IA em pt-BR: **NÃO TESTADO** (sem chave autorizada).

## Incremento 2 — Hardening de segurança (P0) — **status: executado (commit `a029ce0`) e CORRIGIDO pós-audit (2026-11-07)**

- Sessões versionadas: troca de senha invalida cookies antigos (`lib/session.ts`).
- `/api/cron/*`: 401 permanente sem `CRON_SECRET` válido em produção (remover fallback aberto).
- `SESSION_SECRET` obrigatório em produção (boot falha), sem default.
- `.env.example` completo (todas as variáveis usadas via `cfg()`).
- Remoção das dependências mortas (`jspdf`, `modern-screenshot`); remoção da rota fantasma `/tour` do `proxy.ts`.
- Critérios: testes de autenticação/cron (novos); adição de testes de sessão; CI verde.

**Executado:** todos os itens acima + revogação de todas as sessões (`revokeAll`), modo demo 403 em cron/refresh/content-locale, comparação timing-safe, 15 testes de segurança (228/228 no total), E2E contra build de produção (demo 403 · produção sem segredo 500 fail-closed · Bearer errado 401 · sem login 307/401). CI no GitHub: **NÃO EXECUTADO** neste ambiente (sem runner/push autorizado); passos validados localmente.

**Correções P0 da auditoria externa (2026-11-07, mesma branch, commits preservados):**

1. Desacoplamento firma/revoga: o proxy é pre-filtro de firma (sem DB, documentado no arquivo); TODA rota protegida verifica firma + versão de sessão contra o banco (`lib/session-auth.ts` + `lib/api-guard.ts`). Cookie revogado → 401 mesmo com HMAC válido.
2. `POST /api/auth {revokeAll}` recusa cookie de sessão já revogada (401, sem bump adicional).
3. `/api/refresh`: sem projeto acessível → 404 explícito; a pipeline JAMAIS recebe `projectId` indefinido (fim do fallback global — comprovado por E2E com inspeção do DB: zero locks de pipeline).
4. DEMO_MODE estritamente read-only: guards de escrita em todos os endpoints de ingestão/persistência (refresh especiais, timeline, pov, brief, compare, insights, influencer, playbook, translate); inventário completo de todos os POST/PUT/PATCH/DELETE em `docs/progress.md`.
5. `SESSION_SECRET` obrigatório, explícito e **independente de `APP_PASSWORD`** (fallback removido), com política de comprimento (≥32) e entropia; validação no boot via `instrumentation.ts` — produção sem segredo válido **recusa arrancar** (fail closed).
6. Testes de regressão reais: 13 testes de integração com banco isolado (`tests/security-integration.test.ts`) + 27 verificações E2E contra build de produção (`scripts/e2e-security.mjs`, log em `docs/research/evidence/e2e-security/`). **245/245 testes.**

## Pendência P0 (nova, da auditoria de 2026-11-07) — Retenção de dados configurável + exportação antes do descarte

- Retenção configurável por instância/projeto (hoje os dados crescem sem política de expurgo).
- **Nenhum descarte sem exportação prévia**: antes de qualquer purga automática, o operador deve poder exportar o que será descartado (XLSX/CSV já existem como base).
- Critérios: política de retenção documentada e testada; teste de regressão provando que o descarte só ocorre após exportação registrada; logs de auditoria do descarte.

## Incremento 3 — Inteligência: busca semântica + alertas configuráveis (P1)

- Embeddings opcionais por menção (feature flag) + busca semântica no `/ask` e POV (substituir ILIKE).
- Alertas com limiares explícitos configuráveis pelo usuário (volume +3σ, Δ sentimento) e evidência anexada.
- Critérios: `/ask` retorna citações relevantes em pergunta paráfrase (teste com dataset); alerta dispara em série sintética com pico injetado.

## Incremento 4 — API REST + relatórios por e-mail (P1)

- API REST read-only documentada (OpenAPI) com chave por workspace e rate limit.
- Agendamento de relatórios periódicos com entrega por e-mail (SMTP configurável).
- Critérios: cliente externo consulta menções com chave; relatório entregue em caixa de teste.

## Incremento 5 — Multi-tenancy (P0 estrutural, maior esforço)

- `workspaces`, membership, RBAC declarativo, audit log, credenciais por workspace, quotas.
- Migração não destrutiva: instâncias existentes viram 1 org / 1 workspace automático.
- Critérios: suite de testes de isolamento entre tenants; auditoria registra mutators; migração reversível testada em cópia do banco.

## Incrementos 6+ (P2/P3, dependentes de priorização e recursos)

- LLM Insights (monitorar como IAs generativas falam da marca) — diferencial retro.
- Detecção de marca em imagens (BYOM — modelo de visão do próprio deploy).
- Transcrição ASR de podcasts/vídeos monitorados.
- Customer feedback: detecção de intenção sobre reviews importados.
- Segmentação de audiência por descrição NL.
- Biblioteca de dashboards pré-construídos ("IQ Apps" próprios).
- Alertas por Slack/webhook; exploração aprofundada de clusters.
- Investigação de desinformação: ligar `fact_checks` (Google Fact Check Tools já integrado) a menções e narrativas.
- Proteção digital de marca: detecção de domínios imitadores (fase experimental).

## Regras de qualidade (todos os incrementos)

1. Ciclo técnico: `npm run lint` + `npx tsc --noEmit` + `npm test` + `npm run build` — tudo verde no commit.
2. Ciclo funcional: dados controlados (seed) e fontes reais autorizadas quando aplicável.
3. Ciclo visual: telas capturadas e avaliadas (estados vazios, erros, filtros, gráficos).
4. Ciclo de produto: comparar com o requisito derivado do Talkwalker e documentar diferenças.
5. Ciclo de regressão: os 194+ testes existentes continuam passando; CI rodando testes.
6. Classificação obrigatória: APROVADO / REPROVADO / PENDENTE / NÃO TESTADO — nunca "aprovado porque compila".
