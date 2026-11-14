/**
 * ALT-08.5 — catálogo inerte de migração RLS gradual (SEM execução automática).
 *
 * Nunca importar para executar em startup, migrations ou produção.
 * A aplicação atual usa getDb() neon-http e NÃO seleciona este catálogo.
 * Políticas somente SELECT; outras operações negadas por SQL privileges.
 * SQL de rollback pressupõe preflight de tabela SEM RLS/policies preexistentes.
 */
export const ALT085_WAVE1_TABLES = [
  'reputation_targets',
  'incidents',
  'notification_channels',
  'invoices',
] as const;

export type Alt085Wave1Table = typeof ALT085_WAVE1_TABLES[number];
export const ALT085_READER_ROLE = 'vigia_alt085_client_read_ci';

/** Colunas mínimas por consulta de leitura; não expor destinos, cobrança Pix ou payloads. */
export const ALT085_WAVE1_READ_COLUMNS: Readonly<Record<Alt085Wave1Table, readonly string[]>> = {
  reputation_targets:['id','name','kind','score'],
  incidents:['id','title','status','severity'],
  notification_channels:['id','channel','active','verified'],
  invoices:['id','amount_brl','status','due_at'],
};

function quotedTable(table: Alt085Wave1Table): string {
  if (!ALT085_WAVE1_TABLES.includes(table)) throw Error('ALT085_TABLE_NOT_ALLOWLISTED');
  return 'public.' + table;
}
function policyName(table: Alt085Wave1Table): string {
  return 'alt085_read_' + table;
}

/** Aplicação por tabela; no futuro requer dupla revisão humana do inventário. */
export function alt085ApplySql(table: Alt085Wave1Table,role=ALT085_READER_ROLE):readonly string[]{
  if(role!==ALT085_READER_ROLE)throw Error('ALT085_ROLE_NOT_ALLOWLISTED');
  const t=quotedTable(table);
  const columns=ALT085_WAVE1_READ_COLUMNS[table].join(', ');
  return [
    `GRANT SELECT (${columns}) ON TABLE ${t} TO ${role}`,
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${policyName(table)} ON ${t} AS PERMISSIVE FOR SELECT
      TO ${role}
      USING (
        tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer
      )`,
  ];
}

/** Rollback da tabela, ordem inversa; nunca executar sem preflight de baseline. */
export function alt085RollbackSql(table: Alt085Wave1Table,role=ALT085_READER_ROLE):readonly string[]{
  if(role!==ALT085_READER_ROLE)throw Error('ALT085_ROLE_NOT_ALLOWLISTED');
  const t=quotedTable(table);
  const columns=ALT085_WAVE1_READ_COLUMNS[table].join(', ');
  return [
    `DROP POLICY IF EXISTS ${policyName(table)} ON ${t}`,
    `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`,
    `REVOKE SELECT (${columns}) ON TABLE ${t} FROM ${role}`,
  ];
}

/** Política separada por tabela. Falha fechada diante de baseline desconhecido. */
export const ALT085_PRODUCTION_GATE = Object.freeze({
  mode:'plan-only',
  activated:false,
  needs:['migration review','non-bypass role','preflight baseline',
    'tenant authentication','transaction pinning','rollback rehearsed',
    'owner analyst worker authorization','production approval'],
});
