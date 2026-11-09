# Deploy — VigiaPlus (Docker + Traefik)

Pilha de auto-hospedagem com três superfícies na mesma app Next.js:
`/portal` (cliente), `/console` (dono), `/dashboard` (analista).

## Pré-requisitos
- Docker + Docker Compose v2
- Domínio apontando para o host (ex.: `vigiaplus.exemplo.com`)
- E-mail para o certificado Let's Encrypt

## 1. Variáveis (`.env` na pasta `deploy/`)
Copie `.env.example` para `deploy/.env` e preencha:

| Var | Obrigatória | Uso |
|-----|-------------|-----|
| `APP_DOMAIN` | sim | Host roteado pelo Traefik |
| `ACME_EMAIL` | sim | E-mail do certificado TLS |
| `SESSION_SECRET` | sim | Assinatura de cookie de sessão (≥32 chars) |
| `DATABASE_URL` | não | Postgres/Neon; vazio = PGlite embarcado (`.data`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | p/ cartão | Cobrança Stripe |
| `ASAAS_API_KEY` / `PIX_WEBHOOK_SECRET` | p/ Pix | Cobrança PIX via Asaas |
| `CRON_SECRET` | sim | Protege workers `/api/cron/*` |
| `RADAR_MCP_TOKEN` | não | Liga o endpoint `/api/mcp` |

## 2. Subir
```bash
cd deploy
docker compose up -d --build
```
- Traefik termina TLS (redireciona 80→443) e aplica cabeçalhos de segurança.
- App na porta 3000 (interna), exposta só via Traefik.
- PGlite persiste em volume `vigiaplus-data` (`.data`); com `DATABASE_URL` usa Postgres.

## 3. Webhooks de cobrança
- Stripe → `https://{APP_DOMAIN}/api/webhooks/stripe`
- Pix/Asaas → `https://{APP_DOMAIN}/api/webhooks/pix`
Ambos idempotentes (dedupe por `event id`).

## 4. Saúde
`GET /api/health` → `{ status: "ok", service: "vigiaplus", ts }`.

## 5. CI
`.github/workflows/ci.yml` roda lint → tsc → testes → build em todo push/PR.
