# Capacidades Públicas do Talkwalker — Inventário Evidenciado

> **Data:** 2026-11-06 · **Baseline da referência:** site público em novembro/2026
> **Método:** fetch direto de ~20 páginas públicas de talkwalker.com e do portal de desenvolvedores (developer.talkwalker.com), sem autenticação. Help center (helpcenter.talkwalker.com) exige login SAML — **não acessado**, por respeito às restrições éticas da missão.
> **Contexto relevante:** a Talkwalker (adquirida pela Hootsuite em 2024) rebatizou a plataforma como **"Lumen by Talkwalker"** ("mesmos dados, mesmos relatórios, mesmos fluxos de trabalho").

Classificações usadas neste documento:

- **[VERIFICADO]** — capacidade confirmada em página pública aberta.
- **[DOCUMENTADO NÃO OBSERVADO]** — descrita em marketing/documentação, sem demonstração pública.
- **[NÃO CONFIRMADO]** — sem evidência pública suficiente.

---

## A. Social Listening

| # | Funcionalidade | Problema de negócio | Classificação | Evidência |
|---|---|---|---|---|
| A1 | Monitoramento de menções (topics com queries) | Rastrear em tempo real o que se diz sobre marcas/produtos/concorrentes em 30 redes sociais, 150M+ sites, 196 países | VERIFICADO | <https://www.talkwalker.com/products/social-listening> |
| A2 | Queries booleanas avançadas | Precisão no recorte de menções relevantes: até 50 operandos e 4.096 caracteres por query, operadores booleanos, busca por URL, restrições por métrica e por geolocalização (GPS), emojis, case/acento-insensível | VERIFICADO | <https://developer.talkwalker.com/docs/query-syntax> |
| A3 | Análise de sentimento | Medir percepção positiva/negativa/neutra em tempo real (motor Blue Silk™ AI, 187 idiomas declarados) | VERIFICADO | <https://www.talkwalker.com/products/social-listening> |
| A3b | Análise de emoções granulares (além de sentimento) | Detectar alegra/raiva/etc. | **NÃO CONFIRMADO** | — |
| A4 | Conversation clusters / virality maps | Descobrir temas e subtemas em grandes volumes sem leitura manual (mapas visuais de conversas conectadas) | VERIFICADO | <https://www.talkwalker.com/products/social-listening>, <https://www.talkwalker.com/products/bluesilkgpt> |
| A5 | Trends Research + forecasting | Antecipar tendências: gráficos com changepoints, matriz de tendências (volume × trend score), previsão até 90 dias, geração automática de Boolean a partir de linguagem natural | VERIFICADO | <https://www.talkwalker.com/use-cases/trend-research> |
| A6 | Influencer finder | Rankear criadores, jornalistas e veículos por impacto (análise de conteúdo e engajamento) | VERIFICADO | <https://www.talkwalker.com/products/media-monitoring> |
| A7 | Benchmarking competitivo / Share of Voice | Comparar presença, sentimento e engajamento vs. concorrentes; SOV comparativo; forecasting de engajamento | VERIFICADO | <https://www.talkwalker.com/products/social-benchmarking> |
| A8 | Segmentação região/idioma/canal/período | Análise localizada: 196 países/regiões, 187 idiomas, 30+ redes, janelas customizáveis | VERIFICADO | <https://www.talkwalker.com/products/data> |

## B. Media Intelligence

| # | Funcionalidade | Problema de negócio | Classificação | Evidência |
|---|---|---|---|---|
| B1 | Notícias online, blogs, fóruns, web ampla | Visão além das redes: crawling de 150M+ sites (BBC, NYT, Guardian, CNN, Forbes, FT, Le Monde, ESPN…) | VERIFICADO | <https://www.talkwalker.com/products/data> |
| B2 | Mídia impressa e broadcast (TV/rádio) | Cobertura de meios tradicionais | DOCUMENTADO NÃO OBSERVADO (add-on pago via marketplace; parceiros: Cision, Argus, Auxipress, Carma) | <https://www.talkwalker.com/marketplace> |
| B3 | Métricas de alcance e repercussão | Quantificar impacto: reach, engajamento, interações, video views, sentimento, media value | VERIFICADO | <https://www.talkwalker.com/social-content-ratings> |
| B4 | Veículos e autores relevantes | Direcionar PR/imprensa: ranking de publicações e autores influentes | VERIFICADO | <https://www.talkwalker.com/use-cases/competitive-intelligence> |
| B5 | Histórico de menções (back data) | Análise longitudinal: até 5 anos de dados históricos (vs. 7 dias do free search) | VERIFICADO | <https://www.talkwalker.com/free-social-media-monitoring-analytics-tools> |
| B6 | Acompanhamento de campanhas | Medir performance por campanha e por segmento de audiência | VERIFICADO | <https://www.talkwalker.com/products/audience-insights> |

