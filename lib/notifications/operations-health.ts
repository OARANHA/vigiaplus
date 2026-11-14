/**
 * ALT-08.3 — health is derived from persisted, trusted metadata only.
 * A missing run, invalid timestamp or future clock skew cannot be healthy.
 * Never consider a simulation run evidence of real notification delivery.
 */
export type WorkerHealth = 'healthy' | 'degraded' | 'not_observed';
export type WorkerHealthInput = {
  worker: string;
  status: string;
  finishedAt: Date | string | number | null;
} | null;

export const WORKER_HEALTH_MAX_LAG_MS = 10 * 60_000;

export function evaluateWorkerHealth(
  latest: WorkerHealthInput,
  now = Date.now(),
): WorkerHealth {
  if (!latest) return 'not_observed';
  if (latest.worker !== 'notify' || latest.status !== 'success') return 'degraded';
  const at = latest.finishedAt instanceof Date
    ? latest.finishedAt.getTime()
    : typeof latest.finishedAt === 'number'
      ? latest.finishedAt
      : typeof latest.finishedAt === 'string'
        ? Date.parse(latest.finishedAt)
        : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(at)
      || at > now || now - at > WORKER_HEALTH_MAX_LAG_MS) {
    return 'degraded';
  }
  return 'healthy';
}

/** Strict allowlist so historic DB summary data never becomes PII in owner API. */
export function sanitizedWorkerSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const object = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const k of ['tenants','regras','canais','fatos','planejados','enfileirados']) {
    const x = object[k];
    if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0) safe[k] = x;
  }
  const delivery = object.entregas;
  if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)) {
    const x = delivery as Record<string, unknown>;
    if (typeof x.sent === 'number' && Number.isSafeInteger(x.sent) && x.sent >= 0
      && typeof x.failed === 'number' && Number.isSafeInteger(x.failed) && x.failed >= 0) {
      safe.entregas = {sent:x.sent,failed:x.failed};
    }
  }
  return safe;
}
