/** Gerador puro de candidata SQL RLS. NUNCA executar automaticamente. */
export type RlsSpec = { table: string; kind: 'tenant' | 'tenant-row' | 'project-child' | 'incident-child' };
export const RLS_CANDIDATE_SPECS: readonly RlsSpec[] = [
  { table: 'tenants', kind: 'tenant-row' },
  ...['memberships','tenant_features','reputation_targets','incidents','projects',
    'subscriptions','invoices','payment_events','notification_channels','alert_rules',
    'notification_deliveries','llm_usage','mcp_tokens','invitations','audit_events']
    .map((table): RlsSpec => ({ table, kind: 'tenant' })),
  { table: 'incident_actions', kind: 'incident-child' },
  ...['benchmark_entities','mentions','collection_runs','collection_run_sources',
    'mention_entities','mention_discoveries','stories','alerts','briefs','api_usage',
    'trends','narratives','influencer_profiles','content_ideas','share_links',
    'timeline_events','review_sources','reviews','sport_sources','sport_matches',
    'stock_prices','search_interest','wiki_pages','wiki_edits','import_files',
    'import_rows','custom_reports','periodic_reports','metric_points',
    'studio_charts','fact_checks','clinical_trials']
    .map((table): RlsSpec => ({ table, kind: 'project-child' })),
];
const tenantSetting = "NULLIF(current_setting('app.tenant_id', true), '')::integer";
function ident(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new Error('identificador SQL inválido');
  return '"' + name + '"';
}
export function rlsExpression(spec: RlsSpec): string {
  const name = ident(spec.table);
  if (spec.kind === 'tenant-row') return name + '.id = ' + tenantSetting;
  if (spec.kind === 'tenant') return name + '.tenant_id = ' + tenantSetting;
  if (spec.kind === 'incident-child') {
    return 'EXISTS (SELECT 1 FROM "incidents" i WHERE i.id = ' + name +
      '.incident_id AND i.tenant_id = ' + tenantSetting + ')';
  }
  return 'EXISTS (SELECT 1 FROM "projects" p WHERE p.id = ' + name +
    '.project_id AND p.tenant_id = ' + tenantSetting + ')';
}
export function createPolicyCandidateSql(specs: readonly RlsSpec[] = RLS_CANDIDATE_SPECS): string {
  return specs.map((spec) => {
    const table = ident(spec.table);
    const expr = rlsExpression(spec);
    return [
      'ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY;',
      'DROP POLICY IF EXISTS "vigia_tenant_isolation" ON ' + table + ';',
      'CREATE POLICY "vigia_tenant_isolation" ON ' + table +
        ' FOR ALL USING (' + expr + ') WITH CHECK (' + expr + ');',
    ].join('\n');
  }).join('\n\n');
}
