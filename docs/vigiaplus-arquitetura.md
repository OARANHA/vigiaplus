# VigiaPlus — Documento de Arquitetura de Software (SAD) v1.0

> **Status:** proposta de arquitetura para aprovação · **Data:** 2026-11-08
> **Escopo:** sistema B2B2C de monitoramento de reputação e gestão de crises, multi-tenant, escala crescente
> **Origem:** evolução incremental de `OARANHA/crises` (Radar Intelligence), **sem reescrita**
> **Destino:** `OARANHA/vigiaplus` · deploy alvo Docker + Traefik
> **Decisão do cliente já incorporada:** três superfícies; **todas as 64 páginas existentes ao alcance do dono**; modo de visualização básico/avançado; qualquer LLM compatível com OpenAI; habilitação de recursos por contrato; MCP; planos com área do cliente para plano e avisos; Stripe + Pix; pt-BR primeiro; Docker + Traefik.

---

## 0. Como ler este documento

| Seção | Para quem | O que responde |
|---|---|---|
| §1–§2 | Dono, investidor, time | O que o sistema é e como se conecta ao mundo |
| §3 | Arquiteto, tech lead | Por que cada decisão foi tomada (ADRs) |
| §4–§5 | Backend, segurança | Dados, isolamento, ameaças |
| §6 | Produto, dono | Cada requisito que você levantou, resolvido |
| §7 | Todo o time | Fluxos críticos ponta a ponta |
| §8–§12 | Devops, SRE, QA | Escala, deploy, testes adversariais |
| §13–§14 | Todos | Riscos e glossário sem jargão |

**Regra deste documento:** toda decisão tem **motivo** e **consequência**. Onde houver alternativa descartada, ela está registrada.

---

## 1. Contexto e forças

### 1.1 Objetivo de negócio

Você opera um serviço. Seus clientes (empresas) assinam, fazem login e acompanham **duas reputações** e **gestão de crises**. O valor vendido não é «dashboard», é **tranquilidade com evidência**: alguém está vigiando, interpreta, avisa e prepara a resposta.

### 1.2 Requisitos (funcionais e não-funcionais)

| ID | Requisito | Origem |
|---|---|---|
| R1 | Isolamento absoluto entre clientes | Análise anterior + LGPD |
| R2 | Três superfícies: portal do cliente, console do dono, modo analista | Cliente |
| R3 | **Todas as páginas existentes acessíveis ao dono** | Cliente (reforço) |
| R4 | Modo de visualização **básico** e **avançado** | Cliente |
| R5 | Cadastrar **qualquer LLM compatível com OpenAI** como admin | Cliente («engessado») |
| R6 | Habilitar/desabilitar recursos por cliente **conforme contratação** | Cliente |
| R7 | MCP como capacidade (explicado em linguagem simples, §6.5) | Cliente |
| R8 | Planos; cliente tem **área de plano e de avisos** | Cliente |
| R9 | Pagamentos **Stripe e/ou Pix** na área admin | Cliente |
| R10 | Landing existente; **tudo em português** (pt-BR first) | Cliente |
| R11 | Cliente entende de imediato, mas percebe **valor agregado** | Cliente («o pouco é muito») |
| R12 | Fluxo: testar uma → teste adversarial → planos → área do cliente → pagamentos | Cliente |
| R13 | Deploy **Docker + Traefik** | Cliente |
| R14 | Escalável para «grande escala» | Cliente |
| R15 | Conformidade LGPD e resolução da licença AGPL-3.0 | Análise anterior |

### 1.3 Restrições

- **Time pequeno.** A arquitetura não pode exigir operação de plataforma complexa no início.
- **Código existente é ativo.** 51.600 linhas, 245 testes, 28 conectores — é o maior ativo.
- **AGPL-3.0.** Serviço hospedado aciona cláusula de rede; é item jurídico P0, não detalhe.
- **Custo de IA variável.** Precisa ser atribuível e limitável por cliente.
- **Dados de terceiros.** Menções podem conter dados pessoais (LGPD).

### 1.4 Escala alvo (premissa explícita, ajustável)

