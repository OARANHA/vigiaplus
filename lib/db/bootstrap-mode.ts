/**
 * ALT-08.10C.4: fail-closed selection of implicit bootstrap behavior.
 * Staging mode is CI-only and NEVER modifies application schema, seeds,
 * catalog, indexes, migrations or auth credentials.
 */
export type DbBootstrapMode='legacy-bootstrap'|'preprovisioned-staging-ci';

export function resolveDbBootstrapMode(
 env:Readonly<Record<string,string|undefined>>,
):DbBootstrapMode{
 const requested=env.VIGIA_DB_BOOTSTRAP_MODE;
 if(requested===undefined || requested==='legacy-bootstrap'){
  // Legacy default is intentionally unchanged on production deployments.
  return 'legacy-bootstrap';
 }
 if(requested!=='preprovisioned-staging-ci')throw Error('DB_BOOTSTRAP_MODE_UNKNOWN');
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
  env.NODE_ENV==='production'||env.DEMO_MODE==='1'||
  env.VIGIA_DB_BOOTSTRAP_CONFIRM!=='READ_EXISTING_SCHEMA_ONLY'||
  env.VIGIA_RLS_MODE!=='ci-experimental'||
  !/^\d+$/.test(env.GITHUB_RUN_ID??'')||!env.DATABASE_URL||
  env.RLS_DATABASE_URL){
  throw Error('DB_BOOTSTRAP_STAGING_CI_ONLY');
 }
 let url:URL;
 try{url=new URL(env.DATABASE_URL)}catch{throw Error('DB_BOOTSTRAP_URL_INVALID')}
 if(!['postgres:','postgresql:'].includes(url.protocol)||
  !url.hostname.endsWith('.neon.tech')||
  decodeURIComponent(url.pathname.slice(1))!=='vigia_alt086_staging_20261112'||
  decodeURIComponent(url.username)!=='vigia_alt087_staging_reader'){
  throw Error('DB_BOOTSTRAP_STAGING_TARGET_DENIED');
 }
 return 'preprovisioned-staging-ci';
}
