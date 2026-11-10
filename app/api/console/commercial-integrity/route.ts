import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { commercialConstraintReport } from '@/lib/db/commercial-constraints';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Diagnóstico somente leitura: nenhuma tentativa de remover duplicidades.
export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const report = await commercialConstraintReport(await getDb());
  return NextResponse.json({
    ready: report.featureIndex && report.subscriptionIndex &&
      report.duplicateFeatures.length === 0 && report.duplicateSubscriptions.length === 0,
    featureIndex: report.featureIndex,
    subscriptionIndex: report.subscriptionIndex,
    duplicateFeatures: report.duplicateFeatures,
    duplicateSubscriptions: report.duplicateSubscriptions,
    action: 'Duplicidades devem ser conciliadas com aprovação explícita, antes das escritas comerciais.',
  });
}