| Eixo | Ano 1 | Ano 3 (alvo de projeto) |
|---|---|---|
| Clientes (tenants) | 30 | 500 |
| Menções/dia | 200 mil | 5 milhões |
| Menções armazenadas | ~20 milhões | ~1,5 bilhão (com retenção) |
| Usuários simultâneos | ~100 | ~3.000 |
| Chamadas de IA/dia | 5 mil | 200 mil |
| SLA de detecção de crise | ≤ 15 min | ≤ 5 min |

> **Consequência:** o desenho precisa suportar 500 tenants sem que um cron ou uma query global vire gargalo — mas **não** precisa de microsserviços de domínio.

---

## 2. Visão C4

### 2.1 Nível 1 — Contexto

```
 [Dono / Operação] ── console + modo analista ──┐
 [Cliente final]   ── portal + plano/avisos ───┤
 [Assistente IA]   ── MCP (token por tenant) ──┼──>  VIGIAPLUS  ──> [Fontes: 28 conectores, RSS, APIs]
 [Gateway pgto]    ── webhooks Stripe / Pix ───┘        │
                                                        ├──> [LLM: qualquer endpoint OpenAI-compatible]
                                                        ├──> [E-mail / WhatsApp / Slack]
                                                        └──> [Postgres, Redis, Object Storage]
```

**Atores externos:** dono, analista interno, `client_admin`, `client_viewer`, assistente de IA via MCP, gateways de pagamento, provedores LLM, fontes de dados, destinatários de notificação.

### 2.2 Nível 2 — Containers

| Container | Papel | Escala |
|---|---|---|
| `traefik` | TLS, roteamento, domínios white-label, rate limit de borda | 1–2 réplicas |
| `web` (Next.js) | Três superfícies, Server Components, API routes | 2–N réplicas, stateless |
| `scheduler` | Agenda jobs por tenant/fonte | 1 ativo (leader election) |
| `worker-ingest` | Coleta, normalização, dedupe, enriquecimento | **N réplicas** — escala horizontal |
| `worker-ai` | Classificação, playbooks, briefs, embeddings | **N réplicas** — escala horizontal |
| `worker-notify` | E-mail, WhatsApp, Slack, webhooks | N réplicas |
| `redis` | Fila de jobs, rate limit, cache, locks distribuídos | 1 + réplica |
| `postgres` | Dados transacionais, RLS, audit, cotas | Primário + read replica |
| `object storage` | Exportações, backups, dumps pré-purge | S3/R2/MinIO |
| `otel + logs` | Métricas, traces, logs estruturados | Stack leve |

> **Decisão de escala:** separam-se **cargas de trabalho** (web / ingest / IA / notify), não **domínios**. Um codebase, um schema, vários processos com perfis de recurso diferentes. Isto é ADR-01.

### 2.3 Nível 3 — Componentes (dentro do monolito)

```
app/
  (app)      → portal do cliente      [4 abas; modo básico/avançado]
  (console)  → console do dono        [18 áreas]
  (analyst)  → Radar completo         [64 páginas, flag]
  api/       → rotas + webhooks + MCP
lib/
  tenant/       → TenantContext, RLS, guards        ★ novo
  entitlements/ → catálogo, planos, overrides       ★ novo
  llm/          → registry OpenAI-compatible        ★ novo (substitui união fixa)
  billing/      → gateways Stripe / Pix             ★ novo
  i18n/         → pt-BR first                       ★ estendido
  mcp/          → servidor MCP escopado             ★ estendido
  incidents/    → workflow de crise                 ★ novo
  connectors/   → 28 fontes                        ✔ reaproveitado
  pipeline/     → ingestão                         ✔ reaproveitado (parametrizado)
  insights/     → Health Index, crise               ✔ reaproveitado
  export/       → PDF/DOCX/PPTX/XLSX                ✔ reaproveitado
  db/           → Drizzle + migrations              ◇ substitui DDL no boot
```

---

## 3. Decisões arquiteturais (ADRs)

