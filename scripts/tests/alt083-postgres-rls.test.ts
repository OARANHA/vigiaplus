/**
 * ALT-08.3 — PostgreSQL RLS adversarial test on a disposable CI container.
 * A role-bound test model is deliberately separate from the production schema.
 * NEVER run against an application database or a remote host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const isCi = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
if (!isCi || process.env.ALT083_EPHEMERAL_RLS !== '1'
    || process.env.PGHOST !== '127.0.0.1'
    || process.env.PGDATABASE !== 'vigia_alt081_ci'
    || process.env.PGUSER !== 'vigia_ci'
    || process.env.DATABASE_URL) {
  throw new Error('ALT083 RLS test requires isolated GitHub CI PostgreSQL database');
}
type QueryResult = {rows:Record<string,unknown>[];rowCount:number|null};
type Client = {
  connect():Promise<void>;
  query(text:string,params?:unknown[]):Promise<QueryResult>;
  end():Promise<void>;
};
const { Client: PgClient } = require('pg') as {
  Client: new(options:Record<string,unknown>)=>Client;
};
const connection = {
  host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
};
const admin = new PgClient({...connection,user:'vigia_ci',password:process.env.PGPASSWORD});
const roleA = 'vigia_alt083_a';
const roleB = 'vigia_alt083_b';
const passwordA = randomBytes(20).toString('hex');
const passwordB = randomBytes(20).toString('hex');
const clientA = new PgClient({...connection,user:roleA,password:passwordA});
const clientB = new PgClient({...connection,user:roleB,password:passwordB});
const sandbox = 'alt083_rls_ci';
const table = sandbox+'.events';

test('ALT-08.3 RLS: roles distintas não conseguem ler ou alterar eventos de outros tenants', async () => {
  let connectedA=false, connectedB=false;
  await admin.connect();
  try {
    await admin.query('CREATE ROLE '+roleA+' LOGIN PASSWORD '+"'"+passwordA+"'");
    await admin.query('CREATE ROLE '+roleB+' LOGIN PASSWORD '+"'"+passwordB+"'");
    await admin.query('CREATE SCHEMA '+sandbox);
    await admin.query(`CREATE TABLE ${table} (
      id integer PRIMARY KEY, tenant_id integer NOT NULL, message text NOT NULL
    )`);
    await admin.query(`INSERT INTO ${table} VALUES
      (1,101,'ALT083_PRIVATE_A'),(2,202,'ALT083_PRIVATE_B')`);
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    // Example: tenant is assigned by the DB role, not by user-controlled GUC/headers.
    const scope = `((tenant_id = 101 AND current_user = '${roleA}')
      OR (tenant_id = 202 AND current_user = '${roleB}'))`;
    await admin.query(`CREATE POLICY alt083_tenant_scope ON ${table}
      FOR ALL USING (${scope}) WITH CHECK (${scope})`);
    await admin.query('GRANT USAGE ON SCHEMA '+sandbox+' TO '+roleA+','+roleB);
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON '+table+' TO '+roleA+','+roleB);
    await clientA.connect();connectedA=true;
    await clientB.connect();connectedB=true;
    for (const [client,expectedId,foreignId] of [
      [clientA,1,2],[clientB,2,1],
    ] as const) {
      const role = client===clientA?roleA:roleB;
      const flags=await admin.query(
        'SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=$1',[role]);
      assert.equal(flags.rows.length,1);
      assert.equal(flags.rows[0].rolsuper,false);
      assert.equal(flags.rows[0].rolbypassrls,false);
      assert.equal(flags.rows[0].rolcreaterole,false);
      const visible=await client.query(`SELECT id,tenant_id,message FROM ${table} ORDER BY id`);
      assert.deepEqual(visible.rows.map(r=>Number(r.id)),[expectedId]);
      const forbidden=await client.query(`SELECT * FROM ${table} WHERE id=$1`,[foreignId]);
      assert.equal(forbidden.rows.length,0);
      const changed=await client.query(`UPDATE ${table} SET message='VIOLATION' WHERE id=$1`,[foreignId]);
      assert.equal(changed.rowCount,0);
      const deleted=await client.query(`DELETE FROM ${table} WHERE id=$1`,[foreignId]);
      assert.equal(deleted.rowCount,0);
      await assert.rejects(
        client.query(`INSERT INTO ${table}(id,tenant_id,message) VALUES ($1,$2,'VIOLATION')`,
          [expectedId+10,expectedId===1?202:101]),
        (e:unknown)=>typeof e==='object'&&e!==null&&'code' in e
          && (e as {code:string}).code==='42501',
      );
      await assert.rejects(
        client.query('SET ROLE '+(client===clientA?roleB:roleA)),
      );
      const secondRead=await client.query(`SELECT id FROM ${table}`);
      assert.deepEqual(secondRead.rows.map(r=>Number(r.id)),[expectedId]);
    }
    const present=await admin.query(`SELECT id,message FROM ${table} ORDER BY id`);
    assert.deepEqual(present.rows.map(r=>r.message),['ALT083_PRIVATE_A','ALT083_PRIVATE_B']);
    const catalog=await admin.query(`SELECT c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c WHERE c.oid=$1::regclass`,[table]);
    assert.equal(catalog.rows[0].relrowsecurity,true);
    assert.equal(catalog.rows[0].relforcerowsecurity,true);
    process.stdout.write('ALT083: isolated PostgreSQL RLS role A/B read/write boundary verified\n');
  } finally {
    if (connectedA) await clientA.end();
    if (connectedB) await clientB.end();
    await admin.query('DROP SCHEMA IF EXISTS '+sandbox+' CASCADE');
    await admin.query('DROP ROLE IF EXISTS '+roleA);
    await admin.query('DROP ROLE IF EXISTS '+roleB);
    await admin.end();
  }
});
