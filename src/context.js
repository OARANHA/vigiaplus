// TenantContext: a ÚNICA fonte de verdade para "de quem é este dado".
// Tudo que chega do request (header, query, body) é considerado hostil.
import { randomUUID } from 'node:crypto';
import { err } from './errors.js';
import { ROLES } from './catalog.js';
import { appendAudit } from './audit.js';

/**
 * @param {object} store
 * @param {object} opts
 * @param {string} opts.sessionToken      token opaco resolvido no SERVIDOR
 * @param {*}      opts.requestedTenantId NÃO CONFIÁVEL — só dono pode usá-lo
 * @param {string} opts.surface           app | console | analyst
 * @param {string} opts.density           basico | avancado (preferência, não permissão)
 * @param {string} opts.vocabulary        leigo | tecnico (preferência, não permissão)
 */
export function resolveContext(store, opts = {}) {
  const {
    sessionToken,
    requestedTenantId = null,
    surface = 'app',
    density = 'basico',
    vocabulary = 'leigo',
    ip = null,
  } = opts;

  const session = store.findRaw('sessions', (s) => s.token === sessionToken);
  if (!session || session.revoked) throw err.unauthenticated();

  const user = store.findRaw('users', (u) => u.id === session.userId && u.status === 'active');
  if (!user) throw err.unauthenticated('Usuário inexistente ou inativo');

  let role;
  let tenantId;
  let system = false;
  let spoofAttempt = null;

  const requested = requestedTenantId !== null && requestedTenantId !== undefined && requestedTenantId !== '';

  if (user.global_role === 'owner') {
    role = 'owner';
    if (requested) {
      const t = store.findRaw('tenants', (x) => String(x.id) === String(requestedTenantId));
      if (!t) throw err.notFound('Tenant inexistente');
      tenantId = t.id;
    } else {
      // Visão de carteira: leitura cross-tenant, sempre auditada por quem a usa.
      system = true;
      tenantId = null;
    }
  } else {
    // A1: tenant vem da SESSÃO, nunca do request.
    tenantId = session.tenantId;
    if (requested && String(requestedTenantId) !== String(tenantId)) {
      spoofAttempt = requestedTenantId; // ignora e registra a tentativa
    }
    if (user.global_role === 'analyst') {
      role = 'analyst';
    } else {
      const membership = store.findRaw(
        'memberships',
        (m) => m.user_id === user.id && String(m.tenant_id) === String(tenantId),
      );
      if (!membership) throw err.forbidden('Usuário sem vínculo com este tenant');
      role = membership.role;
    }
  }

  if (!ROLES[role]) throw err.forbidden('Papel desconhecido');

  const ctx = {
    userId: user.id,
    userName: user.name,
    role,
    tenantId,
    system,
    surface,
    density,
    vocabulary,
    ip,
    requestId: randomUUID(),
  };

  // A10: nenhum caminho de impersonação existe sem registro.
  if (user.global_role === 'owner' && !system) {
    appendAudit(store, ctx, {
      action: 'IMPERSONATE_TENANT',
      target: `tenant:${tenantId}`,
      reason: 'seleção explícita de tenant no console',
    });
  }
  if (spoofAttempt !== null) {
    appendAudit(store, ctx, {
      action: 'TENANT_SPOOF_ATTEMPT',
      target: `tenant:${spoofAttempt}`,
      reason: 'tenant_id enviado pelo cliente foi ignorado',
    });
  }
  return ctx;
}

/**
 * Troca de tenant pelo dono. Motivo é OBRIGATÓRIO e o evento é auditado
 * antes de o novo contexto ser devolvido.
 */
export function switchTenant(store, ctx, tenantId, reason) {
  if (ctx.role !== 'owner') throw err.forbidden('Somente o dono pode trocar de tenant');
  if (!reason || !String(reason).trim()) {
    throw err.badRequest('Impersonação exige motivo registrado');
  }
  const t = store.findRaw('tenants', (x) => String(x.id) === String(tenantId));
  if (!t) throw err.notFound('Tenant inexistente');

  const next = { ...ctx, tenantId: t.id, system: false };
  appendAudit(store, next, {
    action: 'IMPERSONATE_TENANT',
    target: `tenant:${t.id}`,
    reason: String(reason).trim(),
  });
  return next;
}
