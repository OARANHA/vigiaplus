# Análise de Lacunas — Talkwalker × Radar Intelligence

> **Data:** 2026-11-06 · Base: `docs/research/talkwalker-capabilities.md` (Fase A) e `docs/research/radar-audit.md` (Fase B), baseline `2c66448`.
> Prioridades: **P0** = fundação sem a qual nada mais é demonstrável/confiável · **P1** = paridade funcional visível · **P2** = diferenciais · **P3** = dependentes de acordos de dados, fora de controle.

## 1. Matriz comparativa

| Capacidade | Talkwalker | Radar (baseline) | Lacuna | Complexidade | Dep. de dados | Custo oper. | Prioridade | Critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| Consultas booleanas avançadas | 50 operandos, 4096 chars, restrições métricas/geo | Filtro booleano central (`lib/ingest.ts`), query builder NL→boolean, teto 50 operandos p/ Talkwalker | Construtor visual de queries com preview de volume e validação de sintaxe | Média | Nenhuma | Baixo | **P1** | Usuário monta query booleana composta na UI, recebe contagem preview e erros de sintaxe apontados |
| Sentimento | Blue Silk™, 187 idiomas | Análise por LLM (sentimento + score) em batch sobre menções | Métricas de qualidade do modelo (precisão/revocação) e benchmark pt-BR | Média | Nenhuma (usa LLM configurado) | Custo de tokens (já orçamentado) | **P1** | Suite de avaliação com dataset rotulado pt-BR executável por CI; relatório de acurácia publicado |
| Emoções | NÃO CONFIRMADO no Talkwalker público | **Implementado**: 6 emoções Plutchik por menção (`lib/claude.ts`) | — (Radar à frente) | — | — | — | — | Já coberto por testes existentes de análise |
| Clusterização de conversas | Conversation Clusters, virality maps | `/insights/clusters`, constelação semântica, galáxia, network | Melhorar UX de exploração dos clusters | Baixa | Nenhuma | Baixo | P2 | Página de clusters navegável com drill-down por cluster |
| Detecção de anomalias/picos | Peak detection + explicação | Alertas com contexto, radar de crise com anatomia de pico e forecast | Explicitar critérios de alerta configuráveis (limiares de volume/sentimento) | Média | Nenhuma | Baixo | **P1** | Usuário configura limiar (ex.: +3σ volume, Δ sentimento) e o alerta dispara com evidência |
| Share of Voice | SOV comparativo entre entidades | `/insights/sov`, benchmark com `benchmark_entities` (isOwnBrand) | SOV no tempo por canal/idioma | Baixa | Nenhuma | Baixo | P1 | Gráfico SOV multi-entidade com filtro de canal e período |
| Influenciadores | Influencer finder | `influencer_profiles`, `/insights/pyramid`, `/insights/network` | Ranking por tópico com justificativa | Baixa | Nenhuma | Baixo | P3 | — |
| Monitoramento de concorrentes | Benchmarking competitivo | `/benchmark` + entidades próprias/concorrentes | Comparativo de sentimento no tempo | Baixa | Nenhuma | Baixo | P1 | Benchmark com série temporal de sentimento por entidade |
| Notícias/web ampla | 150M+ sites, 196 países, 187 idiomas | Googlenews, GDELT, RSS, NewsAPI, Newsdata + Talkwalker (import) | Cobertura **limitada por design** (sem crawling próprio) — ver §2 | Alta (fora de controle) | Acordos/licenças | Alto | **P3** | N/A — limitação de acesso a fontes, não de implementação |
| Redes sociais | 30+ redes via firehose | X, Instagram, Facebook, TikTok, LinkedIn (premium BYOK), Reddit, Bluesky, Mastodon, YouTube, Telegram, Discord… | Cobertura depende de chaves do usuário; sem streaming | Média | BYOK por cliente | Médio | **P3** | Conector documentado com passos de obtenção de chave |
| Histórico de dados | Até 5 anos | **Retenção 90 dias hard-delete** (coletados) | Retenção configurável + exportação de raw dump antes da expiração | Média | Nenhuma | Armazenamento | **P0** | `MENTION_RETENTION_DAYS` configurável; job de export antes do purge; documentado |
| Assistente de IA conversacional | Wisdom (agentic, citações, Slack) | `/ask` (chat sobre menções com citações), POV com fact-pack e citações validadas | Qualidade do match de menções (ILIKE ingênuo) + proatividade | Média | Nenhuma | Tokens | **P1** | `/ask` responde com citações verificáveis; substituir ILIKE por busca semântica (embeddings) |
| Resumos automáticos | AI Summaries (diário/semanal/mensal) | Daily brief adaptativo, POV, comentário de relatório | Resumos periódicos semanais/mensais | Baixa | Nenhuma | Tokens | P2 | `/report/periodic` gera digest semanal com seções configuráveis |
| Alertas em tempo real | E-mail, telefone, 24/7 | Alertas no pipeline + Telegram | Canais: e-mail/Slack/webhook | Média | SMTP/webhook | Baixo | P1 | Alerta entregue por e-mail e webhook em incidente simulado |
| Logo detection (imagens) | Image API (logo/object/scene) | Ausente | Visão computacional sobre imagens de menções coletadas | Alta | Modelo de visão (pode ser BYOM) | Médio | P2 | Menção com imagem recebe detecção de marca com confiança; evidência auditável |
| Análise de vídeo/áudio | Declarado (YouTube, TikTok, podcasts) | PodcastIndex (metadados); sem transcrição | ASR para transcrição de podcasts/vídeos monitorados | Alta | Serviço ASR | Médio | P2 | Episódio de podcast monitorado é transcrito e entra como menção com proveniência |
| Customer Feedback Analytics | 300 fontes, intent, location | `/reviews` (App Store, Google Places, Yelp) + import de arquivos | Detecção de intenção e agregação multi-fonte | Média | Nenhuma | Tokens | P2 | Review importado recebe classificação de intenção com evidência |
| Audience segmentation | AI segmentation (NL), Audiense/Affinio | `/audience` (comunidades, línguas, vozes) | Segmentos por descrição em linguagem natural | Média | Nenhuma | Tokens | P2 | Segmento criado por descrição NL retorna subconjunto coerente de menções |
| LLM Insights (monitorar IAs generativas) | Produto dedicado | Ausente | **Diferencial retro**: sondar LLMs sobre a marca | Média | Chaves de LLM | Médio | **P2** | Job periódico consulta LLMs configuradas com prompt fixo; histórico de posicionamento/soberba comparável |
| API pública | 12 famílias de endpoints, créditos | **MCP real** (11 tools read-only, 9 prompts, token) + app web | API REST documentada para clientes | Média | Nenhuma | Baixo | P1 | Endpoint REST read-only com chave, limites e documentação OpenAPI |
| Relatórios automatizados | Custom reports por stakeholder | `/report` custom + periódico, exports PDF/DOCX/PPTX/XLSX | Agendamento com mais granularidade | Baixa | Nenhuma | Baixo | P1 | Relatório periódico entregue por e-mail no horário configurado |
| Dashboards pré-construídos | IQ Apps | Templates de relatório | Biblioteca de templates de dashboard | Baixa | Nenhuma | Baixo | P2 | 3 templates prontos (marca, crise, campanha) |
| Multi-tenancy | Workspaces/governança enterprise (Business) | Single-instance; projetos com owner/visibility | Organizações → workspaces → projetos; RBAC; audit log | **Alta** | Nenhuma | Médio | **P0** (evolução, ver arquitetura) | Isolamento verificável: usuário de tenant A não lê dados de tenant B por nenhuma rota |
| Segurança de sessão | Enterprise SSO | Cookie HMAC sem revogação; cron aberto sem secret; `DEMO_MODE` | Sessões versionadas/revogáveis; auth do cron obrigatória | Média | Nenhuma | Baixo | **P0** | Troca de senha invalida sessões; cron retorna 401 sem secret válido |
| Interface pt-BR | — (produto em EN) | i18n EN/IT | **Português brasileiro** (requisito do produto) | Baixa | Nenhuma | Zero | **P0** (Incremento 1) | Seletor com 🇧🇷; UI e conteúdo de IA em pt-BR; datas pt-BR; testes |
| CI com testes | — | CI sem `npm test` | Rodar os 194 testes no CI | Baixa | Nenhuma | Zero | **P0** (Incremento 1) | Workflow CI executa lint + tsc + test + build no mesmo commit |