## C. Inteligência Artificial

| # | Funcionalidade | Problema de negócio | Classificação | Evidência |
|---|---|---|---|---|
| C1 | **Wisdom** — agente de IA conversacional/agentic | Eliminar a barreira técnica de Booleans/dashboards: pergunta em linguagem natural → relatório com citações, gráficos e recomendações; modos Discover/Monitor/Mitigate; action briefs de mitigação; disponível via Slack | VERIFICADO | <https://www.talkwalker.com/lp/yeti-agent> |
| C2 | Blue Silk™ AI / Blue Silk™ GPT | Motor proprietário de processamento ("30 bilhões de predições IA/dia"); explica picos de conversa em tempo real | VERIFICADO | <https://www.talkwalker.com/products/data>, <https://www.talkwalker.com/products/bluesilkgpt> |
| C3 | AI Classifier | Classificar milhões de conversas com descrições em linguagem natural em vez de queries booleanas | VERIFICADO | <https://www.talkwalker.com/products/bluesilkgpt> |
| C4 | AI Summaries | Resumos automáticos diários/semanais/mensais em dashboards, relatórios e alertas | VERIFICADO | <https://www.talkwalker.com/products/bluesilkgpt> |
| C5 | Peak detection (detecção de picos/anomalias) | Identificar desvios relevantes de volume e explicar o que os dirige | VERIFICADO | <https://www.talkwalker.com/pricing> |
| C6 | Alertas de crise em tempo real | Agir antes da escalada: alertas customizados por menções/sentimento, entrega por e-mail e telefone 24/7 | VERIFICADO | <https://www.talkwalker.com/use-cases/crisis-management> |
| C7 | **LLM Insights** — monitoramento de IA generativa | Visibilidade de como ChatGPT, Gemini, Claude etc. retratam a marca: posicionamento, sentimento, SOV, "average position" vs. concorrentes; prompt templates auto-gerados; model filtering | VERIFICADO | <https://www.talkwalker.com/llm-insights> |
| C8 | Relatórios interpretativos/automatizados | Reduzir trabalho manual: análises, reporting e meeting prep automatizados; custom reports por stakeholder | VERIFICADO | <https://www.talkwalker.com/lp/yeti-agent> |

## D. Interfaces e Experiência

| # | Funcionalidade | Classificação | Evidência |
|---|---|---|---|
| D1 | Dashboards customizáveis + **IQ Apps** (dashboards pré-construídos por caso de uso) | VERIFICADO | <https://www.talkwalker.com/pricing> |
| D2 | Visualizações: linhas de tendência, donut (sentimento/SOV), mapa-múndi, virality maps, conversation clusters, trend matrix, histogramas (via API) | VERIFICADO (mockups; produto não operável publicamente) | <https://www.talkwalker.com/use-cases/trend-research>, <https://developer.talkwalker.com/guides/use-histogram-api> |
| D3 | Exportação de dados via API (Search/Export Task) | VERIFICADO | <https://developer.talkwalker.com/guides/use-search-api>, <https://developer.talkwalker.com/guides/use-export-task-api> |
| D3b | Exportação via interface web (formatos PDF/PPT etc.) | **NÃO CONFIRMADO** (help center exige login) | — |
| D4 | Alertas real-time configuráveis (e-mail/RSS/Slack; "as it happens"; 22 idiomas; filtro por engajamento) | VERIFICADO | <https://www.talkwalker.com/alerts> |

## E. Capacidades Avançadas

