// Catálogo declarativo. Papéis, superfícies, features e planos são DADOS.
// Nenhuma destas listas deve virar um `if` espalhado pelo código.

export const SURFACES = {
  app: { label: 'Portal do cliente', path: '/app' },
  console: { label: 'Console do dono', path: '/console' },
  analyst: { label: 'Modo analista (Radar completo)', path: '/analyst' },
};

export const ROLES = {
  owner: {
    label: 'Dono',
    surfaces: ['app', 'console', 'analyst'],
    actions: ['*'],
  },
  analyst: {
    label: 'Analista',
    surfaces: ['analyst'],
    actions: ['read', 'analyze', 'export', 'write_incident', 'approve_note'],
  },
  client_admin: {
    label: 'Admin do cliente',
    surfaces: ['app'],
    actions: ['read', 'read_plan', 'export', 'write_preferences', 'approve_note', 'invite'],
  },
  client_viewer: {
    label: 'Leitor do cliente',
    surfaces: ['app'],
    actions: ['read', 'read_plan'],
  },
};

// As 64 páginas do Radar continuam existindo. Aqui só o inventário de alto nível.
export const ANALYST_PAGES = {
  Monitor: ['Dashboard', 'Listening', 'Media', 'Alerts', 'Changes'],
  Analyze: ['Insights', 'Audience', 'Benchmark', 'KPI', 'EMV', 'Studio Graph'],
  Interpret: ['POV', 'Facts & checks', 'Story', 'Ask the data'],
  Create: ['Reports', 'Content Studio', 'Daily brief', 'War Room'],
  Setup: ['Projects', 'Queries', 'Import', 'MCP', 'Sources', 'Budget'],
  Beyond: ['Reviews', 'Sport', 'Wikipedia', 'Podcast', 'Trials'],
};

export const FEATURE_CATALOG = [
  { key: 'ai_enabled', label: 'Chamadas de IA', group: 'Núcleo' },
  { key: 'reputation_dual', label: 'Duas reputações', group: 'Núcleo' },
  { key: 'crisis_management', label: 'Gestão de crises', group: 'Núcleo' },
  { key: 'crisis_playbook', label: 'Playbook de crise por IA', group: 'IA' },
  { key: 'reports_weekly', label: 'Resumo semanal', group: 'Relatórios' },
  { key: 'reports_monthly', label: 'Relatório mensal', group: 'Relatórios' },
  { key: 'advanced_mode', label: 'Modo avançado no portal', group: 'Interface' },
  { key: 'whatsapp_alerts', label: 'Avisos por WhatsApp', group: 'Avisos' },
  { key: 'api_access', label: 'API REST', group: 'Integrações' },
  { key: 'mcp_access', label: 'MCP (assistentes de IA)', group: 'Integrações' },
  { key: 'analyst_mode', label: 'Modo analista (equipe interna)', group: 'Integrações' },
  { key: 'white_label', label: 'White-label', group: 'Marca' },
  { key: 'semantic_search', label: 'Busca semântica', group: 'IA' },
];

export const PLANS = [
  { key: 'trial', label: 'Trial', price_brl: 0, ai_quota_brl: 10, mentions_limit: 5000, retention_months: 1 },
  { key: 'padrao', label: 'Padrão', price_brl: 590, ai_quota_brl: 50, mentions_limit: 20000, retention_months: 6 },
  { key: 'empresa', label: 'Empresa', price_brl: 1790, ai_quota_brl: 150, mentions_limit: 150000, retention_months: 12 },
  { key: 'custom', label: 'Custom', price_brl: null, ai_quota_brl: 1000, mentions_limit: 1000000000, retention_months: 24 },
];

export const PLAN_FEATURES = {
  trial: ['ai_enabled', 'reputation_dual', 'crisis_management', 'reports_weekly'],
  padrao: ['ai_enabled', 'reputation_dual', 'crisis_management', 'crisis_playbook', 'reports_weekly', 'reports_monthly', 'whatsapp_alerts'],
  empresa: ['ai_enabled', 'reputation_dual', 'crisis_management', 'crisis_playbook', 'reports_weekly', 'reports_monthly', 'whatsapp_alerts', 'advanced_mode', 'white_label', 'api_access'],
  // analyst_mode é privilégio da equipe interna, nunca um entitlement de cliente.
  custom: FEATURE_CATALOG.map((f) => f.key).filter((k) => k !== 'analyst_mode'),
};

export const FEATURE_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));
