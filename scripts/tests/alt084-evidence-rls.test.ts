/**
 * ALT-08.4 — teste adversarial sobre as tabelas REAIS da aplicação.
 * Rodar exclusivamente no PostgreSQL descartável da CI após bootstrap ALT-08.1.
 * Sem migração remota, sem políticas ativadas em produção.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {withTenantRlsTransaction, type TenantSqlPool} from '../../lib/tenant/rls-transaction';
import {withAuthenticatedClientRls} from '../../lib/tenant/rls-runtime';
import {selectRlsEvidence} from '../../lib/tenant/rls-evidence';
import {ALT084_EVIDENCE_POLICY_SQL,ALT084_EVIDENCE_ROLLBACK_SQL}
  from '../../lib/tenant/rls-evidence-policies';
import type {TenantContext} from '../../lib/tenant/context';

const env=process.env;
if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
   env.ALT084_EPHEMERAL_RLS!=='1'||env.PGHOST!=='127.0.0.1'||
   env.PGDATABASE!=='vigia_alt081_ci'||env.PGUSER!=='vigia_ci'||
   env.DATABASE_URL)throw Error('ALT084_DISPOSABLE_CI_ONLY');
const require=createRequire(import.meta.url);
const {Pool}=require('pg') as {Pool:new(options:Record<string,unknown>)=>TenantSqlPool&{
  query(s:string,p?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;
  end():Promise<void>
}};
const connection={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci'};
const admin=new Pool({...connection,user:'vigia_ci',password:env.PGPASSWORD,max:2});
const role='vigia_alt084_reader';
const password=randomBytes(22).toString('hex');
const viewer=new Pool({...connection,user:role,password,max:2});
function ctx(t:number):TenantContext {
  return {userId:901,userName:'synthetic',role:'client_viewer',tenantId:t,
    system:false,surface:'app',density:'basico',vocabulary:'leigo',ip:null,
    requestId:'alt084-ci'};
}

test('ALT-08.4: RLS em projects + mentions bloqueia leitura cruzada e não persiste escopo',async()=>{
  let roleCreated=false,policiesInstalled=false;
  try{
    const tables=await admin.query(`SELECT to_regclass('public.projects') AS p,
      to_regclass('public.mentions') AS m`);
    assert.ok(tables.rows[0].p && tables.rows[0].m,
      'app schema must exist in ephemeral PostgreSQL');
    // Guard: não modificar políticas existentes nem herdar políticas externas.
    const existing=await admin.query(`
      SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
        (SELECT count(*) FROM pg_policies WHERE schemaname='public'
          AND tablename=c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('projects','mentions')`);
    assert.equal(existing.rows.length,2);
    for(const row of existing.rows){
      assert.equal(row.relrowsecurity,false);
      assert.equal(row.relforcerowsecurity,false);
      assert.equal(Number(row.policies),0);
    }
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE
      PASSWORD '${password}'`);
    roleCreated=true;
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await admin.query(`GRANT SELECT ON public.projects,public.mentions TO ${role}`);
    const tenants=await admin.query(`INSERT INTO public.tenants(name,slug)
      VALUES ('ALT084 project A','alt084-project-a'),
             ('ALT084 project B','alt084-project-b') RETURNING id`);
    const [ta,tb]=tenants.rows.map(r=>Number(r.id));
    const projects=await admin.query(`INSERT INTO public.projects(tenant_id,name)
      VALUES ($1,'ALT084 A'),($2,'ALT084 B') RETURNING id`,[ta,tb]);
    const [pa,pb]=projects.rows.map(r=>Number(r.id));
    await admin.query(`INSERT INTO public.mentions
      (project_id,source,external_id,title,content,published_at,url)
      VALUES ($1,'rss','alt084-a','Evidence A','A',now(),'https://example.org/a'),
             ($2,'rss','alt084-b','Evidence B','B',now(),'https://example.org/b')`,[pa,pb]);
    for(const statement of ALT084_EVIDENCE_POLICY_SQL)await admin.query(statement);
    policiesInstalled=true;
    const scopeRows=await viewer.query(`SELECT id FROM public.projects
      WHERE id=$1 OR id=$2`,[pa,pb]);
    assert.equal(scopeRows.rows.length,0);
    const outA=await withAuthenticatedClientRls(ctx(ta),viewer,
      q=>selectRlsEvidence(q,12));
    const outB=await withAuthenticatedClientRls(ctx(tb),viewer,
      q=>selectRlsEvidence(q,12));
    assert.deepEqual(outA.map(r=>r.title),['Evidence A']);
    assert.deepEqual(outB.map(r=>r.title),['Evidence B']);
    const firstAfter=await viewer.query('SELECT id FROM public.mentions');
    assert.equal(firstAfter.rows.length,0);
    const count=await withTenantRlsTransaction(viewer,ta,q=>q(
      `SELECT count(*)::int AS n FROM public.mentions
       WHERE project_id=$1 OR project_id=$2`,[pa,pb]));
    assert.equal(Number(count.rows[0].n),1);
    await assert.rejects(withAuthenticatedClientRls(ctx(ta),viewer,async q=>{
      const before=await selectRlsEvidence(q);
      assert.deepEqual(before.map(r=>r.title),['Evidence A']);
      throw Error('ALT084_FORCED_ROLLBACK');
    }),/ALT084_FORCED_ROLLBACK/);
    const noLeak=await viewer.query('SELECT id FROM public.mentions');
    assert.equal(noLeak.rows.length,0);
    const catalog=await admin.query(`SELECT tablename,policyname,cmd FROM pg_policies
      WHERE schemaname='public' AND policyname LIKE 'alt084_%' ORDER BY tablename`);
    assert.deepEqual(catalog.rows.map(r=>r.cmd),['SELECT','SELECT']);
    process.stdout.write('ALT084: projects+mentions real schema RLS A/B scoped evidence verified\n');
  }finally{
    if(policiesInstalled){
      for(const statement of ALT084_EVIDENCE_ROLLBACK_SQL)await admin.query(statement);
    }
    await viewer.end();
    if(roleCreated){
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    }
    await admin.end();
  }
});
