// Autorizacao declarativa. INVARIANTE: nenhuma funcao aqui le ctx.density ou
// ctx.vocabulary. Modo basico/avancado e preferencia de apresentacao, nunca claim.
import { AppError } from './errors';
import { ROLES, SURFACES, type Role, type Surface } from './catalog';
import type { TenantContext } from './context';

export function can(ctx: TenantContext | null, action: string): boolean {
  if (!ctx) return false;
  const def = ROLES[ctx.role];
  if (!def) return false;
  if (def.actions.includes('*')) return true;
  return def.actions.includes(action);
}

export function requireAction(ctx: TenantContext, action: string): TenantContext {
  if (!can(ctx, action)) {
    throw AppError.forbidden(`Acao "${action}" negada para o papel ${ctx.role}`);
  }
  return ctx;
}

export function requireSurface(ctx: TenantContext, surface: Surface): TenantContext {
  if (!SURFACES[surface]) throw AppError.badRequest(`Superficie desconhecida: ${surface}`);
  const def = ROLES[ctx.role];
  if (!def || !def.surfaces.includes(surface)) {
    throw AppError.forbidden(
      `A superficie "${SURFACES[surface].label}" nao esta disponivel para ${ctx.role}`,
    );
  }
  return ctx;
}

export function requireOwner(ctx: TenantContext): TenantContext {
  if (ctx.role !== 'owner') throw AppError.forbidden('Operacao reservada ao dono da aplicacao');
  return ctx;
}

/**
 * Fingerprint de permissoes para o teste A4: NAO depende do modo.
 * Se o modo avancado e o basico devolverem o mesmo fingerprint, o modo
 * nao esta escalando privilegios.
 */
export function permissionsFingerprint(ctx: TenantContext) {
  return {
    role: ctx.role,
    surfaces: [...(ROLES[ctx.role as Role]?.surfaces ?? [])],
    actions: [...(ROLES[ctx.role as Role]?.actions ?? [])],
    tenantId: ctx.tenantId,
    system: ctx.system,
  };
}
