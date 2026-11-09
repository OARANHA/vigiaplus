# O Vigia — dossiê de remodelagem

> **Pergunta respondida:** «com o chapéu de dono/engenheiro e o chapéu de usuário leigo, daria para remodelar e aperfeiçoar o Vigia?»
> **Resposta:** sim. Este documento é a remodelagem; `vigia-prototipo.html` é ela em forma navegável.
> **Status:** proposta. **Nenhum arquivo do repositório `crises` foi alterado.**
> **Revisão 2 — correção importante:** a versão 1 simplificou o **dono** junto com o cliente. Errado. O dono deve ter **muito mais** páginas e configurações: 13 áreas / ~40 telas. A regra correta é *complexidade proporcional à responsabilidade*, não ao cargo. O protótipo e este dossiê foram atualizados (§2.3).

---

## 1. A ideia que muda tudo

O Radar atual é um **instrumento**: você entra, procura, interpreta, monta o relatório.
O Vigia precisa ser um **serviço**: ele está acordado por você, interpreta por você e **te procura** quando algo muda.

> **O dashboard espera ser consultado. O Vigia avisa.**

Essa única frase reorganiza produto, arquitetura e custo. Um serviço cobra assinatura, promete prazo de detecção e responde por dado vazado — três coisas que um instrumento não promete. É por isso que multi-tenancy, cotas, agendamento e audit log deixam de ser «dívida técnica» e viram **requisito de produto**.

---

## 2. Os dois chapéus

### 2.1 Dono com capacidade de engenharia — o que ele mede

| Pergunta do dono | Resposta que a arquitetura precisa dar |
|---|---|
| «Posso vender sem medo de um cliente ver o outro?» | Isolamento por `tenant_id` em **todas** as tabelas, verificado por teste automático em **todas** as rotas |
| «Quanto me custa cada cliente?» | `usage_by_tenant`: menções coletadas, chamadas de IA, tokens, armazenamento, e-mails — com teto por plano |
| «Consigo prometer rapidez?» | Fila por tenant com SLA de detecção (alvo: ≤ 15 min para fontes de crise), não cron global às 05:00 |
| «Escala sem eu contratar gente?» | Convite por e-mail self-service, onboarding sem intervenção manual, saúde das fontes visível |
| «E se der problema, consigo provar o que houve?» | `audit_events` imutável: login, exportação, aprovação de nota, troca de chave, exclusão |
| «Posso colocar minha marca?» | White-label: nome, cor, domínio e remetente por tenant |
| «Estou legalmente seguro?» | LGPD (consentimento, minimização, retenção, exportação, exclusão) + **AGPL-3.0 resolvido antes da venda** |
| «Quanto do que já existe eu aproveito?» | ~85%: 28 conectores, pipeline, sentiment, insights, Health Index, playbook, exportações, segurança, 245 testes |

**Decisões de engenharia (com justificativa):**

1. **Manter o monolito modular Next.js.** O ADR-1 do próprio repo está certo: time pequeno, deploy único, nenhum gargalo comprovado. Microsserviço aqui seria custo sem benefício.
2. **Não reescrever, mas isolar fronteiras.** Hoje 64 páginas chamam `getDb()` direto e `lib/data.ts`/`lib/auth.ts` leem `cookies` de `next/headers`. Introduzir `getTenantContext()` **injetado** (nunca lido dentro da query) e proibir qualquer `SELECT` sem filtro de tenant. Essa é a única refatoração realmente grande.
3. **Separar dois apps dentro do mesmo deploy**: `/app` (portal do cliente, 4 telas) e `/console` (operação do dono) e, atrás de `VIGIA_ANALYST_MODE`, o Radar completo para a equipe interna. Nada é apagado — só deixa de ser exposto.
4. **«Duas reputações» vira entidade de primeira classe**, não dois projetos alternados por cookie: `reputation_targets` dentro do tenant. Assim o cliente vê os dois scores **lado a lado** e a mesma estrutura atende tanto «Marca × Mercado» (o `brandHealthReport` de hoje) quanto «Marca A × Marca B» (dois conjuntos de palavras-chave). Resolve a ambiguidade sem exigir que você decida agora.
5. **Crise vira workflow**, não log: `incidents` + `incident_actions`.
6. **Migrações versionadas** com `drizzle-kit`; os 91 DDL do boot saem do caminho de produção.
7. **Chave de criptografia independente** (`CREDENTIALS_ENC_KEY` + versão), para que rotacionar `SESSION_SECRET` não apague as chaves salvas silenciosamente.