| # | Funcionalidade | Classificação | Evidência |
|---|---|---|---|
| E1 | **Logo detection** / Visual Listening (imagens, vídeo, áudio) + Image API pública com object/scene detection | VERIFICADO | <https://developer.talkwalker.com/guides/use-image-api> |
| E2 | Análise de vídeo/áudio (YouTube, TikTok, Twitch, Vimeo, Dailymotion, podcasts); transcrição ASR detalhada = DOCUMENTADO NÃO OBSERVADO | VERIFICADO (declarado) | <https://www.talkwalker.com/products/social-listening> |
| E3 | **Customer Feedback Analytics**: 300 fontes de feedback (reviews, surveys, tickets, call center), intent detection, custom scoring, Location Insights (reviews do Google por local) | VERIFICADO | <https://www.talkwalker.com/products/customer-feedback-analytics> |
| E4 | Audience Insights: AI audience segmentation (segmentos por descrição em linguagem natural), biblioteca de segmentos, integrações Audiense/Affinio | VERIFICADO | <https://www.talkwalker.com/products/audience-insights> |
| E5 | Social Content Ratings®: engajamento social de shows/eventos em 172 redes de TV/streaming | VERIFICADO | <https://www.talkwalker.com/social-content-ratings> |
| E6 | **API pública** — 12 famílias de endpoints (Status, Search, Summary, Histogram, Streaming, Collector, Task, Modify Documents, Resources, Topic, Source Panels, Image); modelo de créditos documentado (Search: 1 crédito/resultado + 10/chamada; Stream: 1/resultado; Histogram: 10/chamada) | VERIFICADO | <https://developer.talkwalker.com/api/>, <https://developer.talkwalker.com/docs/getting-started/credits-pricing> |
| E7 | Integrações (100+ declaradas): Slack, Hootsuite, Cision, broadcast add-ons, Amazon, Apple Store, Audiense… | VERIFICADO (parcial) | <https://www.talkwalker.com/marketplace> |
| E8 | Ferramentas gratuitas: Talkwalker Alerts (e-mail/RSS/Slack) e Free Social Search (7 dias de histórico) | VERIFICADO | <https://www.talkwalker.com/alerts> |

## Fontes/redes cobertas oficialmente

- **Redes sociais (30+):** Facebook, Instagram, X/Twitter, LinkedIn, YouTube, TikTok, Pinterest, Bluesky, Snapchat, Twitch, Vimeo, Dailymotion, LINE, Reddit, Truth Social, Google (Busca/Notícias), Bing, Google My Business, Baidu.
- **Web/notícias:** 150M+ sites em 196 países e 187 idiomas; infraestrutura própria de crawling declarada (5.000+ servidores, 3,5 TB/dia).
- **Reviews:** 300+ sites (Amazon, Apple App Store, AO.com, AlaTest…).
- **Outros:** blogs, fóruns, newsletters, podcasts, surveys, print/broadcast (via add-ons/parceiros).
- **Feedback direto:** support tickets, e-mails, transcripts de call center, comunidades (dados ingeridos do cliente).

## Modelo de precificação (informação pública)

- 3 planos (**Core / Analyze / Business**), cotação customizada, usuários ilimitados. Diferenciais: volume de resultados não-amostrados (2× no Analyze, 6× no Business), nº de tópicos/filtros, dados históricos adicionais, workspaces/governança enterprise.
- **API:** créditos mensais (Search 1/resultado + 10/call; Stream 1/resultado; Histogram 10/call; importações gratuitas; reset mensal; rate limit 10 calls/min no endpoint de créditos).
- Gratuito: Alerts e Free Social Search (7 dias).

## Análise: o que depende de acordos proprietários vs. o que é construível

**Depende de acordos de dados/firehose (dificilmente replicável com APIs públicas):**

- Dados sociais em escala não-amostrada (Meta, X, TikTok, Reddit…).
- Cobertura de 150M+ sites e 5 anos de histórico (infraestrutura própria de crawling).
- Broadcast TV/rádio e clipping impresso (parcerias Cision, Argus, Auxipress, Carma).
- Agregação de 300+ sites de reviews; Social Content Ratings®.
- LLM Insights (sondagem sistemática de IAs generativas).

**Construível sobre APIs públicas/tecnologia própria (onde o Radar pode competir):**

