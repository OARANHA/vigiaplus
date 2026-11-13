/**
 * ALT-08.10C.10 — VERSIONED, INERT proposed access-control wave.
 * These exact statements are ONLY executed in the isolated CI PostgreSQL
 * fixture. They are not included in migrations/ or the application runner.
 * NEVER execute the statements on Neon, staging or production.
 */
export const ALT0810C10_WAVE1={
 version:'alt0810c10-disposable-roles-v1',
 status:'candidate-only-disposable-ci',
 operationalMigrationAuthorized:false,
 schema:'alt0810c6_roles_wave',
 roles:['alt0810c6_migrator_c10','alt0810c6_tenant_a_c10',
   'alt0810c6_tenant_b_c10','alt0810c6_reader_c10'],
} as const;

const ns=ALT0810C10_WAVE1.schema;
const [migrator,tenantA,tenantB,reader]=ALT0810C10_WAVE1.roles;
const target=`${ns}.evidence`;
const tenantPredicate=(id:number,role:string)=>
 `tenant_id = ${id} AND current_user = '${role}'`;

export const ALT0810C10_UP_SQL=Object.freeze([
 `GRANT USAGE ON SCHEMA ${ns} TO ${tenantA},${tenantB},${reader}`,
 `ALTER TABLE ${target} OWNER TO ${migrator}`,
 `GRANT SELECT(id,tenant_id,label),UPDATE(label) ON ${target} TO ${tenantA},${tenantB}`,
 `GRANT SELECT(id,tenant_id,label) ON ${target} TO ${reader}`,
 `ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY`,
 `ALTER TABLE ${target} FORCE ROW LEVEL SECURITY`,
 `CREATE POLICY alt0810c10_a_select ON ${target} FOR SELECT TO ${tenantA} USING (${tenantPredicate(101,tenantA)})`,
 `CREATE POLICY alt0810c10_a_update ON ${target} FOR UPDATE TO ${tenantA} USING (${tenantPredicate(101,tenantA)}) WITH CHECK (${tenantPredicate(101,tenantA)})`,
 `CREATE POLICY alt0810c10_b_select ON ${target} FOR SELECT TO ${tenantB} USING (${tenantPredicate(202,tenantB)})`,
 `CREATE POLICY alt0810c10_b_update ON ${target} FOR UPDATE TO ${tenantB} USING (${tenantPredicate(202,tenantB)}) WITH CHECK (${tenantPredicate(202,tenantB)})`,
 `CREATE POLICY alt0810c10_reader ON ${target} FOR SELECT TO ${reader} USING (true)`,
 `CREATE INDEX alt0810c10_tenant_idx ON ${target} (tenant_id)`,
] as const);

export const ALT0810C10_DOWN_SQL=Object.freeze([
 `DROP INDEX ${ns}.alt0810c10_tenant_idx`,
 `DROP POLICY alt0810c10_reader ON ${target}`,
 `DROP POLICY alt0810c10_b_update ON ${target}`,
 `DROP POLICY alt0810c10_b_select ON ${target}`,
 `DROP POLICY alt0810c10_a_update ON ${target}`,
 `DROP POLICY alt0810c10_a_select ON ${target}`,
 `ALTER TABLE ${target} NO FORCE ROW LEVEL SECURITY`,
 `ALTER TABLE ${target} DISABLE ROW LEVEL SECURITY`,
 `REVOKE SELECT(id,tenant_id,label) ON ${target} FROM ${reader}`,
 `REVOKE SELECT(id,tenant_id,label),UPDATE(label) ON ${target} FROM ${tenantA},${tenantB}`,
 `ALTER TABLE ${target} OWNER TO vigia_ci`,
 `REVOKE USAGE ON SCHEMA ${ns} FROM ${tenantA},${tenantB},${reader}`,
] as const);

export function assertAlt0810c10DisposableEnv(
 e:Readonly<Record<string,string|undefined>>):void{
 if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||
   e.ALT0810C10_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
   e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
   !!e.DATABASE_URL||!!e.RLS_DATABASE_URL||e.NODE_ENV==='production')
  throw Error('ALT0810C10_DISPOSABLE_POSTGRES_ONLY');
}
