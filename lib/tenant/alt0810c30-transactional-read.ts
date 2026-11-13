/**
 * ALT-08.10C.30 — isolated candidate for authenticated PostgreSQL RLS reads.
 * No production route calls this yet. It intentionally has no PG driver import.
 * One dedicated connection must be supplied per request; never use pool.query
 * across BEGIN/SET LOCAL/SELECT/ROLLBACK.
 */
import {verifySession} from '../session';

export const ALT0810C30={
 version:'alt0810c30-transactional-authorized-read-v1',
 operationalEnabled:false,stagingAuthorized:false,productionAuthorized:false,
} as const;

export type TxQuery={query(sql:string,params?:unknown[]):Promise<{
 rows:Record<string,unknown>[];rowCount:number|null;
}>};
export type TenantReadOutcome<T>={status:200;data:T}|{status:401|403;data:null};
export type TenantReadArgs<T>={
 db:TxQuery;cookie:string|undefined;tenantId:number;featureKey:string;
 // Caller must use only a server-defined, schema-qualified SQL statement
 // inside read. Never accept SQL or role selection from the HTTP request.
 read:(db:TxQuery)=>Promise<T>;
 /**
  * Server deployment role must not BYPASSRLS; this fixed SQL-only role is
  * granted SELECT on tenant evidence, not identities or billing tables.
  */
 readerRole:string;
};

/**
 * Validates signature -> session version -> active membership -> active tenant
 * -> live subscription -> enabled plan entitlement -> scope, all on one PG
 * connection. FOR SHARE blocks concurrent revocation until tx ends.
 * Identities and billing checks run before dropping to the restricted RLS role.
 *
 * This is a candidate primitive, not a live route migration. A mutable GUC is
 * not an unforgeable identity when arbitrary SQL access is available; prevent
 * untrusted SQL and never grant BYPASSRLS to the read role.
 */
export async function authorizedTenantRead<T>(args:TenantReadArgs<T>):Promise<TenantReadOutcome<T>>{
 const parsed=verifySession(args.cookie);
 if(!parsed)return {status:401,data:null};
 if(!Number.isSafeInteger(args.tenantId)||args.tenantId<=0||
    !/^[a-z][a-z0-9_]{0,62}$/.test(args.featureKey)||
    !/^[a-z][a-z0-9_]{0,62}$/.test(args.readerRole))
  return {status:403,data:null};

 const db=args.db;
 await db.query('BEGIN');
 try{
  const session=await db.query(`SELECT id,session_version,global_role
    FROM users WHERE id=$1 FOR SHARE`,[parsed.userId]);
  const user=session.rows[0];
  if(!user||Number(user.session_version)!==parsed.version)
   return {status:401,data:null};
  // All internal roles MUST use a separate, explicitly reviewed policy.
  if(user.global_role!==null&&user.global_role!==undefined)
   return {status:403,data:null};

  const memberships=await db.query(`SELECT m.tenant_id,m.role,t.status
    FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=$1 AND m.tenant_id=$2 FOR SHARE OF m,t`,
    [parsed.userId,args.tenantId]);
  if(memberships.rows.length!==1)return {status:403,data:null};
  const member=memberships.rows[0];
  if(!['client_viewer','client_admin'].includes(String(member.role))||
     member.status!=='active')return {status:403,data:null};

  const contracts=await db.query(`SELECT s.id,s.plan_key,s.status,s.vigencia_ate,
       s.grace_until FROM subscriptions s
    WHERE s.tenant_id=$1 AND s.status IN ('active','past_due')
    FOR SHARE OF s`,[args.tenantId]);
  const now=Date.now();
  const candidates=contracts.rows.filter(s=>{
   if(s.vigencia_ate&&new Date(String(s.vigencia_ate)).getTime()<now)return false;
   return s.status==='active'||(s.status==='past_due'&&s.grace_until&&
     new Date(String(s.grace_until)).getTime()>now);
  });
  if(candidates.length!==1)return {status:403,data:null};
  const plan=String(candidates[0].plan_key);

  const overrides=await db.query(`SELECT enabled,expires_at FROM tenant_features
    WHERE tenant_id=$1 AND feature_key=$2 FOR SHARE`,
    [args.tenantId,args.featureKey]);
  const current=overrides.rows.filter(r=>!r.expires_at||
    new Date(String(r.expires_at)).getTime()>now);
  if(current.length>1||current.some(r=>Number(r.enabled)===0))
   return {status:403,data:null};
  let enabled=current.some(r=>Number(r.enabled)===1);
  if(!enabled){
   const pf=await db.query(`SELECT feature_key FROM plan_features
     WHERE plan_key=$1 AND feature_key=$2 FOR SHARE`,[plan,args.featureKey]);
   enabled=pf.rows.length===1;
  }
  if(!enabled)return {status:403,data:null};

  // Role is allowlisted by naming contract; privilege provisioning and review
  // is external to this module. Never interpolate a user-chosen SQL fragment.
  await db.query(`SET LOCAL ROLE "${args.readerRole}"`);
  await db.query('SELECT set_config($1,$2,true)',['app.user_id',String(parsed.userId)]);
  await db.query('SELECT set_config($1,$2,true)',['app.tenant_id',String(args.tenantId)]);
  return {status:200,data:await args.read(db)};
 }finally{
  await db.query('ROLLBACK');
 }
}