## 2. Limitações de implementação × limitações de acesso a fontes

**Limitações de acesso (não resolvíveis por engenharia própria):**

- Escala de cobertura web (150M+ sites) e histórico de 5 anos do Talkwalker dependem de infraestrutura de crawling própria e acordos — o Radar por design usa fontes abertas + BYOK + importação (incl. Talkwalker API).
- Firehose social não-amostrado (Meta/X/TikTok) exige licensing comercial.
- Print/broadcast exige parceiros de transcrição/clipping (Cision, Argus…).

**Decisão de produto:** o Radar compete em **transparência, custo, self-hosting, BYOK e IA verificável**, não em escala de cobertura. A matriz de prioridades acima reflete isso: P3 para tudo que depende de acordos, P0/P1 para o que é construível e demonstrável.

**Importante:** dois conectores não são "equivalentes" só porque existem — a cobertura real do Radar por rede social depende da chave que o usuário traz (BYOK) e do quota dessa chave. A documentação de cada conector deve declarar: o que a fonte retorna, limites típicos e custo.

## 3. Priorização executada (roadmap)

- **Incremento 1 (P0, executado agora):** interface pt-BR + content-locale pt-BR + CI rodando os testes + testes de i18n. Baixo risco, alto valor, totalmente demonstrável.
- **Incremento 2 (P0):** hardening de sessão e cron (revogação de sessão, auth obrigatória do cron) + `.env.example` completo + remoção de deps mortas.
- **Incremento 3 (P1):** busca semântica no `/ask` e alertas com limiares configuráveis.
- **Incremento 4 (P1):** API REST read-only documentada + agendamento de relatórios por e-mail.
- **Incremento 5 (P0, maior):** multi-tenancy (organizações/workspaces/RBAC/audit log) — só após estabilização dos anteriores.
- **P2/P3:** ver `docs/roadmap.md`.
