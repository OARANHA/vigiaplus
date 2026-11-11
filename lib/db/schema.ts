import {
  pgTable, serial, text, integer, real, jsonb, timestamp, date, boolean,
} from 'drizzle-orm/pg-core';

// ===========================================================================
// VigiaPlus — camada multi-tenant (ADR-02, ADR-03, ADR-04)
//
// O tenant_id e a fronteira de confianca. Ele vem da SESSAO autenticada,
// nunca do request. projects ganha tenant_id; toda tabela de dominio ja
// tem project_id (e portanto herda o tenant via projects), mas as tabelas
// novas que nao pendem de um projeto trazem tenant_id diretamente.
// ===========================================================================

/** Um cliente. Cada um tem seu espaco isolado; ninguem ve o do outro. */
/** Limitador de login persistente e compartilhado entre instâncias. Chaves em HMAC. */
export const authLoginLimits = pgTable('auth_login_limits', {
  keyHash: text('key_hash').primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  cnpj: text('cnpj'),
  domain: text('domain'),
  planKey: text('plan_key').notNull().default('trial'),
  status: text('status').notNull().default('active'),
  locale: text('locale').notNull().default('pt-BR'),
  timeZone: text('time_zone').notNull().default('America/Sao_Paulo'),
  alertRateLimitPerHour: integer('alert_rate_limit_per_hour').notNull().default(100),
  criticalBypassSilence: integer('critical_bypass_silence').notNull().default(1),
  retentionDays: integer('retention_days').notNull().default(180),
  brandConfig: jsonb('brand_config').$type<{ logo?: string; color?: string; domain?: string }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Vinculo usuario x tenant x papel. Um usuario pode estar em varios tenants. */
export const memberships = pgTable('memberships', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('client_viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Planos comerciais. */
export const plans = pgTable('plans', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  priceBrl: real('price_brl'),
  aiQuotaBrl: real('ai_quota_brl').notNull().default(0),
  mentionsLimit: integer('mentions_limit').notNull().default(5000),
  retentionMonths: integer('retention_months').notNull().default(1),
});

/** Features inclusas em cada plano. */
export const planFeatures = pgTable('plan_features', {
  planKey: text('plan_key').notNull().references(() => plans.key),
  featureKey: text('feature_key').notNull(),
});

/** Override de feature por tenant (com motivo e expiracao). */
export const tenantFeatures = pgTable('tenant_features', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  enabled: integer('enabled').notNull().default(0),
  reason: text('reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedBy: integer('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Alvos de reputacao: marca vs. mercado, ou marca A vs. marca B. */
export const reputationTargets = pgTable('reputation_targets', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('brand'),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  isBaseline: integer('is_baseline').notNull().default(0),
  score: real('score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Incidentes de crise: o ciclo de vida que faltava. */
export const incidents = pgTable('incidents', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  alertId: integer('alert_id'),
  title: text('title').notNull(),
  status: text('status').notNull().default('monitoring'),
  severity: text('severity').notNull().default('low'),
  owner: text('owner'),
  slaNextAt: timestamp('sla_next_at', { withTimezone: true }),
  playbookApproved: integer('playbook_approved').notNull().default(0),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Acoes do incidente -- append-only, imutavel. */
export const incidentActions = pgTable('incident_actions', {
  id: serial('id').primaryKey(),
  incidentId: integer('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Assinaturas. O estado dirige os entitlements (ADR-07).
 *  gateway/gatewayId/gatewayCustomerId: vínculo com Stripe ou gateway Pix.
 *  graceUntil: janela de dunning antes de suspender o contrato. */
export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  gateway: text('gateway').notNull().default('manual'),
  gatewayId: text('gateway_id'),
  gatewayCustomerId: text('gateway_customer_id'),
  planKey: text('plan_key').notNull(),
  status: text('status').notNull().default('active'),
  vigenciaAte: timestamp('vigencia_ate', { withTimezone: true }),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Faturas. Pix: pixQrcode guarda o copia-e-cola; paymentLink, o checkout Stripe. */
export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  gateway: text('gateway').notNull().default('manual'),
  gatewayId: text('gateway_id'),
  amountBrl: real('amount_brl').notNull().default(0),
  status: text('status').notNull().default('open'),
  description: text('description'),
  reference: text('reference'),
  paymentLink: text('payment_link'),
  pixCopiaCola: text('pix_copia_cola'),
  dueAt: date('due_at'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  pixQrcode: text('pix_qrcode'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Eventos de webhook de pagamento -- idempotentes (A8). */
export const paymentEvents = pgTable('payment_events', {
  id: text('id').primaryKey(),
  tenantId: integer('tenant_id'),
  type: text('type').notNull(),
  amountBrl: real('amount_brl').notNull().default(0),
  gateway: text('gateway').notNull(),
  rawHash: text('raw_hash').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/** LLM Registry: qualquer provedor OpenAI-compatible (ADR-05). */
export const llmProviders = pgTable('llm_providers', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull().default('global'),
  tenantId: integer('tenant_id'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyRef: text('api_key_ref').notNull(),
  model: text('model').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
  contextWindow: integer('context_window'),
  precoIn: real('preco_in'),
  precoOut: real('preco_out'),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  extraHeaders: jsonb('extra_headers'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Roteamento de tarefa -> provedor com fallback. */
export const llmRoutes = pgTable('llm_routes', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id'),
  purpose: text('purpose').notNull(),
  providerId: text('provider_id').notNull(),
  fallbackIds: jsonb('fallback_ids').$type<string[]>().notNull().default([]),
  temperature: real('temperature').notNull().default(0.2),
  maxTokens: integer('max_tokens').notNull().default(1024),
  priority: integer('priority').notNull().default(0),
});

/** Consumo de IA por tenant -- custo atribuivel. */
export const llmUsage = pgTable('llm_usage', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull(),
  providerId: text('provider_id'),
  purpose: text('purpose').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  costBrl: real('cost_brl').notNull().default(0),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Canais de notificacao por tenant. */
export const notificationChannels = pgTable('notification_channels', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  destination: text('destination').notNull(),
  verified: integer('verified').notNull().default(0),
  // Null nos canais legados: o flag antigo isolado não prova posse.
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  active: integer('active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Prova de posse por token temporário. Mantém apenas SHA-256 do segredo. */
export const notificationChannelProofs = pgTable('notification_channel_proofs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: integer('channel_id').notNull().unique()
    .references(() => notificationChannels.id, { onDelete: 'cascade' }),
  destination: text('destination').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Regras de alerta por tenant. */
export const alertRules = pgTable('alert_rules', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  threshold: jsonb('threshold').$type<Record<string, unknown>>().notNull().default({}),
  channels: jsonb('channels').$type<string[]>().notNull().default([]),
  silencioDe: text('silencio_de'),
  silencioAte: text('silencio_ate'),
  slaMinutes: integer('sla_minutes').notNull().default(900),
  active: integer('active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Trilha de auditoria imutavel -- append-only. */
export const auditEvents = pgTable('audit_events', {
  id: serial('id').primaryKey(),
  actor: text('actor'),
  tenantId: integer('tenant_id'),
  action: text('action').notNull(),
  target: text('target'),
  reason: text('reason'),
  ip: text('ip'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tokens MCP por tenant -- read-only, com escopo. */
export const mcpTokens = pgTable('mcp_tokens', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  rateLimit: integer('rate_limit').notNull().default(60),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Convites por e-mail. */
export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('client_viewer'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Recuperação de senha: hash apenas, uso único, não cria sessão. */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Não armazena endereços de e-mail/IP em claro. */
export const passwordResetRateLimits = pgTable('password_reset_rate_limits', {
  keyHash: text('key_hash').primaryKey(),
  nextAllowedAt: timestamp('next_allowed_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Histórico de avisos entregues. dedupeKey garante que uma regra não dispare
 *  duas vezes para o mesmo fato (idempotência do worker-notify). */
export const notificationDeliveries = pgTable('notification_deliveries', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  ruleId: integer('rule_id'),
  channel: text('channel').notNull(),
  destination: text('destination').notNull(),
  kind: text('kind').notNull(),
  eventRef: text('event_ref'),
  sourceProjectId: integer('source_project_id'),
  severity: text('severity').notNull().default('info'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('sent'),
  providerMessageId: text('provider_message_id'),
  // Fato de aceite pelo provedor é separado do resultado de entrega.
  deliveryState: text('delivery_state').notNull().default('unconfirmed'),
  deliveryStateAt: timestamp('delivery_state_at', { withTimezone:true }),
  deliveredAt: timestamp('delivered_at', { withTimezone:true }),
  deliveryFailureCode: text('delivery_failure_code'),
  // ALT-02: tentativas, lease e agendamento na própria outbox, sem filas externas.
  attemptCount: integer('attempt_count').notNull().default(0),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  dedupeKey: text('dedupe_key').notNull(),
  error: text('error'),
  slaDueAt: timestamp('sla_due_at', { withTimezone:true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Livro-razão imutável de CADA tentativa de claim, inclusive retries. */
/** ALT-08: histórico global, operacional, sem destinatários ou payload de alertas. */
export const notificationWorkerRuns = pgTable('notification_worker_runs', {
  runId: text('run_id').primaryKey(),
  worker: text('worker').notNull(),
  startedAt: timestamp('started_at', { withTimezone:true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone:true }).notNull(),
  durationMs: integer('duration_ms').notNull(),
  status: text('status').notNull(),
  exitCode: integer('exit_code'),
  summary: jsonb('summary').$type<Record<string,unknown>>().notNull().default({}),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});

export const notificationDispatchAttempts = pgTable('notification_dispatch_attempts', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id, { onDelete:'cascade' }),
  deliveryId: integer('delivery_id').references(() => notificationDeliveries.id, { onDelete:'set null' }),
  attemptCount: integer('attempt_count').notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone:true }).notNull().defaultNow(),
});

/**
 * Livro-razão imutável de eventos assinados do provedor.
 * UNIQUE(webhook_id) torna o POST idempotente, inclusive em concorrência.
 * Não salvar payload completo, bounce.message, headers nem credenciais.
 */
export const notificationProviderEvents = pgTable('notification_provider_events', {
  id: serial('id').primaryKey(),
  webhookId: text('webhook_id').notNull().unique(),
  providerMessageId: text('provider_message_id').notNull(),
  recipient: text('recipient').notNull(),
  eventType: text('event_type').notNull(),
  occurredAt: timestamp('occurred_at', {withTimezone:true}).notNull(),
  deliveryId: integer('delivery_id').references(() => notificationDeliveries.id, {onDelete:'set null'}),
  receivedAt: timestamp('received_at', {withTimezone:true}).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Fim da camada multi-tenant. O schema original do crises segue abaixo.
// ---------------------------------------------------------------------------

export type Engagement = {
  likes?: number; comments?: number; shares?: number; views?: number;
};

export type Quality = {
  score: number; relevance: number; virality: number;
  risk: 'low' | 'medium' | 'high'; note?: string;
};

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  // VigiaPlus: papel global. owner = dono da plataforma; analyst = equipe interna.
  globalRole: text('global_role'),
  // AI attiva per i progetti di questo utente (admin sempre true).
  // I membri restano "dormienti" finché l'admin non li accende (serve budget).
  aiEnabled: integer('ai_enabled').notNull().default(0),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  // Versione della sessione: incrementarla revoca OGNI cookie emesso prima
  // (cambio password, "esci da tutti i dispositivi"). Incremento 2.
  sessionVersion: integer('session_version').notNull().default(0),
  // VigiaPlus: preferencias de visualizacao (ADR-03) -- NAO afetam permissoes.
  viewDensity: text('view_density').notNull().default('basico'),
  viewVocabulary: text('view_vocabulary').notNull().default('leigo'),
  locale: text('locale').notNull().default('pt-BR'),
  twoFactorEnabled: integer('two_factor_enabled').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type KeyMessage = { id: string; text: string; terms: string[] };

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  // VigiaPlus: tenant_id e a fronteira de confianca (ADR-02).
  tenantId: integer('tenant_id').notNull().default(1),
  name: text('name').notNull(),
  // 'listening' = raccolta automatica da fonti web; 'upload' = ingestion di file
  // (Excel/CSV) caricati dall'utente, nessuno scraping; 'talkwalker' = i dati
  // arrivano dall'API Talkwalker aziendale, unica fonte attiva del progetto.
  mode: text('mode').notNull().default('listening'),
  /** Id del progetto Talkwalker da interrogare (solo mode='talkwalker'). */
  talkwalkerProject: text('talkwalker_project'),
  /** Topic Talkwalker da cui prendere i documenti; vuoto = tutto il progetto. */
  talkwalkerTopics: jsonb('talkwalker_topics').$type<string[]>().notNull().default([]),
  /**
   * Che cosa seguire negli studi clinici: farmaci, condizioni, sponsor.
   * Vuoto = la sezione è spenta. Non si riusano le parole chiave del progetto:
   * "Juventus" o "Bitcoin" in un registro di studi clinici trovano solo rumore.
   */
  evidenceTerms: jsonb('evidence_terms').$type<string[]>().notNull().default([]),
  /**
   * Il piano d'ascolto: concetti e query costruiti dalla richiesta in
   * linguaggio naturale (lib/query-plan). Null = progetto con la vecchia
   * query a tre campi, che resta valida finché il piano non viene salvato.
   */
  queryPlan: jsonb('query_plan').$type<import('@/lib/query-plan').QueryPlan>(),
  enabledSources: jsonb('enabled_sources').$type<string[]>().notNull().default([]),
  pilotKey: text('pilot_key'),
  // Proprietario del progetto (chi lo ha creato); null = legacy/condiviso a tutti
  ownerId: integer('owner_id'),
  // 'private' = solo il proprietario e l'admin; 'shared' = tutto il team lo vede
  visibility: text('visibility').notNull().default('private'),
  // Query booleana: keywords = OR (almeno uno), allTerms = AND (tutti),
  // excludeTerms = NOT (nessuno)
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  allTerms: jsonb('all_terms').$type<string[]>().notNull().default([]),
  excludeTerms: jsonb('exclude_terms').$type<string[]>().notNull().default([]),
  languages: jsonb('languages').$type<string[]>().notNull().default([]),
  // Codici paese ISO (es. IT, US): filtra le fonti news per area geografica
  countries: jsonb('countries').$type<string[]>().notNull().default([]),
  /** Messaggi chiave del progetto: si misura quanto vengono ripresi (pull-through). */
  keyMessages: jsonb('key_messages').$type<KeyMessage[]>().notNull().default([]),
  // Canali Telegram pubblici da sorvegliare (username senza @)
  telegramChannels: jsonb('telegram_channels').$type<string[]>().notNull().default([]),
  // Feed RSS/Atom personalizzati da seguire (URL)
  rssFeeds: jsonb('rss_feeds').$type<string[]>().notNull().default([]),
  // Tono di voce del brand, usato dal Content Studio
  brandVoice: text('brand_voice'),
  // Area semantica: descrizione del tema in linguaggio naturale; genera i
  // termini di ricerca via AI e guida il giudizio di rilevanza (stelle)
  semanticContext: text('semantic_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const benchmarkEntities = pgTable('benchmark_entities', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  name: text('name').notNull(),
  keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
  // 1 = questa entità è "il tuo brand" (il soggetto dell'analisi), non un competitor.
  isOwnBrand: integer('is_own_brand').notNull().default(0),
});

export const mentions = pgTable('mentions', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  url: text('url'),
  title: text('title'),
  content: text('content').notNull().default(''),
  // Articolo di testata o post social? Dedotto dalla fonte (SOURCE_KIND).
  // È la distinzione che separa una rassegna stampa dall'ascolto sociale.
  kind: text('kind').$type<'article' | 'post'>().notNull().default('post'),
  // Testo integrale dell'articolo, estratto dalla pagina. Il feed RSS dà solo
  // titolo e sommario: senza questo non si sa se il tema è il soggetto del pezzo
  // o una citazione di passaggio.
  articleText: text('article_text'),
  // Quando si è TENTATA l'estrazione (anche fallita): evita di riprovare
  // all'infinito su paywall e pagine irraggiungibili.
  articleAt: timestamp('article_at', { withTimezone: true }),
  author: text('author'),
  authorHandle: text('author_handle'),
  community: text('community'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  language: text('language'),
  /**
   * Paese di provenienza (ISO alpha-2 minuscolo), quando si sa.
   *
   * Dichiarato dalla fonte quando la fonte lo dichiara (GDELT), altrimenti
   * dedotto dal dominio nazionale dell'indirizzo (.it, .co.uk). Resta NULL
   * quando non si sa: su una mappa un colore inventato è indistinguibile da
   * uno vero, e la lingua NON è il paese — un post in spagnolo può venire da
   * Madrid come da Città del Messico.
   */
  country: text('country'),
  engagement: jsonb('engagement').$type<Engagement>(),
  engagementScore: real('engagement_score').notNull().default(0),
  reach: integer('reach'),
  sentiment: text('sentiment'),
  sentimentScore: real('sentiment_score'),
  // Emozione dominante (Plutchik-lite): joy/trust/fear/anger/sadness/surprise
  emotion: text('emotion'),
  // Rilevanza AI rispetto al tema del progetto: 1-5 stelle + motivazione breve
  relevance: integer('relevance'),
  relevanceReason: text('relevance_reason'),
  // Traduzioni cache: { it: { title, content }, en: {...} } — mai ritradotte
  translations: jsonb('translations').$type<Record<string, { title?: string; content: string }>>(),
  topics: jsonb('topics').$type<string[]>(),
  entities: jsonb('entities').$type<string[]>(),
  quality: jsonb('quality').$type<Quality>(),
  /**
   * Le colonne del file che non corrispondono a nessun campo di Radar ma che
   * NON vanno perse: pillar editoriale, rubrica, campagna, area semantica.
   * Etichetta scelta dall'utente → valore della riga.
   */
  custom: jsonb('custom').$type<Record<string, string>>(),
  /** Le query del piano che hanno trovato questa menzione. */
  queryIds: jsonb('query_ids').$type<string[]>().notNull().default([]),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
  storyId: integer('story_id'),
  // Da quale file importato proviene questa mention. Senza questo legame non
  // si può rimappare o cancellare un file senza toccare il resto del progetto.
  importFileId: integer('import_file_id'),
  canonicalKey: text('canonical_key'),
});


/** Histórico por projeto, nunca estado global de fontes. */
export const collectionRuns = pgTable('collection_runs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  trigger: text('trigger').notNull().default('manual'),
  status: text('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rawCount: integer('raw_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  discardedCount: integer('discarded_count').notNull().default(0),
  error: text('error'),
});

export const collectionRunSources = pgTable('collection_run_sources', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull(),
  projectId: integer('project_id').notNull(),
  source: text('source').notNull(),
  originUrl: text('origin_url'),
  query: text('query').notNull().default(''),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  rawCount: integer('raw_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  discardedCount: integer('discarded_count').notNull().default(0),
  discardReasons: jsonb('discard_reasons').$type<Record<string, number>>().notNull().default({}),
  httpStatus: integer('http_status'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
});

export const mentionEntities = pgTable('mention_entities', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  mentionId: integer('mention_id').notNull(),
  entityId: integer('entity_id').notNull(),
});

export const mentionDiscoveries = pgTable('mention_discoveries', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').notNull(),
  projectId: integer('project_id').notNull(),
  mentionId: integer('mention_id').notNull(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  url: text('url'),
  duplicate: integer('duplicate').notNull().default(0),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stories = pgTable('stories', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  type: text('type').notNull(),
  severity: text('severity').notNull().default('media'),
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const briefs = pgTable('briefs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  briefDate: date('brief_date').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiUsage = pgTable('api_usage', {
  id: serial('id').primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
});

export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>(),
});

// Trend emergenti: temi la cui velocità di crescita è anomala
export const trends = pgTable('trends', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  topic: text('topic').notNull(),
  n24: integer('n24').notNull(),
  baseline: real('baseline').notNull(),
  score: real('score').notNull(),
  explanation: text('explanation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Narrazioni rilevate (cluster di messaggi che spingono la stessa tesi)
export const narratives = pgTable('narratives', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  stance: text('stance'),
  coordinated: integer('coordinated').notNull().default(0),
  accounts: jsonb('accounts').$type<string[]>().notNull().default([]),
  // Id delle mention che compongono la narrazione (per aprirne i post in Listening).
  mentionIds: jsonb('mention_ids').$type<number[]>().notNull().default([]),
  mentionCount: integer('mention_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Profili AI degli autori influenti + bozza di contatto
export const influencerProfiles = pgTable('influencer_profiles', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  author: text('author').notNull(),
  source: text('source').notNull(),
  profileMd: text('profile_md').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Idee di contenuto generate dal Content Studio
export const contentIdeas = pgTable('content_ideas', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  contentMd: text('content_md').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Link di condivisione read-only con scadenza
export const shareLinks = pgTable('share_links', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Timeline: eventi salienti del settore, estratti giorno per giorno dall'AI
export const timelineEvents = pgTable('timeline_events', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  eventDate: date('event_date').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  importance: integer('importance').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Recensioni — sezione autonoma, volutamente separata da `mentions` e dalla
// pagina Fonti: una recensione non nasce da una ricerca per parole chiave ma
// da un identificatore fisso (un app id, un place id), e porta un dato che il
// resto dell'app non ha — il voto — che È il sentiment, senza bisogno di AI.
// ---------------------------------------------------------------------------

// Una fonte configurata dall'utente: un'app sull'App Store, un luogo su
// Google, o un lotto importato da file. lastFetchedAt vive qui (non su ogni
// recensione) perché è lo stato della FONTE, non del singolo voto raccolto.
export const reviewSources = pgTable('review_sources', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  type: text('type').notNull(), // 'appstore' | 'googleplaces' | 'upload'
  identifier: text('identifier').notNull(), // app id / place id / nome del file importato
  label: text('label').notNull(),
  country: text('country'), // solo appstore: codice a 2 lettere, default 'us'
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable('reviews', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  sourceId: integer('source_id').notNull(),
  externalId: text('external_id').notNull(),
  rating: integer('rating').notNull(), // 1-5, dato di fatto: mai dedotto
  title: text('title'),
  content: text('content').notNull().default(''),
  author: text('author'),
  url: text('url'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sport — altra sezione autonoma, stesso principio delle Recensioni: un
// risultato sportivo non è una menzione, è un fatto con la sua data fissa,
// serve a incrociarlo con quello che l'ascolto già misura (sentiment) e,
// quando la società è quotata, con il prezzo dell'azione — non a inseguirlo
// con una ricerca per parole chiave.
// ---------------------------------------------------------------------------

// Una squadra seguita da un progetto: la competizione serve solo per mostrare
// calendario/classifica nel contesto giusto, la ricerca vera è per team id
// (una squadra gioca più competizioni, es. campionato + coppa europea).
export const sportSources = pgTable('sport_sources', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  competition: text('competition').notNull(), // codice football-data.org: SA, PL, CL, BL1, PD, FL1
  teamId: text('team_id').notNull(), // id squadra football-data.org
  teamName: text('team_name').notNull(),
  ticker: text('ticker'), // simbolo di borsa (es. JUVE.MI) - solo se quotata, opzionale
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sportMatches = pgTable('sport_matches', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  sourceId: integer('source_id').notNull(),
  externalId: text('external_id').notNull(), // id partita football-data.org
  competition: text('competition').notNull(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  homeScore: integer('home_score'), // null finché non giocata
  awayScore: integer('away_score'),
  status: text('status').notNull(), // SCHEDULED | LIVE | FINISHED | POSTPONED | ...
  utcDate: timestamp('utc_date', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// Chiusure giornaliere: una riga per ticker per giorno, non per fonte — più
// progetti che seguono la stessa società condividono lo storico invece di
// duplicare le stesse chiamate (la quota gratuita è troppo stretta per sprecarla).
export const stockPrices = pgTable('stock_prices', {
  id: serial('id').primaryKey(),
  ticker: text('ticker').notNull(),
  date: date('date').notNull(),
  close: real('close').notNull(),
  changePct: real('change_pct'), // variazione vs la chiusura del giorno di borsa precedente
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// Interesse di ricerca (Google Trends, API non ufficiale): una riga per entità
// di benchmark per giorno. Legata a benchmark_entities (non a un ticker come
// stock_prices) perché qui il confronto è nativo — Trends restituisce fino a
// 5 termini nella STESSA richiesta, già scalati l'uno rispetto all'altro
// (100 = picco fra tutti), che è esattamente cosa serve per uno "share of
// search" fra un brand e i suoi competitor.
export const searchInterest = pgTable('search_interest', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  date: date('date').notNull(),
  value: integer('value').notNull(), // 0-100, relativo agli altri termini della stessa richiesta
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// Pagina Wikipedia sorvegliata: chi la modifica e quando spesso anticipa una
// crisi reputazionale (edit war, cancellazioni di sezioni scomode, comparsa
// di account anonimi). Una riga per pagina seguita — un progetto può
// seguirne più di una, come le squadre in Sport.
export const wikiPages = pgTable('wiki_pages', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(), // titolo esatto della pagina, mai scritto a mano dall'utente
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const wikiEdits = pgTable('wiki_edits', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  pageId: integer('page_id').notNull(),
  revId: integer('rev_id').notNull(),
  user: text('user').notNull(),
  isAnon: integer('is_anon').notNull().default(0),
  isMinor: integer('is_minor').notNull().default(0),
  comment: text('comment').notNull().default(''),
  size: integer('size').notNull(),
  sizeDiff: integer('size_diff'), // null se non calcolabile (prima revisione nota)
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Import di file come materiale GREZZO e riutilizzabile.
//
// Il file caricato non viene consumato una volta sola: le sue righe restano in
// archivio intatte, e le mention si DERIVANO dalla mappatura corrente. Cambiare
// l'assegnazione di una colonna significa quindi ri-derivare, non ricaricare —
// ed è per questo che le righe grezze si conservano invece di essere buttate
// dopo l'inserimento.
// ---------------------------------------------------------------------------
export const importFiles = pgTable('import_files', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  filename: text('filename').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  rowCount: integer('row_count').notNull().default(0),
  columns: jsonb('columns').$type<string[]>().notNull().default([]),
  /** Profilo osservato di ogni colonna: tipo, riempimento, campioni. */
  profiles: jsonb('profiles').$type<unknown[]>().notNull().default([]),
  /** Cosa aveva proposto l'AI: si conserva per poter mostrare le motivazioni
   *  anche a distanza di tempo, e per distinguere le scelte del modello da
   *  quelle fatte a mano dall'utente. */
  proposal: jsonb('proposal').$type<unknown[]>(),
  /** Mappatura in vigore: campo di Radar -> nome colonna. Modificabile sempre. */
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  /** uploaded = letto e profilato · mapped = mappatura confermata · imported = mention derivate */
  status: text('status').$type<'uploaded' | 'mapped' | 'imported'>().notNull().default('uploaded'),
  /** Esito dell'ultima derivazione: quante righe sono entrate e cosa è stato scartato. */
  report: jsonb('report').$type<Record<string, number>>(),
  /** Le righe grezze sono state eliminate per liberare spazio (niente più rimappatura). */
  rawPurged: integer('raw_purged').notNull().default(0),
  /** 1 se l'AI ha partecipato alla proposta; 0 se è solo riconoscimento deterministico. */
  usedAi: integer('used_ai').notNull().default(0),
  /** Cosa si è incontrato leggendo il foglio: formule, errori, formule senza valore. */
  issues: jsonb('issues').$type<Record<string, number>>(),
  /** Il foglio da cui viene, quando il file ne ha più d'uno. */
  sheetName: text('sheet_name'),
  /** mentions = righe con un testo · metrics = serie di misure senza testo. */
  kind: text('kind').$type<'mentions' | 'metrics'>().notNull().default('mentions'),
  /** Che tipo di foglio è: da qui nascono gli insight che può dare. */
  archetype: text('archetype'),
  /**
   * Campi che valgono per OGNI riga di questo foglio, e che nel foglio non
   * stanno in nessuna colonna.
   *
   * Il caso vero: quarantatré fogli con le stesse colonne, uno per manager, e
   * il nome del manager scritto solo nel nome del foglio. Senza questo, quel
   * dato — l'unico che rende confrontabili i fogli fra loro — si perde.
   */
  constants: jsonb('constants').$type<Record<string, string>>().notNull().default({}),
  /** Le entità di questo foglio sono persone (personal branding). */
  people: integer('people').notNull().default(0),
  /** Mappatura del foglio di metriche (data, entità, colonne valore, dimensioni). */
  metricMap: jsonb('metric_map').$type<Record<string, unknown>>(),
  /** Colonne conservate ma non mappate: nome colonna → etichetta. */
  extras: jsonb('extras').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  importedAt: timestamp('imported_at', { withTimezone: true }),
});

/** Le celle originali, esattamente come stavano nel file. Mai modificate. */
export const importRows = pgTable('import_rows', {
  id: serial('id').primaryKey(),
  fileId: integer('file_id').notNull(),
  rowIndex: integer('row_index').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
});

// ---------------------------------------------------------------------------
// Report personalizzati.
//
// Un report è una SCALETTA, non un documento: conserva quali grafici l'utente
// ha scelto, in che ordine, e i commenti che ha scritto o fatto scrivere
// all'AI. I numeri non si salvano mai qui — vengono ricalcolati dall'archivio
// a ogni esportazione, così lo stesso report riesportato la settimana dopo
// racconta i dati nuovi invece di fossilizzare quelli vecchi.
// ---------------------------------------------------------------------------
export const customReports = pgTable('custom_reports', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  /** Finestra temporale su cui vengono ricalcolati i dati (giorni). */
  days: integer('days').notNull().default(30),
  /** [{ title, blocks: [{type:'chart',section} | {type:'text',text,ai}] }] */
  pages: jsonb('pages').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Edizioni del report periodico.
//
// A differenza del report personalizzato, qui la scaletta SI CONGELA: un
// numero di luglio deve continuare a dire quello che diceva a luglio, anche
// riaperto a dicembre. È un archivio di ciò che è stato detto, non un modello
// da ricalcolare — ed è per questo che `pages` e `provenance` restano com'erano
// al momento della generazione.
// ---------------------------------------------------------------------------
export const periodicReports = pgTable('periodic_reports', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  /** daily · weekly · biweekly · monthly · quarterly · semiannual · annual */
  cadence: text('cadence').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  pages: jsonb('pages').$type<unknown[]>().notNull().default([]),
  /** Da dove viene la tesi: quando è stata scritta, su che finestra, su quanti dati. */
  provenance: jsonb('provenance').$type<Record<string, unknown>>(),
  /** La TESI usata, congelata: senza, il PDF ristamperebbe quella corrente e
   *  contraddirebbe la nota di provenienza stampata accanto. */
  pov: jsonb('pov').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Punti di metrica.
//
// I database veri non contengono solo post: contengono SERIE. Follower per
// piattaforma, pubblicazioni per mese, engagement medio per manager, audience
// per azienda. Non hanno un testo né un autore — non sono mention, e infilarle
// lì dentro le distruggerebbe.
//
// La forma è volutamente minima e universale: chi, che cosa, quando, quanto, e
// le dimensioni che qualificano il punto. Qualunque foglio di aggregati, largo
// o lungo, si riduce a questo.
// ---------------------------------------------------------------------------
export const metricPoints = pgTable('metric_points', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  /** Da quale file/foglio viene: permette di rifarlo o toglierlo da solo. */
  importFileId: integer('import_file_id'),
  /** Chi: un canale, un manager, un brand. Il foglio stesso, se non c'è colonna. */
  entity: text('entity').notNull(),
  /** Che cosa: "Follower", "Impressions", "Eng. Rate"… */
  metric: text('metric').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  value: real('value').notNull(),
  /** Le dimensioni che qualificano il punto: canale, pillar, azienda, ruolo. */
  dims: jsonb('dims').$type<Record<string, string>>().notNull().default({}),
});

// ---------------------------------------------------------------------------
// I grafici costruiti in Studio Graph.
//
// Si salva la DOMANDA (che campi, che aggregazione, che forma), mai i numeri:
// riaprendo il grafico fra un mese risponde con i dati di quel mese. È la
// stessa scelta del report personalizzato, per la stessa ragione.
// ---------------------------------------------------------------------------
export const studioCharts = pgTable('studio_charts', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  title: text('title').notNull(),
  /** La specifica: sorgente, tipo, assi, aggregazioni, periodo, palette. */
  spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
  /**
   * Il commento scritto dall'AI su questo grafico, e quando.
   *
   * `commentFor` è l'impronta dei numeri che il commento descrive. Quando il
   * grafico viene rieseguito e l'impronta non torna, il commento se ne va: un
   * testo che parla di numeri che non ci sono più non è un commento vecchio,
   * è un commento falso.
   */
  comment: text('comment'),
  commentAt: timestamp('comment_at', { withTimezone: true }),
  commentFor: text('comment_for'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Le verifiche dei fact-checker (Google Fact Check Tools).
//
// Una riga per affermazione verificata, per progetto. Le recensioni di più
// testate sulla stessa affermazione stanno insieme: che due fact-checker
// arrivino a verdetti diversi è un'informazione, non un doppione.
// ---------------------------------------------------------------------------
export type FactReview = {
  publisher: string; site?: string; url: string; title?: string;
  reviewDate?: string; rating: string; language?: string;
};
export type Circulation = {
  total: number; last7: number; prev7: number;
  sources: Record<string, number>;
  sampleIds: number[];
  lastSeen: string | null;
  /** Le parole con cui l'affermazione è stata cercata nelle menzioni. */
  terms: string[];
  at: string;
};
export const factChecks = pgTable('fact_checks', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  claimKey: text('claim_key').notNull(),
  claim: text('claim').notNull(),
  claimant: text('claimant'),
  claimDate: timestamp('claim_date', { withTimezone: true }),
  reviews: jsonb('reviews').$type<FactReview[]>().notNull().default([]),
  /** false | misleading | mixed | true | unverifiable | other */
  verdict: text('verdict').notNull(),
  language: text('language'),
  query: text('query').notNull(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  /** Quanto l'affermazione circola nelle menzioni del progetto. */
  circulation: jsonb('circulation').$type<Circulation>(),
});

// ---------------------------------------------------------------------------
// Gli studi clinici (ClinicalTrials.gov).
// ---------------------------------------------------------------------------
export type TrialNews = {
  total: number; last30: number; sampleIds: number[]; terms: string[]; at: string;
  /** Le stesse misure per ciascun nome cercato (in minuscolo). */
  byTerm?: Record<string, { total: number; last30: number; sampleIds: number[] }>;
};
export const clinicalTrials = pgTable('clinical_trials', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  nctId: text('nct_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  phases: jsonb('phases').$type<string[]>().notNull().default([]),
  studyType: text('study_type'),
  sponsor: text('sponsor'),
  sponsorClass: text('sponsor_class'),
  conditions: jsonb('conditions').$type<string[]>().notNull().default([]),
  interventions: jsonb('interventions').$type<{ type: string; name: string }[]>().notNull().default([]),
  enrollment: integer('enrollment'),
  startDate: text('start_date'),
  completionDate: text('completion_date'),
  firstPosted: text('first_posted'),
  lastUpdate: text('last_update'),
  hasResults: integer('has_results').notNull().default(0),
  countries: jsonb('countries').$type<string[]>().notNull().default([]),
  query: text('query').notNull(),
  /** Quanto le notizie del progetto parlano di questo studio. */
  news: jsonb('news').$type<TrialNews>(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