### 2.2 Usuário leigo — o que ele realmente quer

O cliente (dono de empresa, diretor de comunicação) não quer «menções», «sentiment score», «SOV», «query booleana» ou 16 gráficos. Ele quer responder a **4 perguntas em 30 segundos**, no celular:

1. **Estou bem ou estou mal?** → um número, uma cor, uma frase: *«Sua reputação está 72/100, boa e estável, melhor que a média do setor.»*
2. **O que mudou desde ontem?** → três linhas, sem jargão.
3. **Tem alguma crise?** → semáforo + *«Estamos cuidando, próxima atualização às 14h»*.
4. **Preciso fazer alguma coisa?** → no máximo um botão: aprovar uma nota, baixar um relatório, falar com a equipe.

**Regras que o protótipo aplica:**

| Regra | Como aparece |
|---|---|
| Uma tela, uma pergunta, uma ação | Panorama / Crises / Relatórios / Conta — só isso no menu |
| Linguagem de gente | «comentários ruins», não «negative sentiment share»; «jornais e redes», não «fontes»; «o que estão falando», não «menções» |
| Número nunca sem contexto | «72/100 · 1.240 comentários · 14 dias · 24 fontes» — explica de onde veio, evita caixa-preta |
| Nunca tela vazia | «Ainda estamos coletando — amanhã você já vê o panorama completo» em vez de `Not enough mentions` |
| Nunca erro em inglês/italiano | Toda mensagem em pt-BR |
| Sem senha temporária | Convite por e-mail com link de ativação de uso único |
| Proatividade | WhatsApp/e-mail quando fica vermelho — o cliente **não precisa logar** para saber |
| Sem susto desnecessário | «Atenção» ≠ «Crise»; o sistema distingue e explica a diferença |

O seletor **«Chapéu: cliente leigo / dono-engenharia»** no protótipo existe para provar o ponto: a mesma tela troca «Está boa e estável» por `Brand Health 72 · sentiment 0,31 · n=1.240`. **A informação é idêntica; o vocabulário é que decide para quem o produto serve.**

### 2.3 Correção: o dono tem MUITO mais telas (e deve ter)

A versão 1 deste dossiê cometeu um erro de ênfase: ao reduzir o cliente a 4 telas, deixou o dono com uma única tabela de clientes. **Você está certo em questionar.** O dono não é «outro usuário leigo» — ele responde por isolamento, custo, SLA, conformidade, faturamento e pela operação de todos os tenants. Quatro telas seriam negligência, não simplicidade.

> **Princípio corrigido:** a simplificação é um **privilégio do cliente**, não uma propriedade do sistema. A complexidade some da superfície exposta ao cliente e se **concentra** no console do dono.

**Três superfícies, não duas:**

| Superfície | Para quem | Telas | O que contém |
|---|---|---|---|
| `/app` — portal | Cliente (`client_admin`, `client_viewer`) | **4** | Panorama, Crises, Relatórios, Conta |
| `/console` — backoffice | Dono (`owner`) e operação (`analyst`) | **~40 em 13 áreas** | Ver inventário abaixo |
| `/analyst` — Radar completo | Dono e equipe, atrás de flag | **64** | As páginas atuais, integralmente preservadas |

**Inventário do console do dono (implementado no protótipo, aba «Console do dono»):**