| # | Decisão | Motivo | Consequência / custo |
|---|---|---|---|
| **ADR-01** | **Monolito modular com workers separados**, sem microsserviços de domínio | Time pequeno, um schema, transações simples, nenhum gargalo comprovado | Precisa disciplina de fronteiras; deploy de 4 papéis |
| **ADR-02** | **`tenant_id` em toda tabela + RLS do Postgres** como defesa em profundidade | Um `WHERE` esquecido não pode vazar dados | Toda conexão deve fazer `SET LOCAL app.tenant_id`; testes obrigatórios |
| **ADR-03** | **Dois eixos independentes: vocabulário (chapéu) e densidade (básico/avançado)**; nenhum afeta permissões | Resolve «entende de imediato» × «parece sem valor» sem criar furo | Mais estados de UI para testar |
| **ADR-04** | **Entitlements declarativos**: `Plano → Features → Override por tenant` | Habilitar por contrato sem deploy | Toda rota e todo menu devem consultar `can()` |
| **ADR-05** | **LLM Registry OpenAI-compatible**, configurado em UI, com roteamento por tarefa e fallback | Fim do engessamento; suporta cloud, local e híbrido | Precisa validar SSRF, timeouts, preços e capacidades |
| **ADR-06** | **MCP como canal de saída controlado**, não núcleo | Agregador de valor sem expor escrita | Token por tenant, read-only, auditoria, rate limit |
| **ADR-07** | **Gateway de pagamento abstrato** com adaptadores Stripe e Pix | Evita casamento com um fornecedor; webhooks idempotentes | Conciliação e dunning viram componentes próprios |
| **ADR-08** | **pt-BR como locale padrão**, `content-locale` separado | Cliente brasileiro; IA escreve em pt-BR | Traduzir landing + textos renderizados; EN/IT ficam como fallback |
| **ADR-09** | **Chave de criptografia independente e versionada** | Rotacionar `SESSION_SECRET` não pode apagar chaves salvas | Migração de credenciais existentes |
| **ADR-10** | **Migrações versionadas** (drizzle-kit), DDL fora do boot | Cold starts concorrentes, rollback, auditoria | Migração única dos 91 DDL atuais |
| **ADR-11** | **Testes adversariais como gate de CI** | O isolamento é a promessa do produto | Suíte deve cobrir bypass, injeção, SSRF, replay |
| **ADR-12** | **AGPL-3.0 resolvido antes da comercialização** | SaaS aciona cláusula de rede | Parecer jurídico / licença comercial |
| **ADR-13** | **Modo analista preserva 100% das 64 páginas** | O dono não perde nada; o cliente não é exposto | Feature flag + RBAC estrito |

### Detalhamento das decisões críticas

**ADR-02 — Isolamento em 4 camadas.** (1) `TenantContext` injetado no início da requisição; (2) todo repositório aplica `where tenant_id = ctx.id`; (3) **RLS no Postgres** com `SET LOCAL app.tenant_id` por transação — se um dev esquecer o filtro, o banco barra; (4) testes adversariais tentando ativamente burlar. Chaves de API, cookies e headers **nunca** definem tenant: ele vem da sessão autenticada.

**ADR-05 — O fim do engessamento.** Hoje `AiProviderId` é `'anthropic' | 'openai' | 'grok' | 'azure'` e `AI_PROVIDERS` é um dicionário fixo em `lib/ai-provider.ts`. Novo modelo: tabela `llm_providers` com `base_url`, `auth_header`, `api_key` cifrada, `model`, `capabilities` (chat, json, tools, vision, embeddings), `context_window`, `preço por 1M tokens`, `timeout`, `headers extras`, `escopo` (global / por tenant). A UI do dono cadastra **qualquer** endpoint que fale `/chat/completions`: OpenAI, Azure, OpenRouter, Groq, DeepSeek, Together, Fireworks, **Ollama / LM Studio / vLLM locais**, ou um proxy interno. `llm_routes` mapeia **tarefa → provedor primário → cadeia de fallback**. Cadastrar provedor novo = preencher formulário + «Testar conexão». Zero deploy.

**ADR-06 — MCP em uma frase.** MCP é uma **tomada padrão**: permite que um assistente de IA (Claude Desktop, ChatGPT, Cursor, um agente seu) **consulte o Vigia com a sua permissão**, sem precisar entrar no sistema. Exemplo: o cliente pergunta ao ChatGPT «como está minha reputação?»; o assistente chama a ferramenta `get_reputation` do servidor MCP do Vigia, com token daquele tenant, e responde com os dados. **Não é** um banco novo, **não é** uma API pública irrestrita, **não substitui** o portal. Implementação: servidor MCP com token por tenant, **11 ferramentas read-only** já existentes no repo, escopo por tenant, rate limit, e todo acesso registrado em `audit_events`. Escrita via MCP: **não** nesta fase.