- Motor de queries booleanas e filtros (a sintaxe é documentada publicamente).
- Sentimento, clusterização, resumos, classificador NL (NLP/LLM próprio).
- Logo/scene/object detection (visão computacional).
- Assistente conversacional com RAG sobre os dados da plataforma.
- Dashboards, alertas, relatórios, benchmarking (camada de aplicação).
- Alertas gratuitos (crawler web + fontes abertas).

**Lacunas de evidência (NÃO CONFIRMADO):** formatos de exportação da UI, emoções granulares, integrações BI específicas (Tableau/Power BI), detalhes operacionais do módulo print/broadcast.

## Nota sobre uso do REA nesta fase — ATUALIZADA (2026-11-06, revisão pós-audit)

**Estado anterior:** o REA estava instalado, mas sem navegador com endpoint CDP a investigação ficou **documental** (fetch de páginas públicas).

**Estado atual — engenharia reversa executada (limites respeitados).** Um Chromium headless (Chrome/143, binário do Playwright) foi lançado localmente com `--remote-debugging-port=9222` e o REA conectou-se a ele via CDP em loopback (`http://127.0.0.1:9222`). Observação **passiva** de páginas públicas autorizadas, sem autenticação, sem burlar controles de acesso (help center SAML **não** acessado):

| # | Operação REA | Alvo | Evidence ID | Confiança |
|---|---|---|---|---|
| R1 | `list-browser-targets` | Chromium local | `ev_9dd34d44c8afea19…` | observed |
| R2 | `inspect-web-page` (3s, a11y + console + shapes JSON) | `https://www.talkwalker.com/` | `ev_28feb590630195ce…` | observed |
| R3 | `inspect-web-page` (3s, a11y) | `https://www.talkwalker.com/social-media-listening` | `ev_86af5535aa67b005…` | observed |
| R4 | `capture-web-screenshot` | página social-media-listening (sha256 `dee74285ef897d81…`) | `ev_29bf3e285aab8e26…` | observed |

Bundles de evidência brutos: `docs/research/evidence/` (2 JSON + 1 PNG com digest). Nenhum conteúdo privado ou autenticado foi acessado.

**Descobertas observadas (não apenas documentadas) — promovidas no inventário:**

- **Rebranding confirmado no DOM ao vivo:** título da home = "Social Listening and Media Monitoring Tool | **Lumen by Talkwalker**"; heading H1 "Talkwalker is now Lumen by Talkwalker". Atualiza a nota de contexto: a rebrand não é apenas comunicado de marketing, está efetivamente no site.
- **Arquitetura de navegação observada** (árvore de acessibilidade, 770 nós na home): produtos = Social listening, Media monitoring, Social benchmarking, Audience insights, Customer feedback analytics; soluções verticais = Marketplace, Consumer goods, Sports, Media, Financial services, Pharma & healthcare, Technology, Agency; personas = PR & comms, Social marketing, Consumer insights, Agencies; recursos = Blog, Reports, Marketing essentials, Status, **Developer portal**.
- **Página de produto social-media-listening (observada):** headings "Never miss another mention", "Protect your brand across the world", "Spot emerging trends with real-time social media listening", "Listen, react, and respond in real time", "Get the full picture with **visual listening**", "AI-powered social listening" + FAQ. Confirma visual listening (A9) e tempo real como mensagens de produto centrais.
- **Prova social observada:** "The first choice of over 2,500 organizations"; cases Bayes Business School, Orange, Yves Rocher; selo Forrester New Wave™.
- **Stack observável da página pública:** A/B testing via Optimizely (iframe `cdn.optimizely.com`), cookie preference center (OneTrust-style), rodapé com link de privacidade **Hootsuite** (integração pós-aquisição), language selector (EN). Iframes de terceiros excluídos da inspeção pelos filtros de origem do próprio REA.
- **Guias de fundo observados no footer:** social media listening guide, social media analytics guide, PR crisis management guide, consumer intelligence guide, Best OSINT tools.

**Limites mantidos:** nenhuma conta, login, paywall ou endpoint autenticado foi tocado; o produto em si (app logado) permanece **DOCUMENTADO NÃO OBSERVADO**. A classificação VERIFICADO continua significando "página pública aberta/observada", não "produto operado".
