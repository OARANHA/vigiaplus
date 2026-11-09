// Catálogo declarativo do VigiaPlus.
// Papéis, superfícies, features e planos são DADOS, não if espalhado pelo código.

export const SURFACES = {
  app: { label: 'Portal do cliente', path: '/app' },
  console: { label: 'Console do dono', path: '/console' },
  analyst: { label: 'Modo analista (Radar completo)', path: '/analyst' },
} as const;

export type Surface = keyof typeof SURFACES;

export const ROLES = {
  owner: {
    label: 'Dono',
    surfaces: ['app', 'console', 'analyst'] as Surface[],
    actions: ['*'] as string[],
  },
  analyst: {
    label: 'Analista',
    surfaces: ['analyst'] as Surface[],
    actions: ['read', 'analyze', 'export', 'write_incident', 'approve_note'] as string[],
  },
  client_admin: {
    label: 'Admin do cliente',
    surfaces: ['app'] as Surface[],
    actions: [
      'read', 'read_plan', 'export', 'write_preferences', 'approve_note', 'invite',
      'read_billing', 'pay_invoice', 'manage_notifications',
    ] as string[],
  },
  client_viewer: {
    label: 'Leitor do cliente',
    surfaces: ['app'] as Surface[],
    actions: ['read', 'read_plan', 'read_billing'] as string[],
  },
} as const;

export type Role = keyof typeof ROLES;

export const FEATURE_CATALOG = [
  { key: 'ai_enabled', label: 'Chamadas de IA', group: 'Nucleo' },
  { key: 'reputation_dual', label: 'Duas reputacoes', group: 'Nucleo' },
  { key: 'crisis_management', label: 'Gestao de crises', group: 'Nucleo' },
  { key: 'crisis_playbook', label: 'Playbook de crise por IA', group: 'IA' },
  { key: 'reports_weekly', label: 'Resumo semanal', group: 'Relatorios' },
  { key: 'reports_monthly', label: 'Relatorio mensal', group: 'Relatorios' },
  { key: 'advanced_mode', label: 'Modo avancado no portal', group: 'Interface' },
  { key: 'whatsapp_alerts', label: 'Avisos por WhatsApp', group: 'Avisos' },
  { key: 'api_access', label: 'API REST', group: 'Integracoes' },
  { key: 'mcp_access', label: 'MCP (assistentes de IA)', group: 'Integracoes' },
  { key: 'analyst_mode', label: 'Modo analista (equipe interna)', group: 'Integracoes' },
  { key: 'white_label', label: 'White-label', group: 'Marca' },
  { key: 'semantic_search', label: 'Busca semantica', group: 'IA' },
] as const;

export const PLANS = [
  { key: 'trial', label: 'Trial', price_brl: 0, ai_quota_brl: 10, mentions_limit: 5000, retention_months: 1 },
  { key: 'padrao', label: 'Padrao', price_brl: 590, ai_quota_brl: 50, mentions_limit: 20000, retention_months: 6 },
  { key: 'empresa', label: 'Empresa', price_brl: 1790, ai_quota_brl: 150, mentions_limit: 150000, retention_months: 12 },
  { key: 'custom', label: 'Custom', price_brl: null, ai_quota_brl: 1000, mentions_limit: 1000000000, retention_months: 24 },
] as const;

export const PLAN_FEATURES: Record<string, string[]> = {
  trial: ['ai_enabled', 'reputation_dual', 'crisis_management', 'reports_weekly'],
  padrao: ['ai_enabled', 'reputation_dual', 'crisis_management', 'crisis_playbook', 'reports_weekly', 'reports_monthly', 'whatsapp_alerts'],
  empresa: ['ai_enabled', 'reputation_dual', 'crisis_management', 'crisis_playbook', 'reports_weekly', 'reports_monthly', 'whatsapp_alerts', 'advanced_mode', 'white_label', 'api_access'],
  custom: FEATURE_CATALOG.map((f) => f.key).filter((k) => k !== 'analyst_mode'),
};

export const FEATURE_KEYS: Set<string> = new Set(FEATURE_CATALOG.map((f) => f.key));

// As 64 paginas do Radar continuam existindo. Inventario de alto nivel.
export const ANALYST_PAGES: Record<string, string[]> = {
  Monitor: ['Dashboard', 'Listening', 'Media', 'Alerts', 'Changes'],
  Analyze: ['Insights', 'Audience', 'Benchmark', 'KPI', 'EMV', 'Studio Graph'],
  Interpret: ['POV', 'Facts & checks', 'Story', 'Ask the data'],
  Create: ['Reports', 'Content Studio', 'Daily brief', 'War Room'],
  Setup: ['Projects', 'Queries', 'Import', 'MCP', 'Sources', 'Budget'],
  Beyond: ['Reviews', 'Sport', 'Wikipedia', 'Podcast', 'Trials'],
};
