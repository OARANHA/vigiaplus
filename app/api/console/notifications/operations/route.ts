import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Somente proprietário; observabilidade operacional agregada, sem PII. */
export async function GET() {
  try {
    const ctx = await resolveTenantContext({ surface: 'console' });
    requireOwner(ctx);
    const db = await getDb();
    const [runs, simulation, queue] = await Promise.all([
      db.execute(sql`
        SELECT run_id, worker, started_at, finished_at, duration_ms, status,
               exit_code, summary
          FROM notification_worker_runs
         WHERE worker='notify'
         ORDER BY finished_at DESC
         LIMIT 20
      `),
      db.execute(sql`
        SELECT run_id, started_at, finished_at, duration_ms, status, exit_code
          FROM notification_worker_runs WHERE worker='notify_dry_run'
          ORDER BY finished_at DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE status IN ('queued','retry')) AS pending,
          count(*) FILTER (WHERE status='processing') AS processing,
          count(*) FILTER (WHERE status='dead_letter') AS dead_letter,
          count(*) FILTER (WHERE status IN ('queued','retry')
            AND (next_attempt_at IS NULL OR next_attempt_at<=now())
            AND created_at < now() - interval '10 minutes') AS delayed,
          count(*) FILTER (WHERE status IN ('queued','retry')
            AND sla_due_at IS NOT NULL AND sla_due_at < now()) AS sla_overdue,
          min(created_at) FILTER (WHERE status IN ('queued','retry')
            AND (next_attempt_at IS NULL OR next_attempt_at<=now())) AS oldest_ready_at
        FROM notification_deliveries
      `),
    ]);
    const row: Record<string, unknown> = queue.rows[0] ?? {};
    const recent = runs.rows.map(r => ({
      runId: String(r.run_id),
      worker: String(r.worker),
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: count(r.duration_ms),
      status: String(r.status),
      exitCode: r.exit_code,
      summary: r.summary,
    }));
    const latest = recent[0] ?? null;
    const lastFinished = latest ? new Date(String(latest.finishedAt)).getTime() : NaN;
    // 'unknown' nunca significa saudável: ausência de execução é dado ausente.
    const healthy = Boolean(latest && latest.status === 'success'
      && Number.isFinite(lastFinished) && Date.now() - lastFinished <= 10 * 60_000);
    return NextResponse.json({
      worker: {
        status: latest ? healthy ? 'healthy' : 'degraded' : 'not_observed',
        configured: null, // O HTTP não sabe se o agendador do host está instalado.
        lastFinishedAt: latest?.finishedAt ?? null,
        expectedMaxLagMinutes: 10,
        runs: recent,
      },
      simulation: {
        lastFinishedAt: simulation.rows[0]?.finished_at ?? null,
        runs: simulation.rows.map(r=>({
          runId: String(r.run_id), startedAt:r.started_at, finishedAt:r.finished_at,
          durationMs:count(r.duration_ms), status:String(r.status), exitCode:r.exit_code,
        })),
        simulatedOnly: true,
      },
      queue: {
        pending: count(row.pending),
        processing: count(row.processing),
        deadLetter: count(row.dead_letter),
        delayed: count(row.delayed),
        slaOverdue: count(row.sla_overdue),
        oldestReadyAt: row.oldest_ready_at ?? null,
      },
      observedAt: new Date().toISOString(),
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json({ error: error.code, message: error.message },
        { status: error.status, headers: HEADERS });
    return NextResponse.json({ error: 'WORKER_OBSERVABILITY_UNAVAILABLE' },
      { status: 503, headers: HEADERS });
  }
}