| # | Área | Configurações que você controla |
|---|---|---|
| 1 | **Visão geral** | MRR, custo de IA, SLA de detecção, fila de atenção priorizada, saúde da operação |
| 2 | **Clientes / tenants** | Criar/editar, CNPJ, plano, domínio, alvos de reputação, idioma/fuso, contatos, retenção, módulos; suspender, revogar sessões, **entrar como** (com auditoria) |
| 3 | **Planos e faturamento** | Preços, limites de menções/fontes/IA/usuários/retenção, consumo por cliente, elevação pontual de teto, faturas, inadimplência, gateway (Asaas/Stripe), regras de suspensão |
| 4 | **Fontes e credenciais** | 28 conectores, chave centralizada **ou por cliente**, teste, rotação, quota, erros, créditos Talkwalker, habilitar por plano |
| 5 | **Coleta e fila** | Jobs por tenant, cadência por tipo de fonte (15 min / 60 min / 6 h), retry/backoff, dead-letter, reprocessar, coletar agora, pausar tenant, modo manutenção |
| 6 | **Motor de IA** | Provedor e fallback, modelo por tarefa, temperatura, prompts versionados, teto global e por tenant, custo por finalidade, **avaliação de sentimento pt-BR (F1)**, taxa de falsos positivos |
| 7 | **Regras de crise** | Limiares por tenant, palavras-chave sensíveis, horário de silêncio, escalonamento, SLA, canais/destinatários, templates de playbook, aprovação obrigatória, incidente simulado |
| 8 | **Acessos e segurança** | Matriz RBAC, convites, 2FA, rate limit no login, política de senha, sessões ativas, SSO/SAML, allowlist de IP, **trilha de auditoria imutável e exportável** |
| 9 | **LGPD e retenção** | Retenção por tenant, exportação obrigatória antes do descarte, solicitações de titulares, consentimento versionado, subprocessadores/DPA, localização dos dados |
| 10 | **Marca e comunicação** | White-label (nome, logo, cor, domínio, remetente SPF/DKIM), templates de WhatsApp/e-mail, **vocabulário proibido** no portal do cliente |
| 11 | **Relatórios** | Modelos por plano, periodicidade, entrega, seções habilitadas, biblioteca de dashboards, teste de envio |
| 12 | **Sistema e flags** | Uptime, latência, erros 5xx, versão do schema, backups/migrações, feature flags (`VIGIA_ANALYST_MODE`, API REST, embeddings), chaves de API/MCP e rate limits, webhooks |
| 13 | **Modo analista** | As 64 páginas do Radar: query builder, import, 16 insights, POV, Studio, War Room, MCP, Sport, Wikipedia, Trials… |

**Um detalhe de UX para o próprio dono:** ele também é «leigo» na segunda-feira às 8h e «engenheiro» quando algo quebra. Por isso o console abre numa **Visão geral enxuta** (4 números + fila de atenção) e oferece **profundidade sob demanda** pelas 13 áreas. Simplicidade no topo, controle total um clique abaixo — sem esconder nada.

**E o que já existe hoje ajuda bastante:** `/settings`, `/impostazioni/*` (budget, credits, fonti, team), `/query`, `/import`, `/mcp` já são páginas de configuração. O problema não é **faltar tela**, é que todas são **globais por instância**. A F1 não cria 40 telas do zero: ela **parametriza por `tenant_id`** as que existem e acrescenta as que faltam (faturamento, fila, auditoria, LGPD, flags, impersonação).

---

## 3. Arquitetura alvo

