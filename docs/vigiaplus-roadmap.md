# VigiaPlus — Planejamento de desenvolvimento a longo prazo v1.1

> **Complemento de:** `vigiaplus-arquitetura.md` (SAD)
> **Revisão 1.1:** protótipo v3, fundação executável, Docker/Traefik e commit local implementados e medidos (§14)
> **Horizonte:** ~12 meses em 7 horizontes, revisados a cada 4 semanas
> **Princípio:** cada horizonte é **testável, reversível e demonstrável**. Nada se declara pronto sem teste + validação na interface.
> **Sequência definida pelo dono, respeitada:** *testar uma → teste adversarial → capacidade de planos → cliente ter área de plano e aviso → pagamentos → pt-BR → Docker/Traefik*.

---

## 1. O que este planejamento protege

| Valor | Como o plano protege |
|---|---|
| **Não reescrever** | Todo horizonte reaproveita `crises`; a F0 cria o repo novo **importando** o existente, não reescrevendo |
| **Isolamento antes de interface** | Nenhuma tela de cliente aparece antes do gate adversarial |
| **Custo controlado** | Cota e roteamento de LLM entram no H0, antes de qualquer cliente pagante |
| **Sequência do dono** | H0 «testar uma» → H1 adversarial → H2 planos + área do cliente → H3 pagamentos → H5 pt-BR → H6 Docker/Traefik |
| **Valor perceptível** | Cada horizonte tem um critério de **percepção de valor**, não só técnico |

---

## 2. Mapa de horizontes

```
H0  Fundação + UMA cliente piloto      ██████  semanas 1–5
H1  Testes adversariais + robustez     █████   semanas 6–10
H2  Planos + Meu plano / Avisos        ██████  semanas 11–17
H3  Pagamentos Stripe + Pix            █████   semanas 18–23
H4  Escala de verdade                  ██████  semanas 24–31
H5  pt-BR, MCP, white-label, API       █████   semanas 32–38
H6  Docker + Traefik + operação        █████   semanas 39–44   (contínuo depois)
        ↑ gate jurídico AGPL obrigatório antes de cobrar (fim do H2)
```

**Dependências críticas:** `H0 → H1 → H2 → H3`. H4/H5 podem antecipar partes, mas **nunca** antes de H1. H6 começa em paralelo desde o H0 em ambiente de staging (não deixa para o fim na prática).

---

## 3. H0 — Fundação e «testar uma» (semanas 1–5)

> **Seu primeiro pedido: testar uma.** Um único cliente, ponta a ponta, antes de qualquer generalização.

| Épico | Entrega |
|---|---|
| E0.1 | Criar `vigiaplus` a partir de `crises` preservando histórico e os 245 testes |
| E0.2 | `tenants`, `memberships`, `tenant_id` em todas as tabelas, RLS, `TenantContext` injetado |
| E0.3 | RBAC (`owner / analyst / client_admin / client_viewer`) e `can()` declarativo |
| E0.4 | **LLM Registry OpenAI-compatible** + `llm_routes` + teste de conexão na UI |
| E0.5 | **Catálogo de features / entitlements** (base, sem cobrança ainda) |
| E0.6 | **Modo básico / avançado** (dois eixos: vocabulário e densidade) |
| E0.7 | Três superfícies; **modo analista com as 64 páginas intactas** |
| E0.8 | Fila por tenant + scheduler (substitui o cron global) |
| E0.9 | **Cliente piloto**: 2 alvos de reputação, 1 incidente simulado, 1 relatório |
| E0.10 | `docker-compose` de desenvolvimento + Traefik em staging (semente do H6) |

**Critérios de saída (DoD):**
- [ ] O piloto navega as 4 abas, vê as duas reputações e um incidente com playbook aprovado.
- [ ] Você, como `owner`, abre **qualquer uma das 64 páginas** no modo analista.
- [ ] Cadastrar um provedor LLM novo (ex.: Ollama local) **sem editar código** e sem deploy.
- [ ] Ligar/desligar um recurso para o piloto pela UI, com registro em `audit_events`.
- [ ] Toggle básico/avançado funciona e **não altera permissões** (teste A4).
- [ ] 245 testes antigos + nova suíte passando; `tsc` e build verdes.

