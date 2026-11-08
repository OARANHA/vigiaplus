# `crises` (Radar Intelligence) — Análise de arquitetura, código e aderência ao produto

> **Objeto analisado:** `https://github.com/OARANHA/crises.git` (branch `main`, commit único `875aac3`)
> **Cenário desejado:** *você faz login → cadastra seus clientes → cada cliente faz login → vê informações de «duas reputações» e de gestão de crises*
> **Método:** clone completo do repositório + leitura de código + execução local de `lint`, `tsc`, `test` e `build`

---

## 0. O que eu fiz (passo a passo)

1. Clonei o repositório e mapeei a árvore: **437 arquivos**, ~**51.600 linhas** de TypeScript/TSX.
2. Li os arquivos de configuração e documentação: `package.json`, `.env.example`, `next.config.ts`, `proxy.ts`, `README.md`, `docs/roadmap.md`, `docs/progress.md`, `docs/research/gap-analysis.md`, `docs/architecture/target-architecture.md`, `.github/workflows/ci.yml`, `LICENSE`.
3. Li o núcleo de dados e segurança: `lib/db/schema.ts`, `lib/db/index.ts`, `lib/auth.ts`, `lib/session.ts`, `lib/session-auth.ts`, `lib/api-guard.ts`, `lib/project-access.ts`, `lib/data.ts`, `lib/connector-credentials.ts`, `lib/password.ts`, `lib/alerts.ts`, `lib/insights.ts`, `lib/pipeline.ts`.
4. Li as rotas e páginas relevantes: `app/api/auth/route.ts`, `app/team/actions.ts`, `app/settings/actions.ts`, `app/api/import/files/route.ts`, `app/api/playbook/route.ts`, `app/api/compare/route.ts`, `app/layout.tsx`, `lib/nav.ts`, `app/insights/health/page.tsx`, `app/insights/crisis/page.tsx`, `app/share/[token]/page.tsx`.
5. Instalei as dependências (`npm ci`) e **executei de verdade** a validação: lint, type-check, os 245 testes e o build de produção.
6. Cruzei o que a **documentação promete** com o que o **código realmente implementa** — foi aí que apareceu o achado principal.
7. Escrevi este relatório com os achados, os riscos concretos (arquivo:linha) e um plano de ação priorizado.

---

## 1. Resultado da validação local

| Verificação | Resultado |
|---|---|
| `npm run lint` | **0 erros** / 44 avisos (variáveis não usadas, um `react-hooks/immutability`) |
| `npx tsc --noEmit` | **0 erros** |
| `npm test` | **245 / 245 testes passando** (23 arquivos, 26,5 s) |
| `npm run build` | **OK** (64 páginas dinâmicas + Proxy) |
| CI | `.github/workflows/ci.yml` roda lint → tsc → test → build |

**Escala do projeto:** 64 páginas, 52 rotas de API, 66 componentes, 115 módulos em `lib/`, 28 conectores de fontes de dados.

---

## 2. Conclusão em uma frase

**O código é muito bom e a arquitetura é adequada para uma ferramenta de social listening self-hosted / de instância única — mas ela NÃO é, e não pode ser usada diretamente como, um SaaS multi-cliente.**

O que você descreveu (você administra clientes, cada cliente loga e só vê os próprios dados) é **multi-tenancy**. E o próprio repositório já diagnosticou isso: `docs/roadmap.md` lista o **«Incremento 5 — Multi-tenancy (P0 estrutural, maior esforço)»** e `docs/architecture/target-architecture.md §2.1` já desenha o modelo `Organization → Workspace → Project + membership/RBAC/audit log`. **Só que nada disso está implementado no código.**

Ou seja: a ideia está certa, o diagnóstico do repo está certo — falta a camada mais importante. E, enquanto ela não existir, colocar clientes reais ali gera **vazamento de dados entre clientes** (§4).

---

## 3. O que está bom (e deve ser preservado)

