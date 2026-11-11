import { NextResponse } from 'next/server';
import { and,desc,eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users,auditEvents } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/session';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { emailSetup } from '@/lib/notifications/email-config';
import { send } from '@/lib/notifications/transport';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const ACTION='RESEND_DIAGNOSTIC';
const CONFIRM='ENVIAR_TESTE_PARA_MINHA_CONTA';

function failure(e:unknown) {
 if(e instanceof AppError)return NextResponse.json({error:e.code,message:e.message},
  {status:e.status,headers:HEADERS});
 return NextResponse.json({error:'EMAIL_DIAGNOSTIC_FAILED',
  message:'Diagnóstico indisponível'},{status:500,headers:HEADERS});
}
async function owner(){
 const ctx=await resolveTenantContext({surface:'console'});
 requireOwner(ctx);
 return ctx;
}
export async function GET(){
 try{
  if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403,headers:HEADERS});
  const ctx=await owner();
  const db=await getDb();
  const [account]=await db.select({email:users.email}).from(users)
    .where(eq(users.id,ctx.userId)).limit(1);
  const [last]=await db.select({createdAt:auditEvents.createdAt,meta:auditEvents.meta})
    .from(auditEvents).where(and(eq(auditEvents.action,ACTION),
      eq(auditEvents.target,'user:'+ctx.userId)))
    .orderBy(desc(auditEvents.createdAt)).limit(1);
  return NextResponse.json({
   ...emailSetup(),testRecipient:account?.email??null,
   lastTest:last?{createdAt:last.createdAt,status:((last.meta??{}) as Record<string,unknown>).status??'unknown'}:null,
   message:'Configuração local não comprova domínio verificado nem entrega. Teste somente para o próprio e-mail.',
  },{headers:HEADERS});
 }catch(e){return failure(e);}
}
export async function POST(request:Request){
 if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403,headers:HEADERS});
 try{
  const ctx=await owner();
  const raw=await request.text();
  if(raw.length>1024)throw AppError.badRequest('Pedido muito grande');
  let obj:unknown;
  try{obj=JSON.parse(raw);}catch{throw AppError.badRequest('JSON inválido');}
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    (obj as {confirm?:unknown}).confirm!==CONFIRM)
    throw AppError.badRequest('Confirmação explícita necessária');
  const setup=emailSetup();
  if(!setup.readyForTest)throw new AppError('EMAIL_NOT_CONFIGURED',503,
    'Configure RESEND_API_KEY, ALERT_EMAIL_FROM e PUBLIC_APP_URL HTTPS');
  const db=await getDb();
  const [user]=await db.select({email:users.email}).from(users)
   .where(eq(users.id,ctx.userId)).limit(1);
  if(!user?.email)throw AppError.notFound('E-mail da conta do proprietário não encontrado');
  // Endereço controlado pelo login: NUNCA aceitar destinatário no corpo.
  const key='vpx-diagnostic/'+ctx.userId+'/'+new Date().toISOString().slice(0,10);
  let result:{ok:boolean;detail:string;providerId?:string};
  try{
   result=await send({channel:'email',destination:user.email,
    title:'Diagnóstico de e-mail do VigiaPlus',
    message:'Teste controlado do proprietário. O aceite HTTP não confirma entrega na caixa de entrada.',
    idempotencyKey:key,
   });
  }catch{result={ok:false,detail:'TRANSPORT_UNAVAILABLE'};}
  const status=result.ok?'accepted_by_provider':'failed';
  await db.insert(auditEvents).values({actor:ctx.userName,action:ACTION,
    target:'user:'+ctx.userId,reason:'Diagnóstico de e-mail solicitado pelo proprietário',
    meta:{status,httpResult:/^HTTP \d{3}$/.test(result.detail)?result.detail:'unavailable',
      providerId:result.providerId??null}});
  return NextResponse.json({ok:result.ok,status,
   providerId:result.providerId??null,
   message:result.ok?'O provedor aceitou a solicitação. Entrega ainda não confirmada.':
     'O provedor não aceitou o envio; consulte a configuração do remetente.'},
   {status:result.ok?202:502,headers:HEADERS});
 }catch(e){return failure(e);}
}