**ADR-07 — Por que Stripe *e* Pix.** Stripe cobre cartão e assinatura internacional; Pix é o meio dominante no Brasil e reduz inadimplência. A arquitetura não escolhe: `PaymentGateway` com `StripeAdapter` e `PixAdapter` (Asaas / Mercado Pago / Pagar.me / Stripe-Pix). Eventos de webhook são **idempotentes** (`payment_events.event_id` único) e geram `subscriptions`/`invoices`; o estado da assinatura **alimenta os entitlements** (ADR-04). Pix recorrente: começar com cobrança avulsa + conciliação por webhook; avaliar **Pix Automático** quando o gateway escolhido suportar.

---

## 4. Modelo de domínio e dados

### 4.1 Núcleo novo

```
tenants (id, nome, cnpj, slug, dominio, marca_json, plano_id, status, locale, retencao_dias, criado_em)
plans (id, nome, preco, moeda, limites_json, retencao_dias)
plan_features (plano_id, feature_key, habilitado)
tenant_features (tenant_id, feature_key, habilitado, motivo, expira_em)   ← override por contrato
feature_catalog (key, nome, descricao, modulo, perigosa)                  ← catálogo versionado

memberships (tenant_id, user_id, role)   role: owner | analyst | client_admin | client_viewer
user_preferences (user_id, view_mode: basic|advanced, locale, content_locale)
invitations (token_hash, tenant_id, role, expira_em, usado_em)

reputation_targets (id, tenant_id, nome, tipo: brand|market|entity, keywords, is_baseline)
reputation_scores (target_id, score, componentes_json, n, janela, computed_at)

subscriptions (tenant_id, gateway, gateway_id, estado, plano_id, vigencia_ate)
invoices (tenant_id, gateway_id, valor, estado, vencimento, pago_em, pix_qrcode)
payment_events (event_id UNIQUE, gateway, tipo, payload, processado_em)

llm_providers (id, escopo, tenant_id NULL, nome, base_url, auth_header, api_key_cifrada,
               modelo, capabilities_json, contexto, preco_in, preco_out, timeout_ms, headers_json, ativo)
llm_routes (tenant_id NULL, tarefa, provider_id, fallback_ids, temperatura, max_tokens)
llm_usage (tenant_id, provider_id, tarefa, tokens_in, tokens_out, custo, latencia, criado_em)

incidents (id, tenant_id, alert_id, status, severidade, owner, sla_next_at, aberto_em, fechado_em)
incident_actions (incident_id, ator, acao, payload, criado_em)   ← imutável
alert_rules (tenant_id, tipo, limiar_json, canais_json, silencio_de/ate)
notification_channels (tenant_id, tipo, destino, verificado)
audit_events (id, ator, tenant_id, acao, recurso, ip, meta_json, criado_em)  ← imutável
mcp_tokens (tenant_id, token_hash, escopo, revogado_em)
api_keys (tenant_id, hash, escopo, rate_limit)
```

### 4.2 Regras de dados

- **Toda tabela de domínio** (`mentions`, `reviews`, `alerts`, `briefs`, `reports`, `timelines`, `import_*`, …) ganha `tenant_id NOT NULL` + índice composto `(tenant_id, ...)`.
- **RLS** habilitado em todas; política `USING (tenant_id = current_setting('app.tenant_id')::int)`.
- **Particionamento** de `mentions` por `tenant_id` (hash) + tempo (mensal) a partir do H4; até lá, índices compostos bastam.
- **Retenção configurável por tenant**, com **exportação obrigatória e registrada antes de qualquer purge**.
- **`api_usage` global é substituído** por `llm_usage` + `usage_by_tenant` (menções, storage, notificações).
- **Audit e incident_actions são append-only** (sem UPDATE/DELETE na aplicação).

---

## 5. Segurança em profundidade

