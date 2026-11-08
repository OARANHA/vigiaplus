# VigiaPlus — fundação executável (H0)

> **O que é:** um núcleo **runnable e testável** que prova as fronteiras de arquitetura
> antes de qualquer tela: isolamento por tenant, RBAC, entitlements por contrato,
> registro dinâmico de LLMs OpenAI-compatible, webhooks idempotentes e auditoria.
>
> **O que NÃO é:** ainda não é o produto. Não contém código de `OARANHA/crises`,
> não tem banco real, não tem UI em Next.js. É o **alicerce** sobre o qual o H0
> importa o Radar existente sem reescrevê-lo.
>
> Documentação completa em `docs/` (SAD, roadmap, protótipo navegável, análise
> do `crises` e dossiê de remodelagem) — o repositório é autocontido.
>
> **Dependências externas: zero.** Só módulos built-in do Node ≥ 20.

---

## 1. Rodar em 30 segundos

```bash
cd vigiaplus
npm test              # unitários + suíte adversarial A1–A10
npm run demo          # roteiro comentado: "testar uma cliente" ponta a ponta
npm start             # sobe o servidor em http://localhost:3000
```

Sem `npm install`. Sem `.env` obrigatório para testar.

```bash
curl -s localhost:3000/health | jq

curl -s localhost:3000/api/app/summary \
  -H 'x-vigia-session: s-aurora-admin' | jq

curl -s localhost:3000/api/me/permissions \
  -H 'x-vigia-session: s-aurora-view' \
  -H 'x-view-density: avancado' | jq
```

**Sessões de demonstração** (resolvidas no servidor, nunca enviadas pelo cliente):

| Token | Papel | Tenant |
|---|---|---|
| `s-owner` | owner | carteira (system) |
| `s-analyst` | analyst | 1 |
| `s-aurora-admin` | client_admin | 1 · Aurora Mobility |
| `s-aurora-view` | client_viewer | 1 |
| `s-boreal-admin` | client_admin | 2 · Grupo Boreal |

---

## 2. Documentação (`docs/`)

| Arquivo | Conteúdo |
|---|---|
| `vigiaplus-arquitetura.md` | SAD v1.0 — C4, 13 ADRs, modelo de dados, RLS, §12 com A1–A10 |
| `vigiaplus-roadmap.md` | Planejamento H0–H6, DoD, governança e status real medido (§14) |
| `prototipo-v3.html` | Protótipo navegável: 3 superfícies, 18 áreas no console, 2 eixos |
| `analise-crises-pt.md` | Revisão de código/arquitetura do `OARANHA/crises` |
| `remodelagem.md` | Dossiê de produto e engenharia do Vigia |

---

## 3. Mapa do código

| Arquivo | Responsabilidade | Decisão do SAD |
|---|---|---|
| `src/errors.js` | Erros tipados, `code` estável | — |
| `src/catalog.js` | Papéis, superfícies, features, planos, 64 páginas | ADR-03, ADR-04, ADR-13 |
| `src/store.js` | Store escopado + seeds | ADR-02 (`tenant_id` + RLS futura) |
| `src/context.js` | `TenantContext` — tenant vem da **sessão** | ADR-02 |
| `src/rbac.js` | `can()`, `requireSurface()`, `requireAction()` | ADR-03 |
| `src/entitlements.js` | `requireFeature()`, overrides por contrato | ADR-04 |
| `src/audit.js` | Trilha imutável, somente acréscimo | ADR-11, LGPD |
| `src/llm-registry.js` | Qualquer LLM OpenAI-compatible + SSRF/injeção/cota | ADR-05 |
| `src/payments.js` | Gateway abstrato, Stripe/Pix, webhook idempotente | ADR-07 |
| `src/server.js` | `node:http` com as três superfícies | ADR-01, ADR-13 |
| `tests/adversarial.test.js` | **A1–A10, gate de CI** | ADR-11 |

**Fluxo obrigatório de toda rota:**
`resolveContext → requireSurface → requireAction → requireFeature → store escopado → audit`.
Nenhuma etapa é opcional e nenhuma confia em dado do request.

---

## 4. Três superfícies

| Superfície | Quem | Onde |
|---|---|---|
| `/app` | `client_admin`, `client_viewer` | `src/server.js` · rotas `/api/app/*` |
| `/console` | `owner` | rotas `/api/console/*` |
| `/analyst` | `owner`, `analyst` | rotas `/api/analyst/*` + `ANALYST_PAGES` |

O modo **básico/avançado** e o **vocabulário** são preferências em cabeçalhos
(`x-view-density`, `x-view-vocabulary`). `src/rbac.js` **não os lê** — o teste A4
compara o fingerprint de permissões nos dois modos. Isso é o que impede o
"modo avançado" de virar escalonamento de privilégio.

---

## 5. Cadastrar qualquer LLM sem editar código

O problema original estava em `lib/ai-provider.ts` do `crises`:

```ts
export type AiProviderId = 'anthropic' | 'openai' | 'grok' | 'azure';
export const AI_PROVIDERS: Record<AiProviderId, AiProviderDef> = { /* hardcoded */ };
```

Aqui, provedor é **linha no banco**:

```bash
curl -s -X POST localhost:3000/api/console/llm-providers \
  -H 'x-vigia-session: s-owner' -H 'content-type: application/json' \
  -d '{
    "name":"Groq Cloud",
    "base_url":"https://api.groq.com/openai/v1",
    "model":"llama-3.3-70b-versatile",
    "api_key_ref":"ENV:GROQ_API_KEY"
  }'
```