**Percepção de valor:** a faixa «24 fontes · 1.240 comentários · 11 min · 2 assuntos» aparece no modo básico.
**Riscos:** migração dos 91 DDL; AGPL (iniciar parecer já aqui, não deixar para o H3).

---

## 4. H1 — Testes adversariais e robustez (semanas 6–10)

> **Seu segundo pedido: usar teste adversarial.** Aqui o isolamento deixa de ser intenção e vira garantia.

| Épico | Entrega |
|---|---|
| E1.1 | Suíte A1–A10 do SAD §12 como **gate obrigatório de CI** |
| E1.2 | RLS verificada com consulta deliberadamente sem `WHERE` |
| E1.3 | Defesa contra prompt injection no conteúdo coletado (dado ≠ instrução) |
| E1.4 | Validação SSRF em `base_url` de LLM; timeouts; limite de resposta |
| E1.5 | Rate limit no login, 2FA, política de senha, revogação por tenant |
| E1.6 | `audit_events` imutável em todo mutator + exportação |
| E1.7 | Chave de criptografia independente e versionada (migração das credenciais atuais) |
| E1.8 | Migrações drizzle-kit versionadas; DDL removido do boot |
| E1.9 | Observabilidade mínima: tracing por tenant, métricas de jobs, saúde das fontes |

**Critérios de saída:**
- [ ] **Red team interno**: 10 ataques tentados, 10 bloqueados, com evidência arquivada.
- [ ] `tenant A nunca lê B` provado em **todas** as rotas + no banco via RLS.
- [ ] Webhook replay não duplica; cota excedida bloqueia e avisa.
- [ ] Pipeline de CI falha **de propósito** se um teste adversarial for removido (teste do teste).

**Percepção de valor:** você consegue mostrar a um cliente corporativo um relatório de segurança real — isso vende.
**Risco:** falsa sensação de segurança se a suíte não for mantida; torná-la obrigatória no CI é o antídoto.

---

## 5. H2 — Planos + «Meu plano» e «Avisos» (semanas 11–17)

> **Seu terceiro e quarto pedidos:** capacidade de planos e o cliente ter a área dele de plano e aviso.

| Épico | Entrega |
|---|---|
| E2.1 | `plans`, `plan_features`, `tenant_features` (override com motivo e expiração) |
| E2.2 | Console: catálogo de features, matriz plano × recurso, overrides por cliente |
| E2.3 | Limites operacionais (menções, fontes, usuários, IA, retenção) aplicados no servidor |
| E2.4 | **Portal: bloco «Meu plano»** — plano, inclusos, uso do mês, próxima fatura, upgrade |
| E2.5 | **Portal: bloco «Avisos»** — canais, tipos, silêncio, histórico legível |
| E2.6 | `notification_channels` + `worker-notify` (e-mail, WhatsApp, Slack, webhook) |
| E2.7 | `alert_rules` configuráveis por tenant; escalonamento e SLA |
| E2.8 | Simulação de custo por cliente no console |
| E2.9 | **Gate jurídico AGPL-3.0 resolvido e arquivado** |

**Critérios de saída:**
- [ ] Criar 3 planos e atribuir a 3 tenants; desligar `crisis_playbook` para um e a rota responder 403.
- [ ] Override temporário expira sozinho e é auditado.
- [ ] Cliente vê uso, entende o que está incluído e altera preferências de aviso **sem falar com você**.
- [ ] 5 pessoas leigas encontram «Meu plano» e «Avisos» em < 20 s, sem ajuda.
- [ ] **Parecer/negociação AGPL arquivado antes de qualquer cobrança.**

**Percepção de valor:** o cliente entende o que paga e controla como é avisado — sem encher o menu (continua com 4 abas).
**Risco:** inflar o menu do cliente. **Decisão registrada:** plano e avisos ficam dentro de «Minha conta».

---

## 6. H3 — Pagamentos Stripe + Pix (semanas 18–23)

| Épico | Entrega |
|---|---|
| E3.1 | `PaymentGateway` abstrato + `StripeAdapter` + `PixAdapter` (Asaas / Mercado Pago / Pagar.me) |
| E3.2 | Checkout, assinaturas, faturas, QR/copia-e-cola Pix, estornos |
| E3.3 | Webhooks assinados + `payment_events` idempotente |
| E3.4 | Estado da assinatura **dirige entitlements** automaticamente |
| E3.5 | Dunning: aviso 3º dia, bloqueio 7º, exclusão 90 d; conciliação Pix |
| E3.6 | Console financeiro: MRR, inadimplência, faturas, custo de IA por cliente, margem |

