/**
 * Dunning (H3) — politica explicita do dono do sistema:
 *
 *   D+3   aviso de vencimento (canal interno + canais do cliente)
 *   D+7   assinatura vira past_due, com 3 dias de carencia (graceUntil)
 *   D+10  suspensao: entitlements passam a negar features
 *   D+90  cancelamento
 *
 * Um pagamento confirmado pelo webhook volta tudo para `active`.
 * Nenhuma acao e destrutiva: so muda status, nunca apaga dado de cliente.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  invoices, subscriptions, notificationChannels,
} from '@/lib/db/schema';
import { enqueue } from '@/lib/notifications/queue';

export type DunningReport = {
  scanned: number;
  reminded: number;
  pastDue: number;
  suspended: number;
  canceled: number;
};

function daysOverdue(dueAt: string | null, now: Date): number | null {
  if (!dueAt) return null;
  const due = new Date(`${dueAt}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) return null;
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000);
}

function brl(n: number): string {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function runDunning(now = new Date()): Promise<DunningReport> {
  const db = await getDb();
  const open = await db.select().from(invoices)
    .where(inArray(invoices.status, ['open', 'overdue', 'processing']));
  const report: DunningReport = {
    scanned: open.length, reminded: 0, pastDue: 0, suspended: 0, canceled: 0,
  };

  for (const inv of open) {
    const days = daysOverdue(inv.dueAt, now);
    if (days == null || days < 3) continue;

    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.tenantId, inv.tenantId)).limit(1);

    // D+3 — aviso legivel, com numero e prazo, sem adjetivo vago.
    if (days >= 3) {
      const channels = await db.select().from(notificationChannels)
        .where(and(
          eq(notificationChannels.tenantId, inv.tenantId),
          eq(notificationChannels.active, 1),
        ));
      const targets = channels.length > 0
        ? channels.map((c) => ({ channel: c.channel, destination: c.destination }))
        : [{ channel: 'ledger', destination: 'interno' }];

      for (const t of targets) {
        const created = await enqueue({
          tenantId: inv.tenantId,
          channel: t.channel,
          destination: t.destination,
          kind: days >= 7 ? 'payment_overdue' : 'payment_reminder',
          severity: days >= 7 ? 'high' : 'warning',
          title: days >= 7 ? 'Fatura vencida' : 'Fatura proxima do vencimento',
          message:
            `Fatura #${inv.id} de ${brl(inv.amountBrl)} venceu em ${inv.dueAt} ` +
            `(${days} dias). O contrato segue ativo por mais ` +
            `${Math.max(0, 7 - days)} dia(s) antes da suspensao. ` +
            `Regularize em Minha conta > Faturas para nao perder o acesso.`,
          dedupeKey: `dunning:${inv.id}:${days >= 7 ? 'overdue' : 'reminder'}:${t.channel}`,
        });
        if (created) report.reminded++;
      }
    }

    if (!sub) continue;

    if (days >= 90 && sub.status !== 'canceled') {
      await db.update(subscriptions).set({ status: 'canceled', updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      report.canceled++;
    } else if (days >= 10 && sub.status !== 'suspended' && sub.status !== 'canceled') {
      await db.update(subscriptions).set({ status: 'suspended', updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      report.suspended++;
    } else if (days >= 7 && sub.status === 'active') {
      await db.update(subscriptions).set({
        status: 'past_due',
        graceUntil: new Date(now.getTime() + 3 * 86_400_000),
        updatedAt: now,
      }).where(eq(subscriptions.id, sub.id));
      await db.update(invoices).set({ status: 'overdue' })
        .where(eq(invoices.id, inv.id));
      report.pastDue++;
    }
  }

  return report;
}
