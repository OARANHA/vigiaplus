# Arquitetura-Alvo — Radar Social Intelligence Platform

> **Data:** 2026-11-06 · Princípio norteador: **evolução incremental do Radar existente**, nunca reescrita. Componentes comprovadamente úteis são preservados; mudanças estruturais só quando há evidência de necessidade.

## 1. Componentes preservados (evidência de valor)

| Componente | Por que preservar |
|---|---|
| Pipeline `lib/pipeline.ts` + `lib/ingest.ts` | Ingestão com concorrência controlada, rotação de termos, dedupe, filtro booleano — 194 testes verdes |
| Arquitetura de conectores `lib/connectors/` (25 fontes) | Plugável, BYOK cifrado AES-256-GCM, custo de crédito Talkwalker contido |
| Integração Talkwalker `lib/connectors/talkwalker.ts` | Sólida e testada (14 testes); é a ponte oficial com a referência |
| Sistema de IA `lib/claude.ts` + `lib/ai-provider.ts` | Orçamento rígido, medição por token, erros tipados — nível enterprise |
| Anti-alucinação (POV fact-pack, citações validadas, `cannot_say`) | Diferencial verificável vs. concorrência |
| MCP `app/api/mcp` (11 tools, token constant-time) | Base do diferencial "automação via MCP" |
| Exportações PDF/DOCX/PPTX/XLSX com disclosure AI Act | Conformidade regulatória rara em OSS |
| App Router Next.js 16 + React 19 + Drizzle + PGlite/Neon | Stack atual, sem débito técnico detectado (tsc 0 erros, build ok) |

## 2. Arquitetura alvo (por camadas)

### 2.1 Plataforma SaaS (multi-tenancy)

```
Organization (tenant, real data isolation)
 └─ Workspace (ambiente de trabalho: brand, linha de produto)
     └─ Project (monitoramento: queries, fontes, idiomas)
User ─ membership(org, workspace) ─ role: owner | admin | analyst | viewer
```

- **Isolamento:** toda tabela de dados ganha `workspace_id` (FK indexado); queries centralizadas em `lib/data.ts` filtram por workspace da sessão — nenhuma rota acessa tabela sem o filtro. Verificação por testes de isolamento (tenant A nunca lê B).
- **Credenciais de conectores:** migram de globais-por-instância para **por workspace** (a tabela `meta` já suporta escopo; `lib/connector-credentials.ts` ganha `workspaceId`).
- **RBAC:** `users.role` evolui para papéis por workspace; guards em `lib/auth.ts` (hoje `isAdmin`) ficam declarativos e testados.
- **Audit log:** tabela `audit_events` (ator, ação, recurso, workspace, timestamp, metadados JSON) gravada em todo mutator (login, mudança de credencial, export, import, deleção).
- **Limites de consumo:** o orçamento de IA existente (`api_usage`) é estendido a quotas por workspace (menções/dia, chamadas de IA/mês).
- **Secrets:** `SESSION_SECRET` obrigatório em produção (boot falha sem ele), rotação de versão de sessão, `CRON_SECRET` obrigatório.
- **Self-hosted:** PGlite (single-tenant) continua suportado; Neon/Postgres para SaaS. Docker Compose documentado.

### 2.2 Motor de coleta

Preserva o pipeline atual e adiciona:

- **Scheduler dedicado** (hoje cron Vercel 05:00/07:00): fila de jobs por conector com retry exponencial e backoff, dead-letter visível na UI (`/settings` → saúde das fontes).
- **Streaming onde possível** (webhooks de plataformas que suportam) com fallback a polling.
- **Proveniência:** toda menção já rastreia query/conector; adiciona `collected_at`, `raw_ref` (payload original) e retenção **configurável** (`MENTION_RETENTION_DAYS`, default 90, com export automático antes do purge).
- **Saúde das fontes:** `source_health` (último sucesso, taxa de erro, latência) exposta na UI de administração.

### 2.3 Motor de inteligência

- **Sentimento/emotions pt-BR:** manter LLM configurável + adicionar **suite de avaliação** (`tests/eval/`): dataset rotulado pt-BR (inicial: ~300 menções), métricas precisão/revocação/F1 por classe, executável localmente e no CI (sem custo: dataset com rótulos fixos, comparação determinística contra saídas cacheadas).
- **Busca semântica:** embeddings por menção (provedor configurável, ex. OpenAI/via Ollama local) + índice pgvector (Neon) ou tabela de embeddings no PGlite; usada no `/ask` e no POV (substitui ILIKE ingênuo).
- **Anomalias/crise:** detector estatístico (z-score/EWMA sobre série diária de volume e sentimento) com **limiares configuráveis** pelo usuário; cada alerta carrega evidência (série, limiar, menções driver).
- **LLM Insights (diferencial):** job periódico que sonda LLMs configuradas com prompt fixo ("o que você sabe sobre a marca X") e versiona posicionamento/sentimento/SOV por modelo — histórico comparável no tempo.
- **Assistente com citações:** evolui o `/ask` para RAG sobre embeddings com citações verificáveis (padrão POV).

### 2.4 Interface enterprise (pt-BR first)

- pt-BR como locale de primeira classe (Incremento 1) — UI e conteúdo gerado por IA.
- Central de alertas/incidentes com trilha de evidências (timeline já existe — ligar alertas a eventos).
- Construtor de queries com validação de sintaxe e preview de volume.
- Exportações: já existentes; adicionar agendamento por e-mail.

### 2.5 Automação via MCP

O servidor MCP atual (read-only) evolui para tools por workspace com token escopado e auditado — mantendo o padrão de segurança existente (constant-time, off por padrão).

## 3. Decisões técnicas registradas (ADR curtos)

| # | Decisão | Motivo |
|---|---|---|
| ADR-1 | Evoluir Next.js monolito modular em vez de microsserviços | Time pequeno, deploy único self-hosted, sem gargalo comprovado |
| ADR-2 | Workspace como fronteira de isolamento (não organization) | Credenciais e projetos vivem no workspace; org é cobrança/governança |
| ADR-3 | Embeddings opcionais (feature flag) | Nem todo self-hoster quer pagar/vender embeddings; ILIKE continua fallback |
| ADR-4 | Avaliação de sentimento por dataset fixo no CI, sem chamadas de LLM | CI determinístico e gratuito; regressão de qualidade detectável |
| ADR-5 | Retenção configurável com export antes do purge | Resolve perda silenciosa de dados sem inflar armazenamento |
| ADR-6 | AGPL-3.0 preservado; modificação proprietária exige análise jurídica prévia | Ver §4 |

## 4. Licenciamento (AGPL-3.0)

O Radar é AGPL-3.0. Implicações para o roadmap:

- Modificações distribuídas ou **serviço hospedado** (rede) obrigam a disponibilizar o código-fonte das modificações aos usuários. A evolução como SaaS **não elimina** essa obrigação.
- Componentes de terceiros: manter o inventário de licenças; não introduzir dependências GPL-incompatíveis sem análise.
- Nenhuma substituição unilateral de licença será feita. Qualquer decisão de dual-licensing exige revisão jurídica — **flag pendente para o mantenedor**.
- Preservar avisos de atribuição em todas as redistribuições.

## 5. Não-metas (nesta fase)

- Crawling próprio em escala de 150M+ sites (depende de infra/acedos fora do escopo).
- Aquisição de firehose social ou dados de broadcast/print.
- Reprodução visual da identidade do Talkwalker (proibido e sem valor).