**Critérios de saída:**
- [ ] Pagamento aprovado libera recursos em < 60 s; atraso bloqueia conforme regra; webhook replayado não duplica.
- [ ] Pix conciliado corretamente mesmo com pagamento fora do horário bancário.
- [ ] Nenhum recurso é liberado por decisão do frontend.
- [ ] Você fecha o mês sabendo **a margem por cliente**.

**Risco:** Pix recorrente — começar com avulso + conciliação; adotar **Pix Automático** quando o gateway suportar, sem retrabalho no adaptador.

---

## 7. H4 — Escala de verdade (semanas 24–31)

| Épico | Entrega |
|---|---|
| E4.1 | `worker-ingest` / `worker-ai` / `worker-notify` escaláveis; leader election no scheduler |
| E4.2 | `pg_trgm` GIN / `tsvector`; materialized views + cache Redis com invalidação |
| E4.3 | Particionamento de `mentions` por tenant + mês; retenção com export prévio |
| E4.4 | Read replica + pooler para relatórios |
| E4.5 | SLA de detecção ≤ 5 min; p95 do portal < 500 ms |
| E4.6 | Teste de carga: 500 tenants / 5 M menções-dia sintéticas |
| E4.7 | DR: PITR, restore testado, runbook de incidente |

**Critérios de saída:** carga alvo sustentada por 24 h sem degradar SLO; restore completo em ambiente limpo.

---

## 8. H5 — pt-BR, landing, MCP, white-label, API (semanas 32–38)

| Épico | Entrega |
|---|---|
| E5.1 | `DEFAULT_LOCALE='pt-BR'`; **landing traduzida**; textos renderizados revisados; EN/IT como fallback |
| E5.2 | `content-locale` pt-BR para tudo que a IA escreve; vocabulário proibido no portal |
| E5.3 | **MCP**: servidor com token por tenant, ferramentas read-only, rate limit, auditoria; **documento «O que é MCP» em linguagem simples** |
| E5.4 | White-label: domínio, logo, cor, remetente SPF/DKIM por tenant |
| E5.5 | API REST read-only + OpenAPI (evolução natural do MCP) |
| E5.6 | Modo avançado completo no portal: séries, proveniência, drill-down, comparativo entre os 2 alvos |
| E5.7 | Embeddings/busca semântica **opcional** por entitlement |

**Critérios de saída:** zero string em EN/IT visível no fluxo principal pt-BR; assistente externo consulta reputação via MCP com token de um tenant e **não** enxerga outro.

---

## 9. H6 — Docker + Traefik e operação contínua (semanas 39–44, contínuo)

| Épico | Entrega |
|---|---|
| E6.1 | Compose de produção: `traefik`, `web`, `scheduler`, 3 workers, `postgres`, `redis`, storage |
| E6.2 | TLS automático, roteamento por domínio white-label, rate limit de borda, headers |
| E6.3 | CI/CD: migrate → workers → web rolling → health check → rollback automático |
| E6.4 | Ambientes `local / staging / production` com dados sintéticos/anonimizados |
| E6.5 | SLOs, alertas de operação, on-call leve, backups + PITR testados |
| E6.6 | Inventário de subprocessadores e DPA; relatório de conformidade LGPD |
| E6.7 | Catálogo de ADRs e revisão trimestral de arquitetura |

> **Nota:** na prática o compose de staging nasce no **H0** (E0.10). O H6 é a **promoção para produção**, não o primeiro contêiner.

---

## 10. Governança

### 10.1 Definition of Done (vale para todo épico)

1. `lint` + `tsc` + testes unitários + **adversariais** + build verdes.
2. Critério funcional demonstrado com dados controlados.
3. Tela validada visualmente nos **dois modos** (básico/avançado) e nos papéis aplicáveis.
4. Toda ação de escrita registrada em `audit_events`.
5. Custo de IA medido e atribuído a um tenant.
6. Classificação honesta: **APROVADO / REPROVADO / PENDENTE / NÃO TESTADO** — nunca «aprovado porque compila».

### 10.2 Ritos

