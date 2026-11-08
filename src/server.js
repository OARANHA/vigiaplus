// Servidor HTTP mínimo, zero dependências, para provar as fronteiras.
// Em produção este handler é substituído por rotas Next.js, mas o CONTRATO
// (resolveContext -> requireSurface -> requireFeature -> store escopado) é o mesmo.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { freshStore } from './store.js';
import { resolveContext } from './context.js';
import { requireSurface, requireAction, requireOwner, permissionsFingerprint } from './rbac.js';
import { requireFeature, enabledFeatures, featureState, setTenantFeature } from './entitlements.js';
import { registerProvider, listProviders, testConnection, validateEndpoint } from './llm-registry.js';
import { processPaymentEvent, createGateway, StripeAdapter, PixAdapter } from './payments.js';
import { ANALYST_PAGES, PLANS, FEATURE_CATALOG } from './catalog.js';
import { AppError, err } from './errors.js';

const DEMO_WEBHOOK_SECRET = process.env.VIGIA_WEBHOOK_SECRET ?? 'demo-webhook-secret';

export function createApp() {
  return {
    store: freshStore(),
    gateways: {
      stripe: createGateway(StripeAdapter),
      pix: createGateway(PixAdapter),
    },
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw err.badRequest('Payload acima de 256 KB');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return { body: JSON.parse(raw), raw };
  } catch {
    throw err.badRequest('JSON inválido');
  }
}