| Aspecto | Evidência |
|---|---|
| Stack moderna e coerente | Next.js 16 App Router + React 19 + TypeScript + Drizzle; `next.config.ts` configura corretamente `serverExternalPackages` para PGlite/pdfkit/MCP |
| Banco portátil | `lib/db/index.ts`: com `DATABASE_URL` usa Neon HTTP; sem ela, PGlite embutido — mesma API de query |
| Schema bem modelado | `lib/db/schema.ts`: 25+ tabelas, `project_id` com FK e `ON DELETE CASCADE`, índices (`mentions_proj_pub`, GIN em `query_ids`), comentários explicando **por que** e não só **o quê** |
| Segurança já auditada a sério | `lib/session.ts`: cookie HMAC + `sessionVersion` revogável; `lib/session-auth.ts` / `lib/api-guard.ts`: cada rota valida **assinatura + existência do usuário + versão no banco**, sem depender só do middleware; `proxy.ts` é só pré-filtro; `CRON_SECRET` fail-closed; `SESSION_SECRET` obrigatório e independente da senha; comparação timing-safe; `DEMO_MODE` somente leitura; credenciais cifradas com AES-256-GCM |
| Cultura de testes e evidência | 245 testes unitários + 13 de integração com banco isolado + 27 verificações E2E em build de produção; `docs/progress.md` registra honestamente «testado / não testado» |
| Coleta plugável | `lib/connectors/` com 28 fontes, BYOK (traga sua própria chave), `lib/ai-provider.ts` com Claude/OpenAI/Grok/Azure, `api_usage` com teto mensal de gasto |
| Anti-alucinação e conformidade | POV com fact-pack, citações validadas, `cannot_say`, exportações com disclosure de IA (AI Act) |
| Documentação | README de 38 KB + roadmap + gap-analysis + arquitetura-alvo + progresso + screenshots — nível raro em open source |
| Internacionalização | `lib/i18n.ts` suporta `en / it / pt` (pt-BR já incluído) — vantagem pronta para clientes brasileiros |

**Veredito arquitetural:** o ADR-1 do próprio repositório (manter **monolito modular Next.js**, sem microsserviços) está **correto**. Time pequeno, deploy único, nenhum gargalo comprovado. Não transforme em microsserviços só porque virou SaaS.

---

## 4. O problema central: o modelo de permissão atual ≠ multi-cliente

### 4.1 Como é hoje

```
users.role         : 'admin' | 'member'        (binário e global)
projects.ownerId   : integer
projects.visibility: 'private' | 'shared'
projeto ativo      : cookie `sr_project`
```

`lib/project-access.ts:18`:

```ts
const cond = or(eq(projects.ownerId, user.id), eq(projects.visibility, 'shared'));
if (user.role === 'admin') return db.select().from(projects).orderBy(projects.id);
```

### 4.2 O que acontece no SEU cenário