| Camada | Controle |
|---|---|
| Borda | Traefik: TLS, rate limit, headers de segurança, allowlist opcional |
| Sessão | Cookie HMAC + `session_version` (já existe) → estendido com `tenant_id` **do servidor** |
| Autorização | `can(user, acao, tenant)` declarativo; `requireFeature()` em toda rota |
| Dados | RLS + filtro obrigatório + `SET LOCAL` por transação |
| Segredos | `CREDENTIALS_ENC_KEY` versionada; rotação sem perda; never-log de chaves |
| LLM | Validação de `base_url` contra SSRF (bloqueio de `127.0.0.0/8`, `169.254.169.254`, `::1`, hosts internos), timeout, tamanho máximo de resposta, sanitização de conteúdo coletado contra **prompt injection** |
| MCP | Token por tenant, somente leitura, rate limit, auditoria |
| Pagamentos | Webhook idempotente, assinatura verificada, replay bloqueado |
| Auditoria | `audit_events` em todo mutator; exportável; retenção de 5 anos |
| LGPD | Consentimento, minimização, portabilidade, exclusão, DPA com subprocessadores |

**Ameaças que os testes adversariais cobrem (§12):** troca de `tenant_id` via cookie/header/body; query sem `WHERE`; leitura de projeto de outro tenant por ID; prompt injection dentro de uma notícia coletada; SSRF via `base_url` de LLM; bypass de entitlement por parâmetro de URL; replay de webhook; estouro de cota; impersonação sem auditoria; escalada de `client_viewer` para `owner` via modo avançado.

---

## 6. Cada requisito seu, resolvido

### 6.1 Três superfícies + todas as páginas ao seu alcance (R2, R3)

| Superfície | Público | Conteúdo |
|---|---|---|
| `/app` | Cliente | 4 abas: Panorama, Crises, Relatórios, Minha conta (**com Plano e Avisos dentro**) |
| `/console` | Dono/analista | **18 áreas**, ~50 telas |
| `/analyst` | Dono/analista, flag | **As 64 páginas atuais, integralmente**, sem remoção |

> **Nada é escondido de você.** A simplificação é aplicada **somente** na sessão do cliente. O modo analista é um espelho do Radar atual com `tenant_id` no contexto — inclusive Sport, Wikipedia, Clinical Trials, War Room, Galaxy 3D, MCP, import e query builder.

### 6.2 Modo básico / avançado (R4, R11)

**Dois eixos independentes** — decisão importante para não confundir as coisas:

| Eixo | Valores | O que muda | O que **nunca** muda |
|---|---|---|---|
| **Vocabulário** (chapéu) | Leigo ↔ Técnico | Palavras («está estável» ↔ `sentiment 0,31`) | Dados, permissões |
| **Densidade** (visualização) | Básico ↔ Avançado | Quantidade de detalhe visível | **Permissões, escopo, tenant** |

- **Básico:** um número, uma cor, uma frase, uma ação.
- **Avançado:** revela, **na mesma tela**, componentes do score, proveniência, série temporal, fontes, filtros e drill-down — sem trocar de página e sem ganhar acesso a mais dados.
- Preferência persistida por usuário; o dono pode **fixar o padrão por tenant** (ex.: cliente de consultoria já entra no avançado).

**A tensão «simples demais parece sem valor» resolve-se com valor *perceptível*, não com complexidade.** No modo básico o cliente vê uma faixa discreta: *«24 fontes monitoradas · 1.240 comentários analisados · detecção em 11 min · 2 assuntos acompanhados este mês»*. É prova de trabalho, não é um gráfico. **Às vezes o pouco é muito** — desde que o pouco seja **evidência**.

### 6.3 Qualquer LLM compatível com OpenAI (R5)

Ver ADR-05 e §7.4. Cadastro pela UI do dono: Nome · Base URL · Cabeçalho de auth · Chave (cifrada) · Modelo · Capacidades · Contexto · Preço · Timeout · Headers extras · Escopo (global ou por tenant). Botão **Testar conexão**. `llm_routes` define qual provedor atende cada tarefa e a cadeia de fallback. Suporta inclusive **modelo rodando dentro da sua própria infra** (Ollama/vLLM) — relevante para clientes que exigem confidencialidade.

### 6.4 Habilitar por contrato (R6)