export function createHandler(app) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      // ---------------------------------------------------------- saúde
      if (method === 'GET' && path === '/health') {
        return send(res, 200, {
          ok: true,
          service: 'vigiaplus-foundation',
          version: '0.1.0',
          surfaces: ['app', 'console', 'analyst'],
          adversarial_suite: 'A1-A10',
          tenants: app.store.allRaw('tenants').length,
          providers: app.store.allRaw('llm_providers').length,
        });
      }

      // ------------------------------------------------------- webhook (sem sessão)
      if (method === 'POST' && path === '/api/webhooks/payments') {
        const { body, raw } = await readJson(req);
        const gatewayName = url.searchParams.get('gateway') ?? 'stripe';
        const gateway = app.gateways[gatewayName];
        if (!gateway) throw err.badRequest('Gateway desconhecido');
        const event = body.event ?? gateway.normalize(body);
        const result = processPaymentEvent(app.store, event, {
          secret: DEMO_WEBHOOK_SECRET,
          rawPayload: raw,
          signature: req.headers['x-webhook-signature'] ?? body.signature,
          adapter: gateway,
        });
        return send(res, result.duplicate ? 200 : 201, result);
      }

      // ------------------------------- autenticação + contexto + superfície
      const sessionToken = req.headers['x-vigia-session'];
      // `requestedTenantId` é HOSTIL: só o dono consegue usá-lo.
      const requestedTenantId =
        url.searchParams.get('tenant_id') ?? req.headers['x-tenant-id'] ?? null;
      const surface = path.startsWith('/api/console')
        ? 'console'
        : path.startsWith('/api/analyst')
          ? 'analyst'
          : 'app';

      const ctx = resolveContext(app.store, {
        sessionToken,
        requestedTenantId,
        surface,
        density: req.headers['x-view-density'] === 'avancado' ? 'avancado' : 'basico',
        vocabulary: req.headers['x-view-vocabulary'] === 'tecnico' ? 'tecnico' : 'leigo',
        ip: req.socket?.remoteAddress ?? null,
      });
      requireSurface(ctx, surface);

      // ---------------------------------------------- /app — portal do cliente
      if (method === 'GET' && path === '/api/app/summary') {
        requireAction(ctx, 'read');
        requireFeature(app.store, ctx, 'reputation_dual');
        const targets = app.store.all('reputation_targets', ctx);
        const incidents = app.store.all('incidents', ctx);
        return send(res, 200, {
          tenant: ctx.tenantId,
          greeting: `Bom dia, ${ctx.userName}`,
          reputations: targets.map((t) => ({ id: t.id, kind: t.kind, name: t.name, score: t.score })),
          open_incidents: incidents.filter((i) => i.status !== 'closed').length,
          // "às vezes o pouco é muito": evidência de trabalho, sem jargão.
          work_evidence: {
            sources_monitored: 24,
            comments_analyzed: 1240,
            detection_minutes: 11,
            subjects_tracked: 2,
          },
          view: { density: ctx.density, vocabulary: ctx.vocabulary },
        });
      }

      if (method === 'GET' && /^\/api\/app\/incidents\/[^/]+$/.test(path)) {
        requireAction(ctx, 'read');
        requireFeature(app.store, ctx, 'crisis_management');
        const id = path.split('/').pop();
        // A3: id de outro tenant -> null -> 404 (não 403, para não vazar existência).
        const incident = app.store.find('incidents', ctx, id);
        if (!incident) throw err.notFound();
        return send(res, 200, { incident });
      }

      if (method === 'GET' && path === '/api/app/plan') {
        requireAction(ctx, 'read_plan');
        const sub = app.store.all('subscriptions', ctx).find((s) => s.status === 'active');
        const plan = app.store.findRaw('plans', (p) => p.key === sub?.plan_key);
        return send(res, 200, {
          plan: plan ?? null,
          subscription_status: sub?.status ?? 'none',
          included: enabledFeatures(app.store, ctx),
          catalog: FEATURE_CATALOG,
        });
      }

      if (method === 'GET' && path === '/api/app/notices') {
        requireAction(ctx, 'read');
        return send(res, 200, { channels: app.store.all('notification_channels', ctx) });
      }

      if (method === 'GET' && path === '/api/me/permissions') {
        // Prova viva da invariante A4: o fingerprint NÃO depende do modo.
        return send(res, 200, {
          view: { density: ctx.density, vocabulary: ctx.vocabulary },
          permissions: permissionsFingerprint(ctx),
          features: enabledFeatures(app.store, ctx),
        });
      }

      // ------------------------------------------------ /console — dono
      if (method === 'GET' && path === '/api/console/tenants') {
        requireOwner(ctx);
        return send(res, 200, { tenants: app.store.allRaw('tenants') });
      }

      if (method === 'GET' && path === '/api/console/llm-providers') {
        requireOwner(ctx);
        return send(res, 200, { providers: listProviders(app.store), plans: PLANS });
      }

      if (method === 'POST' && path === '/api/console/llm-providers') {
        requireOwner(ctx);
        const { body } = await readJson(req);
        const provider = registerProvider(app.store, ctx, body, {
          // Desligado por padrão. Só para Ollama/LM Studio em máquina de dev.
          allowInsecure: process.env.VIGIA_ALLOW_INSECURE_LLM === '1',
          allowPrivateHosts: process.env.VIGIA_ALLOW_PRIVATE_LLM === '1',
        });
        return send(res, 201, { provider });
      }

      if (method === 'POST' && /^\/api\/console\/llm-providers\/[^/]+\/test$/.test(path)) {
        requireOwner(ctx);
        const id = path.split('/')[4];
        const result = await testConnection(app.store, ctx, id, {
          resolve: async () => ['8.8.8.8'],
          fetchImpl: async () => ({ ok: true, status: 200 }),
        });
        return send(res, 200, result);
      }

      if (method === 'GET' && /^\/api\/console\/tenants\/[^/]+\/features$/.test(path)) {
        requireOwner(ctx);
        const tenantId = Number(path.split('/')[4]);
        const target = { ...ctx, tenantId, system: false };
        return send(res, 200, {
          catalog: FEATURE_CATALOG.map((f) => ({
            ...f,
            ...featureState(app.store, target, f.key),
          })),
        });
      }

      if (method === 'PATCH' && /^\/api\/console\/tenants\/[^/]+\/features$/.test(path)) {
        requireOwner(ctx);
        const { body } = await readJson(req);
        const tenantId = Number(path.split('/')[4]);
        return send(res, 200, { override: setTenantFeature(app.store, ctx, tenantId, body) });
      }

      // ------------------------------------------------ /analyst — equipe
      if (method === 'GET' && path === '/api/analyst/mentions') {
        requireAction(ctx, 'read');
        return send(res, 200, { mentions: app.store.all('mentions', ctx) });
      }

      if (method === 'GET' && path === '/api/analyst/pages') {
        requireAction(ctx, 'read');
        return send(res, 200, {
          note: 'As 64 páginas do Radar continuam intactas e acessíveis só à equipe.',
          groups: ANALYST_PAGES,
        });
      }

      // Rota de diagnóstico para o teste A7 (validação de endpoint).
      if (method === 'POST' && path === '/api/console/validate-endpoint') {
        requireOwner(ctx);
        const { body } = await readJson(req);
        return send(res, 200, validateEndpoint(body.base_url));
      }

      throw err.notFound('Rota inexistente');
    } catch (e) {
      if (e instanceof AppError) {
        return send(res, e.status, { error: e.code, message: e.message });
      }
      return send(res, 500, { error: 'INTERNAL_ERROR', message: String(e?.message ?? e) });
    }
  };
}

export function createServer(app = createApp()) {
  return http.createServer(createHandler(app));
}

export function start(port = Number(process.env.PORT ?? 3000)) {
  const server = createServer();
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`VigiaPlus foundation ouvindo em http://localhost:${port}`);
  });
  return server;
}

// Executa apenas quando chamado diretamente (node src/server.js).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start();
}
