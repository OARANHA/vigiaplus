/**
 * ALT-08.10C.24 — PostgreSQL16 transaction adapter restricted to CI.
 *
 * No operational app imports this module. A real Next.js route integration is
 * NOT implied. This adapter does not make mutable GUCs non-spoofable.
 */
import {createRequire} from 'node:module';
import {verifySession} from '../session';
import {authorizeDisposableTenantScope} from '../tenant/alt0810c20-authz-preflight';

export const ALT0810C24={
 version:'alt0810c24-ci-transaction-adapter-v1',
 operationalEnabled:false,stagingAuthorized:false,productionAuthorized:false,
} as const;
export type PgTransactionPort={
 connect():Promise<void>;
 query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;
 end():Promise<void>;
};
export type AuthzResult={status:200;ids:number[]}|{status:401|403;ids:[]};
export const CI_SCHEMA='alt0810c6_adapter24';
export const CI_READER='alt0810c6_adapter_reader24';
export function assertAlt0810c24Env(e:Readonly<Record<string,string|undefined>>){
 if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
  e.ALT0810C24_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
  e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
  e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
  e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production')
  throw Error('ALT0810C24_DISPOSABLE_PG16_ONLY');
}
export function newDisposableClient(e:Readonly<Record<string,string|undefined>>):PgTransactionPort{
 assertAlt0810c24Env(e);
 const {Client}=createRequire(import.meta.url)('pg') as {
  Client:new(opts:Record<string,unknown>)=>PgTransactionPort};
 return new Client({host:'127.0.0.1',port:5432,
  database:'vigia_alt081_ci',user:'vigia_ci',password:'isolated_ci_only'});
}
/** Validate signed session *before* opening transaction; all other checks
 * occur inside the same transaction with SHARE locks to prevent a revocation
 * racing against the authorized read. A transaction ends by ROLLBACK.
 */
export async function readAuthorizedFixture(
 db:PgTransactionPort,cookie:string|undefined,tenantId:number,
):Promise<AuthzResult>{
 const parsed=verifySession(cookie);
 if(!parsed||!Number.isSafeInteger(tenantId)||tenantId<=0)
  return {status:401,ids:[]};
 await db.query('BEGIN');
 try{
  const sess=await db.query(`SELECT id,session_version,global_role
   FROM ${CI_SCHEMA}.users WHERE id=$1 FOR SHARE`,[parsed.userId]);
  const identity=sess.rows[0];
  if(!identity||Number(identity.session_version)!==parsed.version)
   return {status:401,ids:[]};
  if(identity.global_role!==null)
   return {status:403,ids:[]};
  const memberships=await db.query(`SELECT m.user_id,m.tenant_id,m.role,m.active,
    c.status,c.subscription_status,c.entitlement_enabled
    FROM ${CI_SCHEMA}.memberships m
    JOIN ${CI_SCHEMA}.contracts c ON c.tenant_id=m.tenant_id
    WHERE m.user_id=$1 AND m.tenant_id=$2 FOR SHARE OF m,c`,[parsed.userId,tenantId]);
  if(memberships.rows.length!==1)return {status:403,ids:[]};
  const m=memberships.rows[0];
  try{
   authorizeDisposableTenantScope({
    principal:{userId:parsed.userId,sessionVersion:parsed.version,
     verifiedSessionVersion:Number(identity.session_version),globalRole:'client'},
    requestedTenantId:tenantId,
    membership:{userId:Number(m.user_id),tenantId:Number(m.tenant_id),
     role:String(m.role) as 'client_viewer'|'client_admin',active:m.active===true},
    contract:{tenantId:Number(m.tenant_id),status:String(m.status) as 'active',
     subscriptionStatus:String(m.subscription_status) as 'active',
     entitlementEnabled:m.entitlement_enabled===true}
   });
  }catch{return {status:403,ids:[]}}
  await db.query(`SET LOCAL ROLE ${CI_READER}`);
  await db.query('SELECT set_config($1,$2,true)',['app.user_id',String(parsed.userId)]);
  await db.query('SELECT set_config($1,$2,true)',['app.tenant_id',String(tenantId)]);
  const rows=await db.query(`SELECT id FROM ${CI_SCHEMA}.evidence ORDER BY id`);
  return {status:200,ids:rows.rows.map(r=>Number(r.id))};
 }finally{
  await db.query('ROLLBACK');
 }
}
