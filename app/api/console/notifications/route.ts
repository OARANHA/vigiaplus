import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notificationDeliveries } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { isDemoMode } from '@/lib/session';
import { requeueDeadLetter } from '@/lib/notifications/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {'Cache-Control':'no-store'};

function respondError(error:unknown) {
  if(error instanceof AppError) return NextResponse.json({
    error:error.code,message:error.message,
  },{status:error.status,headers:HEADERS});
  return NextResponse.json({error:'NOTIFICATION_OPERATION_FAILED',
    message:'Operação de notificação indisponível'},{status:500,headers:HEADERS});
}

function positiveId(value:unknown):number {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)throw AppError.badRequest('Identificador inválido');
  return n;
}

async function ownerContext(){
  const ctx=await resolveTenantContext({surface:'console'});
  requireOwner(ctx);
  return ctx;
}

/** Inspeção operacional do dono, filtrada por tenant e sem credenciais. */
export async function GET(request:Request) {
  try {
    await ownerContext();
    const tenantId=positiveId(new URL(request.url).searchParams.get('tenant_id'));
    const db=await getDb();
    const rows=await db.select({
      id:notificationDeliveries.id,
      eventRef:notificationDeliveries.eventRef,
      sourceProjectId:notificationDeliveries.sourceProjectId,
      channel:notificationDeliveries.channel,
      destination:notificationDeliveries.destination,
      status:notificationDeliveries.status,
      attemptCount:notificationDeliveries.attemptCount,
      nextAttemptAt:notificationDeliveries.nextAttemptAt,
      leaseExpiresAt:notificationDeliveries.leaseExpiresAt,
      error:notificationDeliveries.error,
      createdAt:notificationDeliveries.createdAt,
      sentAt:notificationDeliveries.sentAt,
    }).from(notificationDeliveries)
      .where(eq(notificationDeliveries.tenantId,tenantId))
      .orderBy(desc(notificationDeliveries.createdAt)).limit(100);
    return NextResponse.json({tenantId,deliveries:rows}, {headers:HEADERS});
  } catch(e){return respondError(e);}
}

/** Reprocessamento manual de dead-letter com justificativa auditada. */
export async function POST(request:Request){
  try{
    if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},
      {status:403,headers:HEADERS});
    const ctx=await ownerContext();
    const raw=await request.text();
    if(raw.length>8192)throw AppError.badRequest('Pedido muito grande');
    let input:unknown;
    try{input=JSON.parse(raw);}catch{throw AppError.badRequest('JSON inválido');}
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw AppError.badRequest('JSON inválido');
    const data=input as Record<string,unknown>;
    const tenantId=positiveId(data.tenantId);
    const deliveryId=positiveId(data.deliveryId);
    const reason=typeof data.reason==='string'?data.reason.trim():'';
    if(reason.length<5||reason.length>300)
      throw AppError.badRequest('Justificativa de 5 a 300 caracteres obrigatória');
    const reopened=await requeueDeadLetter(await getDb(),{
      tenantId,deliveryId,actor:ctx.userName,reason,
    });
    if(!reopened)throw AppError.notFound('Entrega não encontrada ou fora da fila definitiva');
    return NextResponse.json({ok:true,tenantId,deliveryId,status:'queued'},
      {headers:HEADERS});
  }catch(e){return respondError(e);}
}