| # | Risco | Onde |
|---|---|---|
| 1 | **Qualquer `member` vê TODOS os projetos marcados `shared`.** Você marca «shared» para o cliente enxergar e o cliente A passa a ver menções, sentimentos, relatórios e comentários do cliente B | `lib/project-access.ts:18`; `app/settings/page.tsx:216,344,412` |
| 2 | **`admin` é global** — não existe «administrador do cliente X». Dar admin a um cliente = dar o banco inteiro | `lib/auth.ts:32`; `lib/api-guard.ts:74` |
| 3 | **`projectId` vindo do cliente sem validação de tenant**: `?project=` / `body.projectId` entram direto na query; hoje só se checa `isAdmin`. Num SaaS isso vira IDOR cross-tenant | `app/api/import/files/route.ts:17-25,29,38,99`; `app/api/import/normalized/route.ts:61,87`; `app/import/page.tsx:18` |
| 4 | **Chaves de API globais por instância** (o comentário do código diz exatamente isso). Todos os clientes consomem a mesma chave, o mesmo token Talkwalker, a mesma cota — impossível isolar ou cobrar por cliente | `lib/connector-credentials.ts:7,97` |
| 5 | **Custo sem dono**: `api_usage` não tem `project_id`/`tenant_id` e `API_BUDGET_USD` é um teto único. Um cliente pode queimar o orçamento de todos | `lib/db/schema.ts:180` |
| 6 | **Cron global e serial**: `vercel.json` roda 05:00 e 07:00; `lib/pipeline.ts:70-74` faz `for (const project of allProjects)` sequencial dentro de uma requisição com `maxDuration = 300`. Com vários clientes estoura o tempo; e **crise só é detectada 1× por dia — até 24 h de atraso** | `vercel.json`; `app/api/cron/daily/route.ts`; `lib/pipeline.ts:54-74` |
| 7 | **Sem trilha de auditoria**: login, exportação, exclusão de projeto, troca de chave — nada é registrado | ausente em todo o projeto (o roadmap também lista como pendente) |
| 8 | **Onboarding manual**: o admin preenche nome/e-mail, o sistema gera uma senha temporária **exibida na tela** e você precisa enviá-la por fora. Sem e-mail de convite, sem redefinição self-service, sem 2FA, sem termos/consentimento | `app/team/actions.ts:30-60` |
| 9 | **Login sem rate limiting**: só um `setTimeout(400)` fixo, sem contagem de falhas por IP/conta nem bloqueio. Exposto à internet, continua vulnerável a força bruta | `app/api/auth/route.ts:48-62` |
| 10 | **Acoplamento de segredos (risco de perda silenciosa)**: a chave AES é derivada de `SESSION_SECRET` (`lib/connector-credentials.ts:101`), e a própria documentação recomenda rotacionar esse segredo. Ao rotacionar, o `decrypt` falha, o `catch` engole o erro e devolve `{}` — **todas as chaves salvas pela UI desaparecem sem aviso** | `lib/connector-credentials.ts:100-130` |
| 11 | **Sem migrações versionadas**: não há `drizzle.config` nem pasta `migrations`; `lib/db/index.ts` executa **91 comandos DDL** (`CREATE/ALTER ... IF NOT EXISTS`) + seed **a cada inicialização**. Funciona em instância única; com múltiplos cold starts concorrentes fica arriscado e sem rollback | `lib/db/index.ts:48-450` |
| 12 | **Busca que degrada com volume**: `ILIKE '%termo%'` em `content`, `title` e `article_text` sem índice `pg_trgm`/`tsvector` | `lib/data.ts:140-152` (e `benchmarkData`) |
| 13 | **Nenhum teste de isolamento entre tenants** em `tests/` | `tests/` |
| 14 | **⚠️ Licença AGPL-3.0** confirmada em `LICENSE`. Oferecer como serviço hospedado aciona a cláusula de rede (§13): é preciso disponibilizar o código das modificações aos usuários. O próprio `docs/architecture/target-architecture.md §4` marca «revisão jurídica pendente / dual-licensing». Além disso, este repo é uma **importação em commit único** de `Scognamiglio1969/radar-intelligence`, sem histórico upstream — confirme titularidade e autorização antes de comercializar | `LICENSE`, `CONTRIBUTING.md:9`, `app/layout.tsx:50` |

### 4.3 Dívidas de estrutura

- **Domínio acoplado ao transporte:** as 64 páginas chamam `getDb()`/`lib/data.ts` diretamente, e `lib/data.ts`/`lib/auth.ts` importam `cookies` de `next/headers`. Os próprios comentários admitem que foi preciso criar cópias «sem `next/headers`» (`lib/project-access.ts`, `lib/session-auth.ts`) para conseguir testar. Num multi-tenant, o contexto do tenant precisa ser **injetado**, não lido de cookie em 64 lugares — essa é a refatoração que precisa vir primeiro.
- **Superfície grande demais:** Sport, Wikipedia, Clinical Trials, Podcast, TV/War Room, Galaxy 3D, MCP, 16 visualizações de insights. Para um cliente que só quer reputação e crise, é ruído e aumento de superfície de ataque. Vale desligar por feature flag.
- **Commit único, sem histórico Git** em 51 mil linhas: rastreabilidade ruim.

