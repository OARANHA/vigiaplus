/**
 * ALT-08.5 — ensaio por tabela com ROLLBACK real e role de leitura mínima.
 * CI GitHub, PostgreSQL efêmero: NÃO executar contra Neon ou DATABASE_URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {
  ALT085_WAVE1_TABLES,ALT085_READER_ROLE,alt085ApplySql,alt085RollbackSql,
} from '../../lib/tenant/rls-operational-wave1';
import {withTenantRlsTransaction,type TenantSqlPool} from '../../lib/tenant/rls-transaction';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||
   e.ALT085_EPHEMERAL_RLS!=='1'||e.DATABASE_URL||
   e.PGHOST!=='127.0.0.1'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.PGUSER!=='vigia_ci')throw Error('ALT085_DISPOSABLE_POSTGRES_ONLY');
const require=createRequire(import.meta.url);
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type PgPool=TenantSqlPool&{query(s:string,p?:readonly unknown[]):Promise<Result>;end():Promise<void>};
const {Pool}=require('pg') as {Pool:new(options:Record<string,unknown>)=>PgPool};
const db={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci'};
const admin=new Pool({...db,user:'vigia_ci',password:e.PGPASSWORD,max:2});
const password=randomBytes(25).toString('hex');
const reader=new Pool({...db,user:ALT085_READER_ROLE,password,max:2});
const insertSql={
  reputation_targets:'INSERT INTO public.reputation_targets(tenant_id,name) VALUES ($1,$2) RETURNING id',
  incidents:'INSERT INTO public.incidents(tenant_id,title) VALUES ($1,$2) RETURNING id',
  notification_channels:'INSERT INTO public.notification_channels(tenant_id,channel,destination) VALUES ($1,$2,$3) RETURNING id',
  invoices:'INSERT INTO public.invoices(tenant_id,description) VALUES ($1,$2) RETURNING id',
} as const;

test('ALT-08.5: cada tabela preserva isolamento, privilégio mínimo e rollback próprio',async()=>{
  let roleCreated=false;
  const tenantIds:number[]=[];
  try {
    const check=await admin.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
      c.relforcerowsecurity AS forced,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=c.relname) AS policies,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=c.relname
        AND column_name='tenant_id') AS tenant_column
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
      AND c.relkind='r'`,[[...ALT085_WAVE1_TABLES]]);
    assert.equal(check.rows.length,ALT085_WAVE1_TABLES.length);
    for(const row of check.rows){
      assert.equal(row.rls,false,'baseline RLS must be off');
      assert.equal(row.forced,false,'baseline FORCE RLS must be off');
      assert.equal(Number(row.policies),0,'refuse modifying existing policies');
      assert.equal(row.tenant_column,true);
    }
    await admin.query(`CREATE ROLE ${ALT085_READER_ROLE}
      LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION
      PASSWORD '${password}'`);
    roleCreated=true;
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${ALT085_READER_ROLE}`);
    const roleInfo=await admin.query(`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb
       FROM pg_roles WHERE rolname=$1`,[ALT085_READER_ROLE]);
    assert.equal(roleInfo.rows[0].rolsuper,false);
    assert.equal(roleInfo.rows[0].rolbypassrls,false);
    assert.equal(roleInfo.rows[0].rolcreaterole,false);
    assert.equal(roleInfo.rows[0].rolcreatedb,false);
    const t=await admin.query(`INSERT INTO public.tenants(name,slug)
      VALUES ('ALT085 synthetic A','alt085-wave1-a'),
             ('ALT085 synthetic B','alt085-wave1-b') RETURNING id`);
    assert.equal(t.rows.length,2);
    tenantIds.push(...t.rows.map(row=>Number(row.id)));
    const [a,b]=tenantIds;
    for(const table of ALT085_WAVE1_TABLES){
      const rows:number[]=[];
      for(const [tenant,label] of [[a,'ALT085_A'],[b,'ALT085_B']] as const){
        const params=table==='notification_channels'
          ?[tenant,'email',label+'@example.invalid']:[tenant,label];
        const ins=await admin.query(insertSql[table],params);
        rows.push(Number(ins.rows[0].id));
      }
      // Aplicar policy + grants somente nesta tabela; todas as outras intactas.
      for(const statement of alt085ApplySql(table))await admin.query(statement);
      try{
        const baseline=await reader.query(`SELECT id FROM public.${table}
          WHERE id=$1 OR id=$2`,rows);
        assert.deepEqual(baseline.rows,[],'no scope must deny all');
        const own=await withTenantRlsTransaction(reader,a,query=>query(
          `SELECT id FROM public.${table} WHERE id=$1 OR id=$2 ORDER BY id`,rows));
        assert.deepEqual(own.rows.map(row=>Number(row.id)),[rows[0]]);
        const other=await withTenantRlsTransaction(reader,b,query=>query(
          `SELECT id FROM public.${table} WHERE id=$1 OR id=$2 ORDER BY id`,rows));
        assert.deepEqual(other.rows.map(row=>Number(row.id)),[rows[1]]);
        const after=await reader.query(`SELECT id FROM public.${table} WHERE id=$1 OR id=$2`,rows);
        assert.equal(after.rows.length,0,'SET LOCAL leaked');
        await assert.rejects(
          withTenantRlsTransaction(reader,a,query=>query(
            `UPDATE public.${table} SET tenant_id=$1 WHERE id=$2`,[b,rows[0]])),
          /permission denied|42501/i,'SELECT-only role must refuse UPDATE');
        const policy=await admin.query(`SELECT cmd,roles FROM pg_policies
          WHERE schemaname='public' AND tablename=$1`,[table]);
        assert.equal(policy.rows.length,1);
        assert.equal(policy.rows[0].cmd,'SELECT');
        assert.deepEqual(policy.rows[0].roles,[ALT085_READER_ROLE]);
      }finally{
        for(const statement of alt085RollbackSql(table))await admin.query(statement);
      }
      const reverted=await admin.query(`SELECT relrowsecurity AS enabled,
        relforcerowsecurity AS forced FROM pg_class
        WHERE oid=$1::regclass`,['public.'+table]);
      assert.equal(reverted.rows[0].enabled,false);
      assert.equal(reverted.rows[0].forced,false);
      const noPolicy=await admin.query(`SELECT count(*)::int AS total FROM pg_policies
        WHERE schemaname='public' AND tablename=$1`,[table]);
      assert.equal(Number(noPolicy.rows[0].total),0);
      const noGrant=await admin.query(`SELECT has_table_privilege($1,$2,'SELECT') AS allowed`,
        [ALT085_READER_ROLE,'public.'+table]);
      assert.equal(noGrant.rows[0].allowed,false,'GRANT must be rolled back');
      process.stdout.write('ALT085 RLS '+table+': A/B, denied writes, no leak, rollback VERIFIED\n');
    }
  }finally{
    await reader.end();
    // Tabelas de clientes descartáveis têm FK CASCADE para tenants.
    if(tenantIds.length)await admin.query(
      'DELETE FROM public.tenants WHERE id=ANY($1::integer[])',[tenantIds]);
    if(roleCreated){
      await admin.query(`DROP OWNED BY ${ALT085_READER_ROLE}`);
      await admin.query(`DROP ROLE ${ALT085_READER_ROLE}`);
    }
    await admin.end();
  }
});
