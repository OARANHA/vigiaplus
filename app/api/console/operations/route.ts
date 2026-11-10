import { NextResponse } from 'next/server';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collectionRuns, incidents, invoices, projects, tenants } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { buildOperationalOverview } from '@/lib/vigia/operational-brief';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(){
  const ctx=await resolveTenantContext({surface:'console'});
  requireOwner(ctx);
  const db=await getDb();
  const newest=db.select({id:sql.raw('max(collection_runs.id)') as SQL<number>})
    .from(collectionRuns).groupBy(collectionRuns.projectId);
  const [t,p,r,i,f]=await Promise.all([
    db.select({id:tenants.id,name:tenants.name,status:tenants.status}).from(tenants),
    db.select({id:projects.id,tenantId:projects.tenantId,name:projects.name,mode:projects.mode}).from(projects),
    db.select({id:collectionRuns.id,projectId:collectionRuns.projectId,status:collectionRuns.status,
      startedAt:collectionRuns.startedAt,newCount:collectionRuns.newCount})
      .from(collectionRuns).where(inArray(collectionRuns.id,newest)),
    db.select({id:incidents.id,tenantId:incidents.tenantId,title:incidents.title,
      status:incidents.status,severity:incidents.severity}).from(incidents),
    db.select({id:invoices.id,tenantId:invoices.tenantId,status:invoices.status})
      .from(invoices).where(inArray(invoices.status,['overdue'])),
  ]);
  return NextResponse.json(buildOperationalOverview({
    tenants:t,projects:p,runs:r,incidents:i,invoices:f,
  }),{headers:{'Cache-Control':'no-store'}});
}
