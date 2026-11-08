// Trilha imutável, somente acréscimo. Todo mutator e toda impersonação passam por aqui.
import { randomUUID } from 'node:crypto';

export function appendAudit(store, ctx, event) {
  const row = {
    id: randomUUID(),
    tenant_id: ctx?.tenantId ?? null,
    actor_id: ctx?.userId ?? null,
    actor_role: ctx?.role ?? 'system',
    action: event.action,
    target: event.target ?? null,
    reason: event.reason ?? null,
    ip: event.ip ?? ctx?.ip ?? null,
    request_id: ctx?.requestId ?? null,
    at: new Date().toISOString(),
  };
  // insertRaw: escrita de sistema, deliberadamente fora do escopo de tenant.
  store.insertRaw('audit_events', row);
  return row;
}

export function auditForTenant(store, ctx, tenantId) {
  return store
    .all('audit_events', ctx)
    .filter((e) => String(e.tenant_id) === String(tenantId));
}
