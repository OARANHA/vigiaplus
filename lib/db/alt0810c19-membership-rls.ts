/**
 * ALT-08.10C.19 — versioned, inert RLS candidate for disposable PostgreSQL16.
 * Requires positive tenant+user settings, active membership and explicit
 * account role. Session settings are NOT a cryptographic authentication proof.
 * Never imported by migrate.ts or operational runtime; NO-GO.
 */
export const ALT0810C19={
 version:'alt0810c19-rls-membership-candidate-v1',
 status:'disposable-ci-only',operationalMigrationAuthorized:false,
 stagingAuthorized:false,productionAuthorized:false,
 schema:'alt0810c6_membership19',
 roles:['alt0810c6_reader19','alt0810c6_owner19'] as const,
} as const;
const ns=ALT0810C19.schema;
const [reader,owner]=ALT0810C19.roles;
export const ALT0810C19_POLICY_SQL=Object.freeze([
 `ALTER TABLE ${ns}.evidence ENABLE ROW LEVEL SECURITY`,
 `ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`,
 `CREATE POLICY alt0810c19_read ON ${ns}.evidence FOR SELECT TO ${reader}
   USING (
    tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer
    AND NULLIF(current_setting('app.user_id',true),'')::integer > 0
    AND EXISTS (
     SELECT 1 FROM ${ns}.memberships m
     WHERE m.tenant_id = evidence.tenant_id
       AND m.user_id = NULLIF(current_setting('app.user_id',true),'')::integer
       AND m.active = true
       AND m.role IN ('client_viewer','client_admin')
    )
   )`,
 `CREATE POLICY alt0810c19_owner ON ${ns}.evidence FOR SELECT TO ${owner}
   USING (
     NULLIF(current_setting('app.tenant_id',true),'')::integer = tenant_id
     AND NULLIF(current_setting('app.user_id',true),'')::integer > 0
     AND EXISTS (
       SELECT 1 FROM ${ns}.internal_roles a
       WHERE a.user_id = NULLIF(current_setting('app.user_id',true),'')::integer
         AND a.role = 'owner' AND a.active = true
     )
   )`,
] as const);
export function assertAlt0810c19DisposableEnv(e:Readonly<Record<string,string|undefined>>){
 if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.ALT0810C19_EPHEMERAL!=='1'||
  e.RUNNER_OS!=='Linux'||e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
  e.PGDATABASE!=='vigia_alt081_ci'||e.PGUSER!=='vigia_ci'||
  e.PGPASSWORD!=='isolated_ci_only'||!!e.DATABASE_URL||!!e.RLS_DATABASE_URL||
  e.NODE_ENV==='production')throw Error('ALT0810C19_DISPOSABLE_PG16_ONLY');
}