| Rito | Frequência | Saída |
|---|---|---|
| Revisão de horizonte | 4 semanas | Ajuste de escopo + ADR novo se houver mudança |
| Red team | A cada release | Evidência arquivada dos 10 ataques |
| Revisão de custos | Mensal | Margem por cliente, provedores LLM, cotas |
| Revisão de ADRs | Trimestral | Decisões supersedidas marcadas, nunca apagadas |
| Restore test | Trimestral | Prova de que o backup serve |

### 10.3 Papéis (mesmo sendo time pequeno)

| Papel | Responsabilidade |
|---|---|
| **Dono (você)** | Produto, contratos, decisão jurídica, overrides comerciais |
| Arquiteto | ADRs, fronteiras, isolamento, custo |
| Backend | Domínio, fila, LLM registry, billing |
| Frontend | Três superfícies, dois eixos de visualização, pt-BR |
| SRE/Devops | Compose, Traefik, CI/CD, observabilidade |
| QA adversarial | Suíte A1–A10, red team |

---

## 11. Métricas de sucesso

| Tipo | Métrica | Alvo H6 |
|---|---|---|
| **Produto** | Tempo até o cliente responder «estou bem? / tem crise?» | < 30 s sem ajuda |
| **Produto** | Clientes que usam o modo avançado | 20–40% (sinal de valor percebido) |
| **Confiança** | Falsos positivos de crise | < 3 / mês / 100 tenants |
| **Técnica** | SLA de detecção | ≤ 5 min |
| **Técnica** | Incidentes de isolamento | **0** |
| **Negócio** | Margem por cliente | > 85% após IA e infra |
| **Negócio** | Inadimplência (Pix) | < 3% |
| **Operação** | Restore testado | 100% dos trimestres |

---

## 12. Épicos priorizados (backlog único)

| # | Épico | Horizonte |
|---|---|---|
| 1 | Isolamento + RLS + `TenantContext` | H0 |
| 2 | LLM Registry OpenAI-compatible | H0 |
| 3 | Entitlements | H0 |
| 4 | Modo básico/avançado + 3 superfícies | H0 |
| 5 | Cliente piloto ponta a ponta | H0 |
| 6 | Suíte adversarial A1–A10 | H1 |
| 7 | Migrações + chave de criptografia + auditoria | H1 |
| 8 | Planos + Meu plano + Avisos | H2 |
| 9 | Gate jurídico AGPL | H2 |
| 10 | Stripe + Pix + dunning | H3 |
| 11 | Fila, particionamento, cache, réplicas | H4 |
| 12 | pt-BR + landing + MCP + white-label | H5 |
| 13 | Docker + Traefik em produção | H6 |

---

## 13. Anti-metas (o que **não** fazer)

- Não transformar em microsserviços de domínio «porque é grande escala» (ADR-01).
- Não criar uma quinta aba no menu do cliente para cada feature nova (R11).
- Não deixar o modo avançado conceder permissões (ADR-03).
- Não confiar em `tenant_id` vindo do cliente (ADR-02).
- Não cobrar antes de resolver AGPL (gate do H2).
- Não perseguir 150 M de fontes com crawling próprio — o diferencial é transparência, custo e IA verificável.
- Não traduzir **dados coletados**; traduzir apenas interface e conteúdo gerado.

---

## 14. Estado atual desta entrega

> **Revisão 1.1 — correção de honestidade.** A versão 1.0 marcava o protótipo v3
> e a fundação como «entregues» antes de existirem. Ambos foram **implementados de
> fato** nesta revisão; a tabela abaixo reflete o que foi **executado e medido**,
> não o que estava planejado.

