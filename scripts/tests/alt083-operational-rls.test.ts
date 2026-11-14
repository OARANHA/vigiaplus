/**
 * ALT-08.3 — prova RLS na tabela REAL notification_deliveries, somente CI.
 * O teste usa o schema original do produto em PostgreSQL efêmero e roles
 * PostgreSQL exclusivas; não modifica produção ou instala políticas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.ALT083_EPHEMERAL_RLS !== '1'
  || process.env.PGHOST !== '127.0.0.1'
  || process.env.PGDATABASE !== 'vigia_alt081_ci'
  || process.env.PGUSER !== 'vigia_ci'
  || process.env.DATABASE_URL) {
  throw new Error('ALT083: PostgreSQL operational-table RLS only on disposable CI database');
}
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type PgClient={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const require=createRequire(import.meta.url);
const { Client }=require('pg') as {
  Client:new(o:Record<string,unknown>)=>PgClient
};
const conn={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci'};
const admin=new Client({...conn,user:'vigia_ci',password:process.env.PGPASSWORD});
const roles=['alt083_real_a','alt083_real_b'] as const;
const passwords=roles.map(()=>randomBytes(20).toString('hex'));
const clients=roles.map((role,i)=>new Client({...conn,user:role,password:passwords[i]}));
const table='public.notification_deliveries';

test('ALT-08.3: tabela operacional real respeita RLS para dois tenants, inclusive GUC falsificado',async()=>{
  await admin.connect();
  let configured=false;
  const connected:boolean[]=[false,false];
  try {
    const found=await admin.query(
      `SELECT to_regclass('public.notification_deliveries') AS notification_table`);
    assert.ok(found.rows[0].notification_table,
      'ALT081 schema must have been installed in the same disposable job');
    // Cada sessão autentica como role diferente, sem herdar outra role.
    for(const [i,role] of roles.entries()){
      await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD '${passwords[i]}'`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO ${role}`);
    }
    const a=await admin.query(
      `INSERT INTO public.tenants(name,slug) VALUES
         ('ALT083 RLS A', 'alt083-real-a'),
         ('ALT083 RLS B', 'alt083-real-b') RETURNING id`);
    const tenantA=Number(a.rows[0].id),tenantB=Number(a.rows[1].id);
    const deliveries=await admin.query(
      `INSERT INTO ${table}(tenant_id,channel,destination,kind,title,message,status,dedupe_key)
       VALUES ($1,'ledger','internal','test','Tenant A','ALT083_REAL_PRIVATE_A','queued','alt083-real-a'),
              ($2,'ledger','internal','test','Tenant B','ALT083_REAL_PRIVATE_B','queued','alt083-real-b')
       RETURNING id,tenant_id`,[tenantA,tenantB]);
    const [idA,idB]=deliveries.rows.map(row=>Number(row.id));
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    const policy=`((tenant_id = ${tenantA} AND current_user = '${roles[0]}')
      OR (tenant_id = ${tenantB} AND current_user = '${roles[1]}'))`;
    await admin.query(`CREATE POLICY alt083_real_scope ON ${table}
      FOR ALL USING (${policy}) WITH CHECK (${policy})`);
    configured=true;
    for(let i=0;i<2;i++){
      const client=clients[i],role=roles[i];
      await client.connect();connected[i]=true;
      const current=await client.query('SELECT current_user AS role');
      assert.equal(current.rows[0].role,role);
      await assert.rejects(client.query('SET ROLE '+roles[1-i]));
      const expected=i===0?idA:idB,foreign=i===0?idB:idA;
      const visible=await client.query(`SELECT id FROM ${table} ORDER BY id`);
      assert.deepEqual(visible.rows.map(r=>Number(r.id)),[expected]);
      assert.equal((await client.query(`SELECT id FROM ${table} WHERE id=$1`,[foreign])).rows.length,0);
      assert.equal((await client.query(`UPDATE ${table} SET message='CROSS_WRITE' WHERE id=$1`,[foreign])).rowCount,0);
      assert.equal((await client.query(`DELETE FROM ${table} WHERE id=$1`,[foreign])).rowCount,0);
      await assert.rejects(
        client.query(`INSERT INTO ${table}
          (tenant_id,channel,destination,kind,title,message,status,dedupe_key)
           VALUES ($1,'ledger','internal','test','illegal','CROSS_WRITE','queued',$2)`,
          [i===0?tenantB:tenantA,'alt083-cross-'+i]),
        (err:unknown)=>typeof err==='object'&&err!==null
          && 'code' in err && (err as {code:string}).code==='42501');
      // Um token/tenant id arbitrário colocado em GUC não muda a role autenticada.
      await client.query('SELECT set_config($1,$2,false)',[
        'app.tenant_id',String(i===0?tenantB:tenantA)]);
      assert.deepEqual(
        (await client.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(r=>Number(r.id)),
        [expected],
      );
    }
    await admin.query(`DROP POLICY alt083_real_scope ON ${table}`);
    await admin.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    configured=false;
    const after=await admin.query(`SELECT id,message FROM ${table}
      WHERE id=$1 OR id=$2 ORDER BY id`,[idA,idB]);
    assert.deepEqual(after.rows.map(r=>r.message),
      ['ALT083_REAL_PRIVATE_A','ALT083_REAL_PRIVATE_B']);
    process.stdout.write('ALT083: real notification_deliveries table RLS boundaries verified in CI\n');
  } finally {
    for(let i=0;i<2;i++){
      if(connected[i]){
        await clients[i].end();
      }
    }
    if(configured){
      await admin.query(`DROP POLICY IF EXISTS alt083_real_scope ON ${table}`);
      await admin.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
      await admin.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    for(const role of roles){
      await admin.query(`DROP OWNED BY ${role}`).catch(()=>{});
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
    }
    await admin.end();
  }
});