```
 tenants (cliente / assinatura / plano / marca)
   ├── memberships (user, tenant, role: owner | client_admin | client_viewer | analyst)
   ├── reputation_targets  ← AS «DUAS REPUTAÇÕES»
   │     ├── keywords / is_market_baseline / brand_voice
   │     └── reputation_scores (score, componentes, n, computed_at, janela)
   ├── projects (monitoramento: herdado do Radar, agora com tenant_id)
   │     ├── mentions, reviews, alerts, briefs, reports, timelines ...
   │     └── (todos com tenant_id + índice composto)
   ├── incidents → incident_actions → approvals
   ├── alert_rules (limiares por tenant, canais, destinatários)
   ├── invitations / audit_events / usage_by_tenant
   └── connector_credentials (por tenant, cifradas com chave própria)
```

**Camadas e responsabilidades**

| Camada | Hoje | Vigia |
|---|---|---|
| Entrada | 64 páginas + 52 rotas, uma só sidebar, configurações globais | `/app` (4 telas) · `/console` (**13 áreas / ~40 telas**, configurações por tenant) · `/analyst` (64 páginas, flag) |
| Autorização | `isAdmin()` global + `visibility='shared'` | `can(user, acao, tenant)` declarativo + escopo obrigatório |
| Contexto | cookie `sr_project` lido em ~40 lugares | `getTenantContext()` injetado uma vez, propagado |
| Coleta | cron global 05:00, `for` serial sobre todos os projetos | fila por tenant, retry/backoff, dead-letter, cadência por tipo de fonte |
| Inteligência | `lib/insights`, `lib/claude`, `lib/alerts` | **reaproveitados**; limiares passam a ser configuráveis por tenant |
| Crise | `alerts` (log) + playbook em Markdown | `incidents` com estado, dono, SLA, aprovação, pós-crise |
| Dados | `api_usage` e `meta` globais | `usage_by_tenant`, cotas, retenção configurável com export prévio |

---

## 4. O fluxo de crise ponta a ponta (a maior lacuna atual)

```
fonte publica
  → coleta (≤ 60 min) → normalização + dedupe
  → detectAlerts com limiar DO TENANTE (ex.: volume > 2,5× baseline,
     queda de sentimento > 0,25, n mínimo)
  → classificação automática: ruído | atenção | crise
  → cria incident(status='monitoring', severity, owner, sla_next_at)
  → NOTIFICA o cliente no canal escolhido (WhatsApp / e-mail / Slack)
  → gera playbook + minuta de resposta com IA (já existe: /api/playbook)
  → cliente APROVA / recusa em um clique → audit_events registra
  → acompanha até status='resolved'
  → relatório pós-crise automático (o que aconteceu, quando, o que foi feito)
```

Hoje o sistema para no terceiro passo: detecta e escreve um log. **«Gestão» é tudo que vem depois da notificação.**

---

## 5. O contrato do «número único»

Para um leigo, um score sem explicação é mágica — e mágica gera desconfiança na primeira queda. Contrato obrigatório:

- **Composição explícita** (já existe no `brandHealthReport`): sentimento 35% · share positivo 25% · momentum 20% · ressonância 20%.
- **Proveniência visível**: quantos comentários, de quantas fontes, em qual janela, atualizado quando.
- **Confiança**: se `n < 200`, mostrar «poucos dados, resultado preliminar» em vez de um número confiante.
- **Comparação antes de variação**: «+3» só significa alguma coisa ao lado de «setor −2».
- **Nunca comparar janelas diferentes** nem misturar dados de tenants diferentes no mesmo cálculo.

---

## 6. Plano de execução em 4 fases

