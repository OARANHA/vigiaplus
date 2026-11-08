// Autorização declarativa. INVARIANTE: nenhuma função aqui lê ctx.density ou
// ctx.vocabulary. Modo básico/avançado é preferência de apresentação, nunca claim.
import { err } from './errors.js';
import { ROLES, SURFACES } from './catalog.js';

export function can(ctx, action) {
  const def = ROLES[ctx?.role];
  if (!def) return false;
  if (def.actions.includes('*')) return true;
  return def.actions.includes(action);
}

export function requireAction(ctx, action) {
  if (!can(ctx, action)) {
    throw err.forbidden(`Ação "${action}" negada para o papel ${ctx?.role ?? 'anônimo'}`);
  }
  return ctx;
}

export function requireSurface(ctx, surface) {
  if (!SURFACES[surface]) throw err.badRequest(`Superfície desconhecida: ${surface}`);
  const def = ROLES[ctx?.role];
  if (!def || !def.surfaces.includes(surface)) {
    throw err.forbidden(
      `A superfície "${SURFACES[surface].label}" não está disponível para ${ctx?.role ?? 'anônimo'}`,
    );
  }
  return ctx;
}

export function requireOwner(ctx) {
  if (ctx?.role !== 'owner') throw err.forbidden('Operação reservada ao dono da aplicação');
  return ctx;
}

// Usado apenas para demonstrar a invariante A4 no teste e no /health.
export function permissionsFingerprint(ctx) {
  return {
    role: ctx.role,
    surfaces: [...(ROLES[ctx.role]?.surfaces ?? [])],
    actions: [...(ROLES[ctx.role]?.actions ?? [])],
    tenantId: ctx.tenantId,
    system: ctx.system,
  };
}