`feature_catalog` → `plan_features` → `tenant_features` (override). Exemplos de features: `crisis_playbook`, `whatsapp_alerts`, `white_label`, `mcp_access`, `api_rest`, `advanced_mode`, `embeddings`, `custom_reports`, `analyst_mode`, `sso`, `extended_retention`. Toda rota faz `requireFeature(ctx, 'crisis_playbook')`; todo menu renderiza por `can()`. Override tem **motivo e expiração** (ex.: «liberado por 30 dias para teste»), e tudo é auditado.

### 6.5 MCP (R7) — explicação simples

> **MCP é uma tomada padrão para assistentes de IA.** Em vez de você criar uma integração diferente para cada assistente, expõe um único conector. O assistente (Claude Desktop, ChatGPT, Cursor, ou um agente seu) pede autorização, recebe um **token daquele cliente**, e pode chamar ferramentas **de leitura** — «qual é minha reputação?», «liste alertas abertos», «mostre a timeline da crise». Ele **nunca escreve**, nunca vê outro tenant, e cada chamada fica no log.

Onde ajuda no VigiaPlus: (a) cliente consulta sem abrir o portal; (b) sua equipe automatiza relatórios em um agente; (c) parceiros consomem dados com escopo controlado; (d) base para uma futura API REST pública (H5). As 11 ferramentas read-only do repo atual já são o ponto de partida.

### 6.6 Planos, «Meu plano» e «Avisos» (R8)

- **Console:** catálogo de features, planos, limites, preços, overrides por cliente, simulação de custo.
- **Cliente (dentro de «Minha conta»):** bloco **Meu plano** — plano atual, o que está incluído, uso do mês (menções / IA / usuários), próxima fatura, botão de upgrade; bloco **Avisos** — canais (e-mail, WhatsApp), tipos de aviso, horário de silêncio, e **histórico legível** («04/10 · resumo semanal enviado», «08/10 · alerta amarelo às 09:12»).
- **Decisão de UX:** não criar duas abas novas no menu. O cliente continua com 4 destinos; plano e avisos ficam where ele já procura por «minha conta». O pouco continua muito.

### 6.7 Pagamentos Stripe + Pix (R9)

`PaymentGateway` → `StripeAdapter` / `PixAdapter`. Webhooks → `payment_events` idempotente → `subscriptions`/`invoices` → **entitlements atualizados automaticamente**. Dunning: aviso no 3º dia, bloqueio no 7º, exclusão após 90 d. No console: faturas, inadimplência, conciliação Pix, estornos, simulação. Nunca confiar no frontend para liberar recurso.

### 6.8 pt-BR primeiro (R10)

`DEFAULT_LOCALE = 'pt-BR'`; landing traduzida; textos renderizados (hoje há misto EN/IT); `content-locale` para textos gerados por IA; números/datas `pt-BR`; **vocabulário proibido** no portal (§6.2). EN/IT permanecem como fallback e para futura expansão.

### 6.9 Deploy (R13)

`traefik` (TLS + domínios white-label) → `web` → `postgres` / `redis`; `scheduler` + `worker-ingest` + `worker-ai` + `worker-notify` escaláveis por réplica. `docker-compose.yml` para dev/produção single-host; manifests para orquestração depois. Migrações como job de init, nunca no boot da aplicação.

---

## 7. Fluxos críticos

### 7.1 Coleta → crise (SLA ≤ 15 min)
`fonte → job por tenant (fila Redis) → normaliza/dedupe → detectAlerts com limiares do tenant → classifica (ruído/atenção/crise) → cria incident → notifica canais → gera playbook via LLM registry → cliente aprova → audit → acompanha → resolved → relatório pós-crise`

### 7.2 Onboarding de cliente
`console: novo tenant (CNPJ, plano, domínio, 2 alvos de reputação, retenção) → convite por e-mail → link de ativação → 2FA opcional → primeiro login já vê o portal no modo padrão do plano`

### 7.3 Assinatura → entitlement
`checkout Stripe/Pix → webhook assinado → payment_events (idempotente) → subscription ativa → entitlements recalculados → recursos liberados/removidos → audit`

### 7.4 Chamada LLM sem engessamento
`callLLM(tarefa, tenant, prompt) → llm_routes.resolve(tarefa) → provedor primário → POST {base_url}/chat/completions → usage/custo em llm_usage → se falhar: fallback em cadeia → se todos falharem: degrada gracefully (dado bruto sem IA, never-fail o portal)`

