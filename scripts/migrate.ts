/**
 * Aplicador de migracoes versionadas (H1 / ADR-10).
 *
 *   npm run migrate          aplica as pendentes
 *   npm run migrate:check    so verifica (usado no CI e no init do container)
 *
 * Regras de engenheiro-chefe:
 *  - cada arquivo e imutavel depois de aplicado (checksum SHA-256 registrado);
 *  - divergencia de checksum => erro, nunca "corrige" silenciosamente;
 *  - aplicacao e ordenada, idempotente e registrada em schema_migrations;
 *  - statements sao executados um a um (Neon HTTP nao aceita multi-statement).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { verifyLegacyMigrationManifest, type LegacyMigrationManifest } from '../lib/db/migration-manifest';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'migrations');
const checkOnly = process.argv.includes('--check');

type Row = { version: string; checksum: string };

function statements(file: string): string[] {
  const raw = readFileSync(file, 'utf8');
  // Remove comentarios de linha antes de dividir: evita ';' dentro de '-- ...'.
  const clean = raw
    .split('\n')
    .map((l) => (l.trimStart().startsWith('--') ? '' : l))
    .join('\n');
  return clean
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checksum(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function verifiedFiles():string[] {
  const files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as LegacyMigrationManifest;
  const map:Record<string,Buffer>={};
  for(const file of files)map[file]=readFileSync(join(dir,file));
  verifyLegacyMigrationManifest(manifest,map);
  return files;
}

/**
 * Modo de VERIFICAÇÃO: não importa getDb, nunca inicializa/seed/migra.
 * BEGIN READ ONLY obriga o PostgreSQL a rejeitar writes acidentais.
 * Para PGlite local, use o verificador offline de manifesto.
 */
async function checkWithoutBootstrap(files:readonly string[]):Promise<void>{
  const url=process.env.DATABASE_URL;
  if(!url)throw Error('MIGRATE_CHECK_READONLY_REQUIRES_DATABASE_URL');
  const parsed=new URL(url);
  if(!['postgresql:','postgres:'].includes(parsed.protocol))
    throw Error('MIGRATE_CHECK_DATABASE_URL_INVALID');
  const {Pool}=await import('@neondatabase/serverless');
  const pool=new Pool({connectionString:url,max:1});
  try{
    const c=await pool.connect();
    try{
      await c.query('BEGIN READ ONLY');
      try{
        const exists=await c.query(`SELECT to_regclass('public.schema_migrations') AS table_name`);
        const rows:Row[]=exists.rows[0]?.table_name
          ?(await c.query('SELECT version,checksum FROM public.schema_migrations ORDER BY version')).rows as Row[]
          :[];
        const applied=new Map(rows.map(x=>[x.version,x.checksum]));
        for(const file of files){
          const previous=applied.get(file);
          const actual=checksum(join(dir,file));
          if(previous && previous!==actual)
            throw Error(`MIGRATE_CHECK_CHECKSUM_MISMATCH:${file}`);
        }
        const pending=files.filter(file=>!applied.has(file));
        if(pending.length){
          console.error(`migrate:check: ${pending.length} pendente(s): ${pending.join(', ')}`);
          process.exitCode=1;
        }else{
          console.log(`migrate:check: ${applied.size} aplicadas, nenhuma pendente (READ ONLY)`);
        }
        await c.query('ROLLBACK');
      }catch(e){await c.query('ROLLBACK');throw e}
    }finally{c.release()}
  }finally{await pool.end()}
}

async function main() {
  const verified=verifiedFiles();
  if(checkOnly){
    await checkWithoutBootstrap(verified);
    return;
  }
  // Fluxo de aplicação LEGADO ainda usa bootstrap; não executar em staging
  // operacional antes de separar ensureSchema e seeds por migração revisada.
  const { getDb }=await import('../lib/db');
  const db = await getDb();
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`));

  const applied = (await db.execute(sql.raw(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  ))) as unknown as { rows?: Row[] } | Row[];
  const rows: Row[] = Array.isArray(applied)
    ? applied
    : (applied as { rows?: Row[] }).rows ?? [];
  const done = new Map(rows.map((r) => [r.version, r.checksum]));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending: string[] = [];
  for (const f of files) {
    const path = join(dir, f);
    const sum = checksum(path);
    const previous = done.get(f);
    if (previous && previous !== sum) {
      throw new Error(
        `Migracao ${f} foi alterada depois de aplicada (checksum divergente). ` +
        `Crie um novo arquivo em vez de editar um ja aplicado.`,
      );
    }
    if (!previous) pending.push(f);
  }

  if (pending.length === 0) {
    console.log(`migrate: ${done.size} migracao(oes) aplicada(s), nenhuma pendente.`);
    return;
  }

  if (checkOnly) {
    console.error(`migrate: ${pending.length} migracao(oes) pendente(s): ${pending.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  for (const f of pending) {
    const path = join(dir, f);
    const list = statements(path);
    for (const stmt of list) {
      await db.execute(sql.raw(stmt));
    }
    await db.execute(sql.raw(
      `INSERT INTO schema_migrations (version, checksum) VALUES ('${f}', '${checksum(path)}')`,
    ));
    console.log(`migrate: aplicada ${f} (${list.length} statements)`);
  }
}

main().then(() => {
  if (!checkOnly) console.log('migrate: concluido.');
}).catch((e) => {
  console.error('migrate: FALHOU —', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
