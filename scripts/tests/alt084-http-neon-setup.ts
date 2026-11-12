/**
 * ALT-08.4: prepara APENAS o Neon CI vazio para a rota HTTP autenticada.
 * Nenhuma tabela de produção, não usa DATABASE_URL nem projetos Neon existentes.
 */
import assert from 'node:assert/strict';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {ALT084_EVIDENCE_POLICY_SQL,ALT084_EVIDENCE_ROLLBACK_SQL} from '../../lib/tenant/rls-evidence-policies';

const env=process.env;
const action=process.argv[2];
if(!['setup','cleanup'].includes(action||'')||env.CI!=='true'||
  env.GITHUB_ACTIONS!=='true'||env.NODE_ENV==='production'||
  env.DATABASE_URL||env.DEMO_MODE==='1'||
  env.VIGIA_ALT084_EVIDENCE_MODE!=='ci-read-only'||
  env.VIGIA_RLS_MODE!=='ci-experimental'||
  env.VIGIA_ALT083_DISPOSABLE_CONFIRM!=='YES-EMPTY-NEON-CI-DATABASE'||
  !/^\d+$/.test(env.GITHUB_RUN_ID??''))throw Error('ALT084_HTTP_NEON_DISPOSABLE_ONLY');

async function main():Promise<void>{
await withNeonRlsPool(env,async pool=>{
  const c=await pool.connect();
  try{
    const x=await c.query(`SELECT current_database() AS db,current_user AS username,
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
      (SELECT count(*)::int FROM pg_tables
       WHERE schemaname NOT IN ('pg_catalog','information_schema')
       AND schemaname NOT LIKE 'pg_toast%') AS user_tables`);
    assert.equal(x.rows.length,1);
    assert.match(String(x.rows[0].db),/^vigia_alt083_ci_[a-z0-9_]+$/);
    assert.equal(x.rows[0].privileged,false);
    if(action==='setup'){
      assert.equal(Number(x.rows[0].user_tables),0,'Refuse nonempty Neon DB');
      await c.query('BEGIN');
      try{
        await c.query(`CREATE TABLE public.projects
          (id integer PRIMARY KEY,tenant_id integer NOT NULL,name text NOT NULL)`);
        await c.query(`CREATE TABLE public.mentions
          (id integer PRIMARY KEY,project_id integer NOT NULL REFERENCES public.projects(id),
           title text,source text NOT NULL,url text,published_at timestamptz NOT NULL)`);
        await c.query(`INSERT INTO public.projects VALUES
          (101,1,'ALT084 Synthetic Project A'),(202,2,'ALT084 Synthetic Project B')`);
        await c.query(`INSERT INTO public.mentions VALUES
          (301,101,'ALT084_HTTP_A','rss','https://example.org/a',now()),
          (302,202,'ALT084_HTTP_B','rss','https://example.org/b',now())`);
        for(const s of ALT084_EVIDENCE_POLICY_SQL)await c.query(s);
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e}
      process.stdout.write('ALT084 Neon HTTP synthetic projects+mentions ready\n');
    }else{
      // Fail closed if objects are not exactly the two owned CI tables.
      const n=Number(x.rows[0].user_tables);
      if(n!==0&&n!==2)throw Error('ALT084_REFUSE_CLEANUP_UNEXPECTED_TABLES');
      if(n===2){
        const y=await c.query(`SELECT relname FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'
          AND c.relname IN ('projects','mentions') ORDER BY relname`);
        assert.deepEqual(y.rows.map(r=>r.relname),['mentions','projects']);
        for(const s of ALT084_EVIDENCE_ROLLBACK_SQL)await c.query(s);
        await c.query('DROP TABLE public.mentions');
        await c.query('DROP TABLE public.projects');
      }
      process.stdout.write('ALT084 Neon HTTP disposable tables cleaned\n');
    }
  }finally{c.release()}
});
}
main().catch(error=>{
 console.error('ALT084 Neon disposable setup/cleanup failed:',error instanceof Error?error.message:'unknown');
 process.exitCode=1;
});