### 7.5 Troca de modo
`toggle → grava user_preferences → re-render → **nenhuma requisição nova de dados sensíveis**, nenhuma mudança de permissão`

---

## 8. Escalabilidade

| Gargalo | Mitigação | Quando |
|---|---|---|
| Cron global serial | Fila por tenant + N workers | H0/H2 |
| `ILIKE '%…%'` em texto | `pg_trgm` GIN / `tsvector`; depois busca vetorial opcional | H4 |
| Tabela `mentions` gigante | Particionamento por tenant + mês; retenção; cold storage | H4 |
| Custo de IA | Roteamento por tarefa (modelo barato para classificação), cache, cota por tenant | H0 |
| Leitura de dashboards | Materialized views por tenant + cache Redis com invalidação por ingest | H4 |
| Picos de crise | `worker-ai` e `worker-ingest` escalam independentemente | H2 |
| Banco | Read replica para relatórios; connection pool (PgBouncer) | H4 |
| Multiregião | Não antes de H6; premature optimization | — |

**SLOs alvo:** disponibilidade 99,9%; p95 do portal < 500 ms; detecção de crise ≤ 15 min (H2) → ≤ 5 min (H4); entrega de alerta ≤ 60 s; RPO 1 h / RTO 4 h.

---

## 9. Observabilidade, resiliência e DR

- **Tracing** por `tenant_id` + `request_id` em todas as camadas; logs estruturados sem conteúdo sensível.
- **Métricas**: jobs por estado, latência por fonte, tokens/custo por tenant, alertas entregues, falsos positivos, p95, erros 5xx.
- **Saúde das fontes** e **dead-letter** visíveis no console (já prototipados).
- **Degradação graciosa**: sem LLM → dados brutos sem interpretação; sem fonte → aviso, nunca dado inventado; sem gateway → acesso mantido até a regra de dunning.
- **Backups** diários + PITR; restore testado trimestralmente; dumps antes de purge.

---

## 10. LGPD e AGPL

- **LGPD:** base legal por finalidade, minimização (não coletar além do necessário), retenção por tenant, portabilidade/exportação, exclusão com registro, consentimento versionado, DPA com subprocessadores (Neon, provedores LLM, gateway, e-mail/WhatsApp), encarregado indicado, log de acesso a dados pessoais.
- **AGPL-3.0:** `LICENSE` do repo de origem; SaaS aciona §13. Caminhos: (a) conformidade com disponibilização do código das modificações aos usuários da rede; (b) licença comercial/dual-licensing negociada com o titular; (c) substituição dos componentes de origem. **Decisão jurídica é gate do H3 (antes de cobrar).**

---

## 11. Deploy, ambientes e CI/CD

| Ambiente | Uso | Dados |
|---|---|---|
| `local` | PGlite ou Postgres via compose | Sintéticos |
| `staging` | Compose + Traefik, domínio de teste | Cópia anonimizada |
| `production` | Compose/Orquestração + Traefik | Reais, backup+PITR |

**CI (gate obrigatório a cada PR):** `lint → tsc → testes unitários → **testes adversariais** → testes de isolamento com RLS → build → migração em banco descartável`. **CD:** migrate → workers → web (rolling) → health check → rollback automático.

---

## 12. Testes adversariais como gate (R12)

Suíte independente, executada **antes** de qualquer merge e em todo deploy:

| # | Ataque simulado | Resultado esperado |
|---|---|---|
| A1 | `tenant_id` forjado em cookie/header/body | Ignorado; contexto vem da sessão |
| A2 | Query deliberadamente sem `WHERE tenant_id` | **RLS barra**; teste prova 0 linhas |
| A3 | `projectId` de outro tenant | 404, nunca 200 |
| A4 | Modo avançado ativado por `client_viewer` | Nenhuma permissão extra |
| A5 | Entitlement desabilitado chamado direto na rota | 403 |
| A6 | Notícia coletada com prompt injection | Conteúdo tratado como **dado**, nunca instrução; marcado e auditado |
| A7 | `base_url` de LLM apontando para `169.254.169.254` / localhost | Bloqueado por validação SSRF |
| A8 | Webhook de pagamento replayado | Idempotente, sem duplicidade |
| A9 | Cota excedida | Bloqueio + aviso ao dono |
| A10 | Impersonação sem motivo | Recusada e auditada |