---

## 5. Aderência ao produto: «duas reputações» + «gestão de crises»

Boa notícia: **os ingredientes já existem — falta transformá-los em produto que o cliente entenda.**

| Sua necessidade | Estado atual | Avaliação |
|---|---|---|
| **Reputação ① e ②** | `app/insights/health/page.tsx` + `lib/insights.ts:862` já calculam **dois índices 0–100**: `Market Health` (o tema/mercado inteiro) e `Brand Health` (sua marca vs. mercado e concorrentes). Pesos: sentimento 35%, share positivo 25%, momentum 20%, ressonância 20%. Deriva de `benchmarkEntities.isOwnBrand` | ✅ Se «duas reputações» = **marca vs. mercado**, já está pronto; só está escondido no meio de 16 visualizações |
| Outros insumos de reputação | `/reviews` (App Store, Google Places, Yelp), `/benchmark` (Share of Voice), `/kpi` (NSS/SOE), `/pov` | ✅ Farto |
| Se «duas reputações» = **duas empresas/marcas distintas** | Hoje só dá para criar dois `projects` e alternar por cookie. O `/api/compare` compara **7 dias vs. 7 dias anteriores do mesmo projeto**, não dois projetos | ❌ Falta uma visão comparativa entre projetos |
| **Detecção de crise** | `/alerts` detecta volume 24 h > 2,5× a baseline e queda de sentimento > 0,25; `/insights/crisis` faz anatomia do pico + previsão; `/api/playbook` gera manual de crise com IA (avaliação, quem puxa a conversa, 3 opções de resposta, minuta de nota, ações para 24 h); `/tv` War Room; timeline; push Telegram | ✅ Detecção e recomendação estão completas |
| **Gestão** de crise | Não existe ciclo de vida do incidente (aberto / em tratamento / encerrado), responsável, SLA, aprovação de resposta, log de ações, notificação por e-mail/Slack, relatório pós-crise. `alerts` é só uma tabela de log gerada automaticamente | ❌ Hoje é **monitoramento + relatório**, não **fluxo de tratamento** |
| **Entrada do cliente** | `lib/nav.ts` tem 30+ itens em 5 seções; várias páginas são admin-only, mas continuam no menu; `/share/[token]` é uma página read-only sem login (se o token vazar, vaza o dados; sem vínculo com usuário) | ❌ Recomenda-se um **portal do cliente separado**, em vez de entregar o cockpit inteiro |

---

## 6. Plano de ação sugerido (priorizado)

### P0 — antes de colocar o primeiro cliente real