Funciona com OpenAI, Azure, OpenRouter, Groq, DeepSeek, Together, Fireworks,
vLLM, Ollama, LM Studio — qualquer endpoint `/chat/completions`.

Regras que não são negociáveis:

- A **chave nunca é gravada**: só `ENV:NOME_DA_VARIAVEL`. Enviar `api_key` em
  texto claro é `400 BAD_REQUEST`.
- `base_url` passa por validação SSRF (esquema, host privado, metadata da nuvem,
  credenciais embutidas, DNS rebinding).
- O **system prompt é imutável** e o conteúdo coletado entra delimitado como
  `<dados_coletados confiabilidade="nao_confiavel">` — dado, nunca instrução.
- A **cota por tenant é verificada antes** do fetch. Custo imputado ao tenant.
- Ollama local exige dois flags explícitos de dev (`VIGIA_ALLOW_INSECURE_LLM`,
  `VIGIA_ALLOW_PRIVATE_LLM`), **desligados por padrão**.

---

## 6. Suíte adversarial A1–A10

| # | Ataque | Defesa | Onde |
|---|---|---|---|
| A1 | `tenant_id` forjado em header/query/body | Tenant vem só da sessão; payload é sobrescrito; tentativa auditada | `context.js`, `store.js` |
| A2 | Query sem `WHERE tenant_id` | `store.all()` lança `TENANT_SCOPE_REQUIRED` | `store.js` |
| A3 | ID de recurso de outro tenant (IDOR) | `find()` devolve `null` → **404**, não 403 | `store.js`, `server.js` |
| A4 | Modo avançado para escalar privilégio | RBAC não lê `density`/`vocabulary` | `rbac.js` |
| A5 | Recurso desabilitado por contrato | `requireFeature()` → `403 FEATURE_DISABLED` | `entitlements.js` |
| A6 | Prompt injection no conteúdo coletado | System imutável + delimitação + sanitização | `llm-registry.js` |
| A7 | SSRF via `base_url` de LLM | Validação + DNS rebinding | `llm-registry.js` |
| A8 | Replay de webhook de pagamento | `payment_events` com chave de idempotência | `payments.js` |
| A9 | Estouro de cota de IA | `checkQuota()` antes do fetch | `llm-registry.js` |
| A10 | Impersonação sem auditoria | Motivo obrigatório + `audit_events` | `context.js` |

```bash
npm run test:adversarial
```

> **Gate de CI (roadmap E1.1):** o pipeline deve falhar se esta suíte for
> removida ou se qualquer vetor deixar de passar. Não é "aprovado porque compila".

---

## 7. Docker + Traefik

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
export CREDENTIALS_ENC_KEY_V1=$(openssl rand -hex 32)
export VIGIA_WEBHOOK_SECRET=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -hex 16)

docker compose -f deploy/docker-compose.yml up --build
curl -k https://vigiaplus.localhost/health
```

O compose sobe **apenas o que existe**: `traefik`, `web`, `postgres`, `redis`.
`worker-ingest` / `worker-ai` / `worker-notify` / `scheduler` estão **comentados**
com a referência ao épico que os implementa — declarar contêiner vazio seria
fingir que o H4 está pronto.

Antes de produção: trocar domínio e `ACME_EMAIL` em
`deploy/traefik/traefik.yml`, revisar allowlist de IP para `/console`,
e **resolver o gate AGPL** (`NOTICE.md`).

---

## 8. Repositório publicado

O código **já está no GitHub**: <https://github.com/OARANHA/vigiaplus>, ramo `main`.

O push foi feito com um token pessoal **temporário** fornecido pelo dono, usado
apenas em memória: não foi gravado em `.git/config`, em arquivo ou em log. O
remote ficou com a URL limpa, sem credencial embutida.

```bash
git remote -v
# origin  https://github.com/OARANHA/vigiaplus.git (fetch)
# origin  https://github.com/OARANHA/vigiaplus.git (push)

git status   # working tree limpo; main sincronizada com origin/main
```

Para os próximos pushes, configure sua própria credencial (PAT, chave SSH ou
`gh auth login`). **Não reutilize o token temporário: revogue-o** em
<https://github.com/settings/tokens> assim que conferir esta entrega.

O `vigiaplus.bundle` em `/workspace/` permanece como cópia offline do histórico.

---

## 9. Limites honestos (o que falta para H1)

| Limite | Próximo passo |
|---|---|
| Store em memória, sem RLS real | `SET LOCAL app.tenant_id` + policies no Postgres (E1.2) |
| Sem migrações versionadas | drizzle-kit; remover os 91 DDL do boot (E1.8) |
| Sessão de demonstração em texto claro | Sessão assinada + versionada + 2FA + rate limit (E1.5) |
| `SESSION_SECRET` ainda não usado como chave de credenciais | `CREDENTIALS_ENC_KEY_V1` independente (E1.7) |
| Adaptadores de pagamento são normalizadores | Checkout, assinatura, dunning reais (H3) |
| UI é o protótipo HTML separado | Três superfícies em Next.js, pt-BR (H5) |
| AGPL-3.0 não resolvido | **Gate jurídico antes de cobrar** (E2.9) |

Nenhum arquivo de `OARANHA/crises` foi alterado para produzir esta fundação.
