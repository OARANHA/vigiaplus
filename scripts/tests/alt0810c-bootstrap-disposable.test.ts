/**
 * ALT-08.10C.3 — PostgreSQL disposable compatibility rehearsal.
 * PGlite IN-MEMORY only. No ENV database URL, no Neon, no migrations on real DB.
 * BEGIN -> all 186 legacy DDL statements -> table-count check -> ROLLBACK.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../../lib/db/bootstrap-snapshot';

async function main(){
 if(process.env.DATABASE_URL || process.env.RLS_DATABASE_URL ||
    process.env.NODE_ENV==='production')
  throw Error('ALT0810C_DISPOSABLE_ONLY');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const source=readFileSync(resolve(root,'lib/db/index.ts'),'utf8');
 const snapshot=readFileSync(resolve(root,'schema/operational-bootstrap/00001_legacy_snapshot.sql'),'utf8');
 const manifest=JSON.parse(readFileSync(resolve(root,'schema/operational-bootstrap/manifest.json'),'utf8')) as BootstrapSnapshotManifest;
 const count=verifyBootstrapSnapshot(source,snapshot,manifest);
 const statements=extractStaticBootstrapDdl(source);
 const db=new PGlite(); // explicitly ephemeral and in-memory
 let transaction=false;
 try{
  await db.query('BEGIN');
  transaction=true;
  for(let i=0;i<statements.length;i++){
   try{await db.query(statements[i]);}
   catch(e){throw Error(`ALT0810C_BOOTSTRAP_STATEMENT_FAILED_${i+1}: ${e instanceof Error?e.message:'unknown'}`)}
  }
  const during=await db.query<{n:number}>(`SELECT count(*)::int AS n
      FROM pg_tables WHERE schemaname='public'`);
  assert.ok(during.rows[0].n>0,'bootstrap did not create operational tables');
  await db.query('ROLLBACK');transaction=false;
  const after=await db.query<{n:number}>(`SELECT count(*)::int AS n
      FROM pg_tables WHERE schemaname='public'`);
  assert.equal(after.rows[0].n,0,'transactional rollback must restore empty catalog');
  console.log(`ALT0810C PGLITE: ${count} legacy DDL statements applied and full ROLLBACK to 0 tables VERIFIED`);
 }finally{
  if(transaction)await db.query('ROLLBACK').catch(()=>{});
  await db.close();
 }
}
main().catch(e=>{console.error('ALT0810C PGLITE NO-GO:',e instanceof Error?e.message:'unknown');process.exitCode=1});