| Artefato | Status | Evidência |
|---|---|---|
| `vigiaplus-arquitetura.md` (SAD v1.0) | ✅ entregue | 15 seções, 13 ADRs, C4, modelo de dados, RLS, A1–A10 no §12 |
| `vigiaplus-roadmap.md` (este, v1.1) | ✅ entregue | H0–H6, DoD, governança, anti-metas, esta tabela corrigida |
| `vigia-prototipo.html` **v3** | ✅ entregue e validado | 6 abas · **18 áreas** no console · 4 subáreas em «Minha conta» · **2 eixos independentes** · 4 blocos de densidade avançada · 611/611 `<div>` balanceadas · 93 KB |
| `vigiaplus/` **fundação executável** | ✅ entregue e testada | 22 arquivos · **38/38 testes verdes** (19 unitários + 19 adversariais) · `npm run demo` OK · servidor HTTP OK · **imagem Docker construída** e contêiner respondeu `/health` |
| `deploy/` Docker + Traefik | ✅ entregue e validado | 3 YAML parseados · `docker compose config` OK · `docker build` OK · smoke test do contêiner OK |
| Commit local + `vigiaplus.bundle` | ✅ pronto | ramo `main`, 27 arquivos (inclui `docs/` com SAD, roadmap e protótipo), bundle portável em `/workspace/` |
| Repositório `OARANHA/vigiaplus` | ⏳ **push pendente** | `gh auth status` sem autenticação neste ambiente. O repo remoto está vazio; nenhum push foi feito |
| Importação dos 245 testes e 64 páginas de `crises` | ⏳ **H0, não iniciado** | A fundação é código **novo e isolado**; ainda não deriva de `crises`. Aguarda aprovação do SAD |
| Gate jurídico AGPL-3.0 | ⏳ **aberto** | `vigiaplus/NOTICE.md` registra a decisão pendente antes de qualquer cobrança |

### 14.1 O que a fundação **prova** hoje

| Requisito seu | Onde está provado |
|---|---|
| Todas as páginas ao meu alcance | `catalog.js` → `ANALYST_PAGES` + rota `/api/analyst/pages`; protótipo `c-analista` |
| Três superfícies separadas | `requireSurface()` + rotas `/api/app`, `/api/console`, `/api/analyst` |
| Cuidado com as separações | `context.js`, `store.js`, testes A1/A2/A3 |
| Modo básico e avançado | `permissionsFingerprint()` e teste A4 — modo **não** altera permissão |
| Qualquer LLM compatível com OpenAI | `llm-registry.js` + `POST /api/console/llm-providers` (Groq cadastrado via HTTP sem deploy) |
| Habilitar/desabilitar por cliente ou contrato | `entitlements.js` + `PATCH /api/console/tenants/:id/features` |
| MCP ajuda (explicado sem jargão) | protótipo `c-mcp` («tomada padrão») + `mcp_tokens` no seed + SAD ADR-06 |
| Testar uma → teste adversarial | `scripts/demo.js` + `tests/adversarial.test.js` (A1–A10) |
| Planos e área do cliente de plano/aviso | `catalog.js`/`entitlements.js` + protótipo `s-plano` e `s-avisos` |
| Stripe e/ou Pix no admin | `payments.js` (adaptadores + webhook idempotente) + protótipo `c-pagamentos` |
| Cliente entende de imediato, mas vê valor | `/api/app/summary` devolve 2 reputações + «24 fontes · 1.240 comentários · 11 min» |
| «Às vezes o pouco é muito» | Cliente continua com **4 abas**; plano e avisos ficam **dentro** de «Minha conta» |
| Landing em português depois | Épico E5.1 (H5) — registrado, não iniciado |
| Docker + Traefik no fim | Compose de staging nasce no H0 (E0.10) e já existe; promoção para produção é H6 |

### 14.2 Classificação honesta

| Item | Classificação |
|---|---|
| Isolamento entre tenants (A1–A3) | **APROVADO** — 3 vetores testados e bloqueados |
| Modo não escala privilégio (A4) | **APROVADO** — fingerprint idêntico nos dois modos |
| Entitlements (A5) | **APROVADO** |
| Defesas de LLM (A6/A7/A9) | **APROVADO** — inclui DNS rebinding e cota antes do fetch |
| Webhook idempotente (A8) | **APROVADO** |
| Auditoria de impersonação (A10) | **APROVADO** |
| Banco Postgres com RLS real | **NÃO TESTADO** — store em memória; é o E1.2 |
| Migrações versionadas | **PENDENTE** — E1.8 |
| UI em pt-BR integrada ao Next.js | **PENDENTE** — H5; hoje existe protótipo HTML |
| Push para o GitHub | **PENDENTE** — sem credenciais no ambiente |
| Conformidade AGPL/LGPD | **PENDENTE** — gate antes de cobrar |

> Nada acima é «aprovado porque compila». Cada linha **APROVADO** tem um teste
> executado com `node --test` nesta entrega.
