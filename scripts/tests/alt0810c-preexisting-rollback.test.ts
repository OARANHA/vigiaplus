/**
 * ALT-08.10C.4: regression for pre-existing permissions and policies.
 * In-memory PGlite only: no remote DATABASE_URL, migration runner or getDb().
 * This is a transactional rehearsal, NOT an authorized migration procedure.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
  type BootstrapSnapshotManifest} from '../../lib/db/bootstrap-snapshot';

type Baseline = {tables:string[];roles:string[];policies:string[];acl:string[];rows:number};

async function main(){
  if(process.env.DATABASE_URL || process.env.RLS_DATABASE_URL ||
    process.env.NODE_ENV==='production' || process.env.PGLITE_DIR)
    throw Error('ALT0810C_PREEXISTING_DISPOSABLE_ONLY');

  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const source=readFileSync(resolve(root,'lib/db/index.ts'),'utf8');
  const snapshot=readFileSync(resolve(root,'schema/operational-bootstrap/00001_legacy_snapshot.sql'),'utf8');
  const manifest=JSON.parse(readFileSync(resolve(root,'schema/operational-bootstrap/manifest.json'),'utf8')) as BootstrapSnapshotManifest;
  verifyBootstrapSnapshot(source,snapshot,manifest);
  const statements=extractStaticBootstrapDdl(source);
  const db=new PGlite();
  const query=async <T>(sql:string):Promise<T[]>=>(await db.query<T>(sql)).rows;
  let open=false;
  try {
    // Explicitly seed objects that belong to an earlier deployment.
    await db.exec(`CREATE ROLE alt0810c_existing_reader NOLOGIN;
      CREATE TABLE public.alt0810c_existing (id integer PRIMARY KEY,tenant integer NOT NULL,secret text NOT NULL);
      INSERT INTO public.alt0810c_existing VALUES (1,771,'keep');
      GRANT SELECT(id,tenant) ON public.alt0810c_existing TO alt0810c_existing_reader;
      ALTER TABLE public.alt0810c_existing ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.alt0810c_existing FORCE ROW LEVEL SECURITY;
      CREATE POLICY alt0810c_existing_policy ON public.alt0810c_existing
        FOR SELECT TO alt0810c_existing_reader USING (tenant=771);`);
    const baseline=async ():Promise<Baseline>=>{
      const tables=await query<{name:string}>(`SELECT tablename AS name FROM pg_tables
        WHERE schemaname='public' ORDER BY tablename`);
      const roles=await query<{name:string}>(`SELECT rolname AS name FROM pg_roles
        WHERE rolname='alt0810c_existing_reader'`);
      const policies=await query<{name:string}>(`SELECT policyname || ':' || cmd || ':' ||
        qual AS name FROM pg_policies WHERE schemaname='public'
        AND tablename='alt0810c_existing' ORDER BY policyname`);
      const acl=await query<{name:string}>(`SELECT coalesce(c.relacl::text,'') || ':' ||
        c.relrowsecurity::text || ':' || c.relforcerowsecurity::text AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='alt0810c_existing'`);
      const rows=await query<{n:number}>(`SELECT count(*)::int AS n FROM public.alt0810c_existing`);
      return {tables:tables.map(x=>x.name),roles:roles.map(x=>x.name),
        policies:policies.map(x=>x.name),acl:acl.map(x=>x.name),rows:rows[0].n};
    };
    const before=await baseline();
    assert.deepEqual(before.tables,['alt0810c_existing']);
    assert.equal(before.roles.length,1);
    assert.equal(before.policies.length,1);
    assert.equal(before.rows,1);

    // Full legacy snapshot: every operation must disappear after ROLLBACK,
    // including effects on a database that was *not* empty before migration.
    await db.query('BEGIN');open=true;
    for(let i=0;i<statements.length;i++){
      try{await db.query(statements[i]);}
      catch(e){throw Error(`ALT0810C_PREEXISTING_STATEMENT_${i+1}: ${String(e)}`)}
    }
    const during=await baseline();
    assert.ok(during.tables.length>before.tables.length);
    await db.query('ROLLBACK');open=false;
    assert.deepEqual(await baseline(),before,'full rollback must preserve pre-existing catalog/ACL/policies/data');

    // Simulated failure halfway through: a migration must be atomic even if
    // a statement or a later validation fails. Never execute subsequent SQL.
    await db.query('BEGIN');open=true;
    const halfway=Math.floor(statements.length/2);
    for(let i=0;i<halfway;i++)await db.query(statements[i]);
    await db.query('ROLLBACK');open=false;
    assert.deepEqual(await baseline(),before,'interrupted migration must preserve pre-existing state');

    console.log(`ALT0810C: ${statements.length} DDL + injected interruption; preexisting ACL/policy/role/data preserved after rollback (PGlite in-memory)`);
  } finally {
    if(open)await db.query('ROLLBACK').catch(()=>{});
    await db.close();
  }
}
main().catch(e=>{console.error('ALT0810C PREEXISTING NO-GO:',e instanceof Error?e.message:String(e));process.exitCode=1});