1. **Implementar o modelo de tenant** já desenhado no repo: `organizations → workspaces → projects` e `memberships(user, workspace, role: owner/admin/analyst/viewer)`. Adicionar `workspace_id` (FK + índice) em **todas** as tabelas de dados e **abandonar** `visibility='shared'` como mecanismo de compartilhamento entre clientes.
2. **Centralizar o contexto do tenant**: uma função `getWorkspaceContext()` (sessão → workspace) pela qual **toda** query passa; proibir qualquer `db.select().from(mentions)` sem filtro de workspace. Criar `tests/tenant-isolation.test.ts`: *o tenant A nunca lê dados do B por nenhuma rota* — é exatamente o critério de aceitação do Incremento 5.
3. **Corrigir as entradas que recebem `projectId` do cliente**: validar «este projeto pertence ao workspace atual», não apenas `isAdmin` (arquivos listados em §4.2 #3).
4. **RBAC declarativo**: trocar os `isAdmin()` espalhados por `can(user, 'projects:write', workspace)`; renderizar o menu por papel.
5. **Fechar o ciclo de onboarding**: convite por e-mail + token de ativação de uso único + troca obrigatória de senha + redefinição self-service + 2FA opcional + rate limit no login (Upstash/Redis ou contador no banco) + tabela `audit_events` registrando alterações e exportações.
6. **Resolver a questão jurídica antes**: confirmar as obrigações do AGPL-3.0 em SaaS ou negociar licença comercial com o upstream. Sem isso, qualquer comercialização fica com risco.
7. **Separar a chave de criptografia**: criar `CREDENTIALS_ENC_KEY` independente (com versionamento/anel de chaves); falha de descriptografia deve **gerar erro**, não retornar `{}` silenciosamente.

### P1 — para o produto existir de fato

8. **Credenciais e cotas por tenant**: `connector_credentials` com `workspace_id`; `api_usage` com `workspace_id`; orçamento, volume de menções e chamadas de IA medidos por cliente.
9. **Agendamento por tenant**: fila de jobs com retry/dead-letter em vez do cron global serial; fontes ligadas a crise em cadência horária; alertas por e-mail/Slack/webhook (hoje só Telegram).
10. **Portal do cliente** (3–4 telas, white-label opcional): `① Reputação` (Market vs. Brand + avaliações + SOV + tendência), `② Crises` (alertas/incidentes, severidade, playbook de IA, status de tratamento), `③ Relatórios` (assinatura de PDF/XLSX), `④ Minha conta`. Ocultar Setup / Queries / Import / MCP / Settings por papel.
11. **Fluxo de incidente**: tabelas `incidents` (status, severity, owner, opened_at, closed_at, resolution) e `incident_actions`, ligando `alerts` a incidentes, com aprovação da minuta de resposta e relatório pós-crise.
12. **Migrações versionadas** com `drizzle-kit`, removendo os 91 DDL do boot; `ensureSchema` fica só para o PGlite de desenvolvimento.

### P2 — escala

13. `pg_trgm` GIN / `tsvector` no lugar do ILIKE; retenção configurável com exportação antes do descarte (já é P0 pendente no roadmap); API REST read-only + OpenAPI (Incremento 4); faturamento e domínio próprio por cliente.

---

## 7. Quatro perguntas para você

1. **«Duas reputações» significa** `Brand Health` vs `Market Health` (já implementado, basta empacotar) **ou duas empresas/marcas diferentes** (exige comparação entre projetos)?
2. **As chaves de API são dos clientes (BYOK) ou suas, centralizadas?** Isso muda o desenho de isolamento e de custo.
3. **Precisa de white-label / domínio próprio por cliente?** Afeta branding e configuração de cookies.
4. **Vai comercializar para fora ou é uso interno?** Define o caminho de conformidade com o AGPL-3.0.

---

## 8. Avaliação final

| Dimensão | Nota | Comentário |
|---|---|---|
| Qualidade de código / engenharia | **A** | Validação real toda verde; testes e documentação acima da média |
| Arquitetura para instância única | **A-** | Monolito modular é a escolha certa; DDL manual e acoplamento com `next/headers` são as dívidas |
| Segurança (instância única) | **A-** | Já passou por auditoria P0; faltam rate limit e chave de criptografia independente |
| Segurança (multi-cliente) | **D** | `shared` + admin global + credenciais globais = vazamento entre clientes |
| Aderência ao seu produto | **C+** | Os «dois índices de reputação» e a detecção/playbook de crise existem; faltam isolamento, portal do cliente e fluxo de tratamento |

**Recomendação: não reescreva.** Mantenha o monolito Next.js e o núcleo de coleta/análise (é a parte mais valiosa), acrescente a camada de tenants conforme o Incremento 5 que o próprio repo já especificou e, por cima, um portal enxuto para o cliente. É bem mais rápido do que recomeçar — e infinitamente mais seguro do que «criar um usuário `member` para cada cliente» na estrutura atual.
