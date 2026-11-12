/**
 * ALT-08.10: integration of the REAL Next /api/app/evidence GET handler
 * with authenticated tenant and entitlement rows in the same isolated Neon DB.
 * Explicit manual CI only. No fallback to getDb() if requested but invalid.
 *
 * Synthetic schema intentionally NOT a production migration.
 */
import {NextResponse} from 'next/server';
import {verifySession,SESSION_COOKIE} from '../session';
import {selectAuthorizedClientMembership} from './authorized-membership';
import {withNeonRlsPool} from './neon-rls-adapter';
import {withTenantRlsTransaction} from './rls-transaction';
import type {TenantSqlClient} from './rls-transaction';
import {AppError} from './errors';

const SCHEMA='alt0810_next_ci';
const DB='vigia_alt086_staging_20261112';
const ROLE='vigia_alt087_staging_reader';
export const ALT0810_FLAG='VIGIA_ALT0810_NEXT_STAGING_MODE';

export function alt0810StagingRequested(env:NodeJS.ProcessEnv):boolean{
 return env[ALT0810_FLAG]!==undefined;
}
export function assertAlt0810StagingEnvironment(env:NodeJS.ProcessEnv):void{
 if(env[ALT0810_FLAG]!=='isolated-next-auth'||
    env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.NODE_ENV==='production'||
    env.DEMO_MODE==='1'||env.DATABASE_URL||
    env.VIGIA_RLS_MODE!=='ci-experimental'||
    env.ALT0810_STAGING_CONFIRM!=='NEXT_REAL_ROUTE_SYNTHETIC_ONLY'||
    !env.GITHUB_RUN_ID||!/^\d+$/.test(env.GITHUB_RUN_ID)||
    !env.RLS_DATABASE_URL)throw Error('ALT0810_NEXT_STAGING_DISABLED');
 const url=new URL(env.RLS_DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||
    !url.hostname.endsWith('.neon.tech')||
    decodeURIComponent(url.pathname.slice(1))!==DB||
    decodeURIComponent(url.username)!==ROLE)throw Error('ALT0810_NEXT_STAGING_TARGET_REJECTED');
}

type Query=TenantSqlClient['query'];
async function resolveTenant(query:Query,cookieValue:string|undefined,requested:number|null){
 const session=verifySession(cookieValue);
 if(!session)return {ok:false as const,code:401};
 const info=await query(`SELECT id,global_role,session_version,must_change_password
    FROM ${SCHEMA}.users WHERE id=$1`,[session.userId]);
 const user=info.rows[0];
 if(!user||Number(user.session_version)!==session.version||
    Number(user.must_change_password)!==0)return {ok:false as const,code:401};
 if(user.global_role!==null)return {ok:false as const,code:403};
 const m=await query(`SELECT tenant_id AS "tenantId",role FROM ${SCHEMA}.memberships
   WHERE user_id=$1 ORDER BY tenant_id LIMIT 3`,[session.userId]);
 const candidates=m.rows.map(x=>({tenantId:Number(x.tenantId),role:String(x.role)}));
 let tenantId:number;
 try{
  const selected=selectAuthorizedClientMembership(candidates,requested);
  tenantId=selected.membership.tenantId;
 }catch(e){
  if(e instanceof AppError)return {ok:false as const,code:e.status};
  throw e;
 }
 const rights=await query(`SELECT t.status,
  (SELECT count(*)::int FROM ${SCHEMA}.subscriptions s
    WHERE s.tenant_id=t.id AND s.status='active'
      AND (s.vigencia_ate IS NULL OR s.vigencia_ate>=now())) AS active_count,
  (SELECT count(*)::int FROM ${SCHEMA}.plan_features pf
    JOIN ${SCHEMA}.subscriptions s ON s.plan_key=pf.plan_key
    WHERE s.tenant_id=t.id AND s.status='active'
      AND (s.vigencia_ate IS NULL OR s.vigencia_ate>=now())
      AND pf.feature_key='reputation_dual') AS plan_grant,
  (SELECT count(*)::int FROM ${SCHEMA}.tenant_features f
    WHERE f.tenant_id=t.id AND f.feature_key='reputation_dual'
      AND f.enabled=0) AS denied
   FROM ${SCHEMA}.tenants t WHERE t.id=$1`,[tenantId]);
 const rightsRow=rights.rows[0];
 if(!rightsRow||rightsRow.status!=='active'||
    Number(rightsRow.active_count)!==1||
    Number(rightsRow.plan_grant)!==1||
    Number(rightsRow.denied)>0)return {ok:false as const,code:403};
 return {ok:true as const,tenantId};
}
export async function alt0810NextStagingEvidence(request:Request):Promise<NextResponse>{
 assertAlt0810StagingEnvironment(process.env);
 const url=new URL(request.url);
 const raw=url.searchParams.get('tenant_id');
 const selected=raw===null?null:Number(raw);
 if(selected!==null&&(!Number.isSafeInteger(selected)||selected<=0)){
  return NextResponse.json({error:'INVALID_TENANT'},{status:400});
 }
 const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim())
  .find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);
 return withNeonRlsPool(process.env,async pool=>{
  const client=await pool.connect();
  let authorization:Awaited<ReturnType<typeof resolveTenant>>;
  try{
   const role=await client.query(`SELECT current_database() AS db,current_user AS role,
    (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user) AS privileged,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='${SCHEMA}'
      AND tablename='incidents' AND policyname='alt0810_read') AS policies`);
   const row=role.rows[0];
   if(!row||row.db!==DB||row.role!==ROLE||row.privileged!==false||
      Number(row.policies)!==1)throw Error('ALT0810_READER_POLICY_NOT_ENFORCED');
   authorization=await resolveTenant((s,p)=>client.query(s,p),cookie,selected);
  }finally{client.release()}
  if(!authorization.ok)return NextResponse.json({error:'ACCESS_DENIED'},
    {status:authorization.code,headers:{'Cache-Control':'no-store'}});
  const r=await withTenantRlsTransaction(pool,authorization.tenantId,q=>q(
    `SELECT id,title FROM ${SCHEMA}.incidents ORDER BY id LIMIT 12`));
  return NextResponse.json({tenantId:authorization.tenantId,items:r.rows},
   {status:200,headers:{'Cache-Control':'no-store'}});
 });
}