| Fase | Entrega | Critério de aceitação (testável) |
|---|---|---|
| **F1 — Fundação (2–3 semanas)** | `tenants`, `memberships`, `tenant_id` em todas as tabelas, `getTenantContext()`, RBAC, migrações drizzle, chave de criptografia própria | `tenant A nunca lê B` em **todas** as rotas; suíte de isolamento roda no CI; build e 245 testes continuam verdes |
| **F2 — Operação + console base (3 semanas)** | Fila por tenant, cotas/`usage_by_tenant`, convite por e-mail, 2FA, rate limit, `audit_events`, saúde das fontes **+ as 6 primeiras áreas do console** (visão geral, clientes, planos, fontes, fila, IA) | 20 tenants simulados sem timeout; detecção ≤ 15 min; custo de IA atribuível por cliente; **você consegue operar sem abrir o banco** |
| **F3 — O Vigia (3 semanas)** | Portal `/app` (4 telas), `reputation_targets` com score duplo, `incidents` + aprovação, notificações WhatsApp/e-mail, white-label | Teste com 5 leigos reais: cada um responde «estou bem?», «o que mudou?», «tem crise?» em < 30 s, sem ajuda |
| **F4 — Console completo (2–3 semanas)** | **As 13 áreas**: regras de crise, acessos/auditoria, LGPD, marca, relatórios, sistema/flags, modo analista + faturamento, retenção/exportação, resolver AGPL | Cada configuração do inventário §2.3 é editável pela UI e registrada em `audit_events`; runbook e parecer jurídico arquivados |

**Ordem importa:** F3 sem F1 é o erro mais tentador e o mais caro — você entregaria uma interface linda em cima de um modelo onde todo mundo vê todo mundo.

---

## 7. Riscos que o dono precisa olhar antes

1. **AGPL-3.0** — SaaS aciona a cláusula de rede; o repo é importação em commit único de `Scognamiglio1969/radar-intelligence`. Sem licença comercial ou conformidade, há risco jurídico sobre a própria comercialização. **É o item nº 1, não o último.**
2. **LGPD** — dados de menções podem conter dados pessoais de terceiros; é preciso base legal, minimização, retenção, portabilidade, exclusão e registro de exportações.
3. **Falso positivo** — para um leigo, um alarme errado destrói a confiança no Vigia. Começar conservador (mais «atenção», menos «crise») e medir precisão com dataset rotulado.
4. **Custo de IA por cliente** — sem cota por tenant, um cliente com_volume alto consome o orçamento de todos; o `api_usage` atual não tem dono.
5. **Complexidade escondida** — o modo analista continua existindo; se não for isolado por flag, a equipe volta a expor as 64 telas «sem querer».

---

## 8. Suposições que fiz (me corrija e eu ajusto)

1. «Duas reputações» = **dois alvos comparados lado a lado**; desenhei para suportar tanto *Marca × Mercado* quanto *Marca A × Marca B*.
2. Você **centraliza** as chaves de API e revende o serviço (não BYOK por cliente) — por isso o console mostra custo de IA por cliente.
3. White-label desejável, mas não na primeira fase.
4. **Comercialização externa** — por isso AGPL e LGPD aparecem como P0.

Se alguma estiver errada, o modelo de dados muda pouco (principalmente `connector_credentials` e a tela de cobrança).

---

## 9. O que eu preciso de você para transformar proposta em código

1. As 4 respostas acima confirmadas ou corrigidas.
2. Autorização para trabalhar **no repositório** (posso abrir uma branch `feat/vigia-tenants` com a F1 e os testes de isolamento, sem tocar em `main`).
3. Definir se o protótipo HTML vira o design oficial ou se você tem uma identidade visual própria.
4. Nome comercial e domínio (para white-label e remetente de e-mail).

---

## 10. Resumo em uma linha por chapéu

- **Como dono/engenheiro:** aproveito ~85% do que já está pronto, troco a fronteira de confiança (de «instância» para «tenant»), transformo custo em algo atribuível e detecção em algo com SLA — sem microsserviços, sem reescrita. **E ganho 13 áreas / ~40 telas de configuração por tenant, mais as 64 páginas do modo analista: mais controle do que tenho hoje, não menos.**
- **Como usuário leigo:** de 64 telas e 30 menus para 4 telas, uma frase e um botão; de «eu preciso entrar para saber» para «o Vigia me avisa».
- **A regra que concilia os dois:** a complexidade não desaparece — ela **sai da frente do cliente e se concentra nas suas mãos**.