> **Filosofia:** não basta «o código estar certo». O teste precisa **tentar ativamente errar** — é isso que transforma isolamento de *intenção* em *garantia*.

---

## 13. Riscos e dívidas registradas

| Risco | Severidade | Mitigação / dono |
|---|---|---|
| AGPL-3.0 em SaaS | **Crítica** | Parecer jurídico antes do H3 |
| Vazamento entre tenants | **Crítica** | RLS + A1/A2/A3 no CI |
| Prompt injection via conteúdo coletado | Alta | Sanitização + A6 + saída nunca executa ações |
| Falso positivo de crise | Alta | Limiares conservadores, medição de precisão, «atenção» ≠ «crise» |
| Custo de IA fora de controle | Alta | Cota por tenant + roteamento por tarefa |
| Complexidade do console (18 áreas) | Média | Visão geral enxuta + profundidade sob demanda |
| explosão de estados de UI (2 eixos × 3 superfícies × papéis) | Média | Matriz de testes de renderização por papel |
| DDL atual no boot | Média | ADR-10, migração única |
| Dependência de gateway único | Média | ADR-07, adaptadores |

---

## 14. Glossário (sem jargão)

| Termo | Em uma frase |
|---|---|
| **Tenant** | Um cliente. Cada um tem seu espaço isolado; ninguém vê o do outro. |
| **RLS** | Trava no próprio banco: mesmo que o programador esqueça um filtro, o banco não devolve dado de outro cliente. |
| **Entitlement** | O que o contrato daquele cliente permite usar. Ligar/desligar sem mexer no código. |
| **Modo básico/avançado** | O quanto de detalhe aparece na tela. **Não** muda o que a pessoa pode acessar. |
| **MCP** | Tomada padrão que deixa um assistente de IA consultar o Vigia com permissão, sem entrar no sistema. |
| **OpenAI-compatible** | Qualquer serviço que entende o mesmo formato de conversa da OpenAI — inclusive modelos rodando na sua máquina. |
| **Webhook idempotente** | Se o aviso de pagamento chegar duas vezes, o sistema cobra/libera só uma. |
| **Prompt injection** | Um texto malicioso escondido numa notícia tentando dar ordens à IA. Deve ser tratado como dado, nunca como instrução. |
| **Dunning** | Regras para atraso de pagamento: avisar, bloquear, excluir. |
| **SLA de detecção** | Prazo máximo entre algo acontecer no mundo e o Vigia te avisar. |

---

## 15. Próximo artefato

Este SAD é complementado por:

| Artefato | Conteúdo | Verificação |
|---|---|---|
| `vigiaplus-roadmap.md` | H0–H6, DoD, governança, anti-metas | v1.1 com status real medido |
| `vigia-prototipo.html` | v3 navegável: 3 superfícies, 18 áreas no console, 2 eixos de visualização, Meu plano/Avisos | estrutura validada (611/611 tags, 18/18 subnavs) |
| `vigiaplus/` | Código executável do núcleo + suíte A1–A10 + Docker/Traefik | **38/38 testes**, demo, HTTP, `docker build` e contêiner no ar |
| `OARANHA/vigiaplus` (GitHub) | Repositório publicado, ramo `main` | ✅ publicado e verificado via API; 27 arquivos, `docs/` autocontido |
| `vigiaplus.bundle` | Cópia portátil do histórico Git (redundância offline) | bundle verificado, histórico completo |

O **§12 (A1–A10)** deixou de ser desenho: está implementado em
`vigiaplus/tests/adversarial.test.js` e passou integralmente.

**Nenhum arquivo de `crises` foi alterado.** O push para `OARANHA/vigiaplus`
foi realizado com um token pessoal **temporário** fornecido pelo dono, usado
apenas em memória — não gravado em `.git/config`, nem em arquivo, nem em log.
O remote ficou com a URL limpa `https://github.com/OARANHA/vigiaplus.git`.
Esse token **deve ser revogado** em <https://github.com/settings/tokens>.

O gate AGPL-3.0 segue aberto e registrado em `vigiaplus/NOTICE.md`.
