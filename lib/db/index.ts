import { sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';

// Un solo tipo per entrambi i driver: l'API di query drizzle è identica,
// cambia solo il trasporto (Neon HTTP in produzione, PGlite in locale).
export type DB = PgliteDatabase<typeof schema>;

const g = globalThis as unknown as { __socialRadarDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__socialRadarDb) {
    g.__socialRadarDb = init().catch((e) => {
      // Non lasciare in cache una promise fallita: il prossimo tentativo riparte da zero.
      g.__socialRadarDb = undefined;
      throw e;
    });
  }
  return g.__socialRadarDb;
}

async function init(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    const { neon } = await import('@neondatabase/serverless');
    const { drizzle } = await import('drizzle-orm/neon-http');
    db = drizzle(neon(process.env.DATABASE_URL), { schema }) as unknown as DB;
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { mkdirSync } = await import('node:fs');
    const dir = process.env.PGLITE_DIR ?? '.data/pglite';
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzle(client, { schema }) as unknown as DB;
  }
  await ensureSchema(db);
  if (process.env.DEMO_MODE === '1') {
    const { seedDemo } = await import('./demo-seed');
    await seedDemo(db);
  } else {
    await seed(db);
    await seedUsers(db);
  }
  // VigiaPlus: seed multi-tenant (tenants, memberships, planos, LLM, incidentes).
  const { seedVigiaPlus } = await import('./vigia-seed');
  await seedVigiaPlus(db);
  return db;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]',
    languages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS benchmark_entities (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS mentions (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url TEXT,
    title TEXT,
    content TEXT NOT NULL DEFAULT '',
    author TEXT,
    author_handle TEXT,
    community TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    language TEXT,
    engagement JSONB,
    engagement_score REAL NOT NULL DEFAULT 0,
    reach INTEGER,
    sentiment TEXT,
    sentiment_score REAL,
    topics JSONB,
    entities JSONB,
    quality JSONB,
    analyzed_at TIMESTAMPTZ,
    story_id INTEGER,
    UNIQUE (project_id, source, external_id)
  )`,
  // Migrazioni additive per database esistenti
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS all_terms JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS exclude_terms JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS countries JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_channels JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand_voice TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS semantic_context TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS rss_feeds JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'listening'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS talkwalker_project TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS talkwalker_topics JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_messages JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS relevance INTEGER`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS relevance_reason TEXT`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS translations JSONB`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS emotion TEXT`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'post'`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS article_text TEXT`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS article_at TIMESTAMPTZ`,
  // Le mention già in archivio sono nate senza "kind": si assegna dalla fonte,
  // una volta sola (le successive nascono già classificate dall'ingest).
  `UPDATE mentions SET kind = 'article'
     WHERE kind = 'post' AND source IN ('googlenews','gdelt','newsapi','rss','upload')`,
  // Coda di estrazione: gli articoli senza testo ancora da tentare.
  `CREATE INDEX IF NOT EXISTS mentions_article_todo ON mentions (project_id)
     WHERE kind = 'article' AND article_at IS NULL`,
  `ALTER TABLE benchmark_entities ADD COLUMN IF NOT EXISTS is_own_brand INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    ai_enabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id INTEGER`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
  `CREATE TABLE IF NOT EXISTS trends (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    n24 INTEGER NOT NULL,
    baseline REAL NOT NULL,
    score REAL NOT NULL,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS narratives (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    stance TEXT,
    coordinated INTEGER NOT NULL DEFAULT 0,
    accounts JSONB NOT NULL DEFAULT '[]',
    mention_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE narratives ADD COLUMN IF NOT EXISTS mention_ids JSONB NOT NULL DEFAULT '[]'`,
  `CREATE TABLE IF NOT EXISTS influencer_profiles (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    profile_md TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS content_ideas (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_md TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS share_links (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS timeline_events (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_date DATE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    importance INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS mentions_proj_pub ON mentions (project_id, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS mentions_pending ON mentions (project_id) WHERE analyzed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'media',
    message TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS briefs (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    brief_date DATE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, brief_date)
  )`,
  `CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS review_sources (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    identifier TEXT NOT NULL,
    label TEXT NOT NULL,
    country TEXT,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES review_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    title TEXT,
    content TEXT NOT NULL DEFAULT '',
    author TEXT,
    url TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS reviews_proj_pub ON reviews (project_id, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sport_sources (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    competition TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    ticker TEXT,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sport_matches (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sport_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    competition TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    status TEXT NOT NULL,
    utc_date TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS sport_matches_proj_date ON sport_matches (project_id, utc_date DESC)`,
  `CREATE TABLE IF NOT EXISTS stock_prices (
    id SERIAL PRIMARY KEY,
    ticker TEXT NOT NULL,
    date DATE NOT NULL,
    close REAL NOT NULL,
    change_pct REAL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ticker, date)
  )`,
  `CREATE TABLE IF NOT EXISTS search_interest (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL REFERENCES benchmark_entities(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    value INTEGER NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_id, date)
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_pages (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS wiki_edits (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    rev_id INTEGER NOT NULL,
    "user" TEXT NOT NULL,
    is_anon INTEGER NOT NULL DEFAULT 0,
    is_minor INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL,
    size_diff INTEGER,
    tags JSONB NOT NULL DEFAULT '[]',
    "timestamp" TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (page_id, rev_id)
  )`,
  `CREATE INDEX IF NOT EXISTS wiki_edits_page_ts ON wiki_edits (page_id, "timestamp" DESC)`,
  `CREATE TABLE IF NOT EXISTS import_files (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    row_count INTEGER NOT NULL DEFAULT 0,
    columns JSONB NOT NULL DEFAULT '[]',
    profiles JSONB NOT NULL DEFAULT '[]',
    proposal JSONB,
    mapping JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'uploaded',
    report JSONB,
    raw_purged INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    imported_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS import_rows (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    data JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS import_rows_file ON import_rows (file_id, row_index)`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS used_ai INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS issues JSONB`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS sheet_name TEXT`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'mentions'`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS metric_map JSONB`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS archetype TEXT`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS people INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS custom JSONB`,
  `CREATE TABLE IF NOT EXISTS metric_points (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    import_file_id INTEGER,
    entity TEXT NOT NULL,
    metric TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    value REAL NOT NULL,
    dims JSONB NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS metric_points_proj ON metric_points (project_id, metric, date)`,
  `CREATE INDEX IF NOT EXISTS metric_points_file ON metric_points (import_file_id)`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS import_file_id INTEGER`,
  `CREATE INDEX IF NOT EXISTS mentions_import_file ON mentions (import_file_id)`,
  `CREATE TABLE IF NOT EXISTS custom_reports (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 30,
    pages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS custom_reports_project ON custom_reports (project_id)`,
  `CREATE TABLE IF NOT EXISTS periodic_reports (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cadence TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    pages JSONB NOT NULL DEFAULT '[]',
    provenance JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS periodic_reports_project ON periodic_reports (project_id, cadence, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS studio_charts (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    spec JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS studio_charts_project ON studio_charts (project_id)`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS country TEXT`,
  `CREATE INDEX IF NOT EXISTS mentions_country ON mentions (project_id, country)`,
  `ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment TEXT`,
  `ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment_at TIMESTAMPTZ`,
  `ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment_for TEXT`,
  `ALTER TABLE import_files ADD COLUMN IF NOT EXISTS constants JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE periodic_reports ADD COLUMN IF NOT EXISTS pov JSONB`,
  // Verifiche dei fact-checker e studi clinici: fatti con una data e una
  // fonte, non menzioni da interpretare (lib/factcheck, lib/trials).
  `CREATE TABLE IF NOT EXISTS fact_checks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    claim_key TEXT NOT NULL,
    claim TEXT NOT NULL,
    claimant TEXT,
    claim_date TIMESTAMPTZ,
    reviews JSONB NOT NULL DEFAULT '[]',
    verdict TEXT NOT NULL,
    language TEXT,
    query TEXT NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    circulation JSONB,
    UNIQUE (project_id, claim_key)
  )`,
  `CREATE INDEX IF NOT EXISTS fact_checks_project ON fact_checks (project_id, verdict)`,
  `CREATE TABLE IF NOT EXISTS clinical_trials (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    nct_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    phases JSONB NOT NULL DEFAULT '[]',
    study_type TEXT,
    sponsor TEXT,
    sponsor_class TEXT,
    conditions JSONB NOT NULL DEFAULT '[]',
    interventions JSONB NOT NULL DEFAULT '[]',
    enrollment INTEGER,
    start_date TEXT,
    completion_date TEXT,
    first_posted TEXT,
    last_update TEXT,
    has_results INTEGER NOT NULL DEFAULT 0,
    countries JSONB NOT NULL DEFAULT '[]',
    query TEXT NOT NULL,
    news JSONB,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, nct_id)
  )`,
  `CREATE INDEX IF NOT EXISTS clinical_trials_project ON clinical_trials (project_id, status)`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS evidence_terms JSONB NOT NULL DEFAULT '[]'`,
  // Il piano d'ascolto e le query che hanno trovato ogni menzione.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS query_plan JSONB`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS query_ids JSONB NOT NULL DEFAULT '[]'`,
  `CREATE INDEX IF NOT EXISTS mentions_query_ids ON mentions USING gin (query_ids)`,
  // VigiaElus: migrations incrementais no mecanismo já existente.
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS enabled_sources JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS pilot_key TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_pilot_unique ON projects (pilot_key) WHERE pilot_key IS NOT NULL`,
  `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS canonical_key TEXT`,
  `CREATE INDEX IF NOT EXISTS mentions_canonical_key ON mentions (project_id, canonical_key) WHERE canonical_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS collection_runs (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "trigger" TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    raw_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
    discarded_count INTEGER NOT NULL DEFAULT 0, error TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS collection_one_active_per_project ON collection_runs(project_id)
    WHERE status IN ('pending', 'running')`,
  `CREATE INDEX IF NOT EXISTS collection_runs_history ON collection_runs(project_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS collection_run_sources (
    id SERIAL PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL, origin_url TEXT, query TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending', raw_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0, discarded_count INTEGER NOT NULL DEFAULT 0,
    discard_reasons JSONB NOT NULL DEFAULT '{}', http_status INTEGER, error TEXT,
    duration_ms INTEGER, last_success_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS collection_sources_history ON collection_run_sources(project_id, source, finished_at DESC)`,
  `CREATE TABLE IF NOT EXISTS mention_entities (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES benchmark_entities(id) ON DELETE CASCADE,
    UNIQUE (mention_id, entity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS mention_entities_project ON mention_entities(project_id, entity_id)`,
  `CREATE TABLE IF NOT EXISTS mention_discoveries (
    id SERIAL PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    source TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT,
    duplicate INTEGER NOT NULL DEFAULT 0, discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, source, external_id)
  )`,
  `CREATE INDEX IF NOT EXISTS mention_discoveries_mention ON mention_discoveries(mention_id, source)`,
  // ====================================================================
  // VigiaPlus — camada multi-tenant (DDL aditivo, nao destrutivo)
  // ====================================================================
  `CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    cnpj TEXT,
    domain TEXT,
    plan_key TEXT NOT NULL DEFAULT 'trial',
    status TEXT NOT NULL DEFAULT 'active',
    locale TEXT NOT NULL DEFAULT 'pt-BR',
    retention_days INTEGER NOT NULL DEFAULT 180,
    brand_config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'client_viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS plans (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    price_brl REAL,
    ai_quota_brl REAL NOT NULL DEFAULT 0,
    mentions_limit INTEGER NOT NULL DEFAULT 5000,
    retention_months INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS plan_features (
    plan_key TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    PRIMARY KEY (plan_key, feature_key)
  )`,
  `CREATE TABLE IF NOT EXISTS tenant_features (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    expires_at TIMESTAMPTZ,
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS reputation_targets (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'brand',
    keywords JSONB NOT NULL DEFAULT '[]',
    is_baseline INTEGER NOT NULL DEFAULT 0,
    score REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_id INTEGER,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'monitoring',
    severity TEXT NOT NULL DEFAULT 'low',
    owner TEXT,
    sla_next_at TIMESTAMPTZ,
    playbook_approved INTEGER NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS incident_actions (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    gateway TEXT NOT NULL DEFAULT 'manual',
    gateway_id TEXT,
    plan_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    vigencia_ate TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    gateway_id TEXT,
    amount_brl REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    due_at DATE,
    paid_at TIMESTAMPTZ,
    pix_qrcode TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER,
    type TEXT NOT NULL,
    amount_brl REAL NOT NULL DEFAULT 0,
    gateway TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    tenant_id INTEGER,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_ref TEXT NOT NULL,
    model TEXT NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]',
    context_window INTEGER,
    preco_in REAL,
    preco_out REAL,
    timeout_ms INTEGER NOT NULL DEFAULT 5000,
    extra_headers JSONB,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS llm_routes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER,
    purpose TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    fallback_ids JSONB NOT NULL DEFAULT '[]',
    temperature REAL NOT NULL DEFAULT 0.2,
    max_tokens INTEGER NOT NULL DEFAULT 1024,
    priority INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS llm_usage (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    provider_id TEXT,
    purpose TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_brl REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS llm_usage_tenant ON llm_usage (tenant_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_channels (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    threshold JSONB NOT NULL DEFAULT '{}',
    channels JSONB NOT NULL DEFAULT '[]',
    silencio_de TEXT,
    silencio_ate TEXT,
    sla_minutes INTEGER NOT NULL DEFAULT 900,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    actor TEXT,
    tenant_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    reason TEXT,
    ip TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS audit_events_tenant ON audit_events (tenant_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS mcp_tokens (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    scopes JSONB NOT NULL DEFAULT '[]',
    rate_limit INTEGER NOT NULL DEFAULT 60,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client_viewer',
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Colunas VigiaPlus aditivas nas tabelas existentes
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS view_density TEXT NOT NULL DEFAULT 'basico'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS view_vocabulary TEXT NOT NULL DEFAULT 'leigo'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'pt-BR'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS projects_tenant ON projects (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_tenant ON memberships (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id)`,
  `CREATE INDEX IF NOT EXISTS incidents_tenant ON incidents (tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS reputation_targets_tenant ON reputation_targets (tenant_id)`,
  `CREATE INDEX IF NOT EXISTS subscriptions_tenant ON subscriptions (tenant_id, status)`,
  `CREATE TABLE IF NOT EXISTS auth_login_limits (
    key_hash TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS auth_login_limits_lock ON auth_login_limits (locked_until)`,
  // ---- H2/H3: cobranca, dunning e historico de avisos -------------------
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gateway_customer_id TEXT`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ`,
  `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference TEXT`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link TEXT`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id INTEGER,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    dedupe_key TEXT NOT NULL,
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedupe ON notification_deliveries (tenant_id, dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_tenant ON notification_deliveries (tenant_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS invoices_tenant ON invoices (tenant_id, status, due_at)`,
];

async function ensureSchema(db: DB) {
  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
  }
}

// Demo project on first run: the user edits it from Settings.
async function seed(db: DB) {
  const existing = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1);
  if (existing.length > 0) return;
  const [proj] = await db.insert(schema.projects).values({
    name: 'Artificial Intelligence',
    keywords: ['artificial intelligence', 'generative AI'],
    languages: ['en'],
  }).returning();
  await db.insert(schema.benchmarkEntities).values([
    { projectId: proj.id, name: 'OpenAI', keywords: ['OpenAI', 'ChatGPT', 'GPT-5'] },
    { projectId: proj.id, name: 'Anthropic', keywords: ['Anthropic', 'Claude'] },
    { projectId: proj.id, name: 'Google', keywords: ['Gemini', 'Google DeepMind', 'DeepMind'] },
    { projectId: proj.id, name: 'Meta', keywords: ['Meta AI', 'Llama'] },
  ]);
}

// Amministratore iniziale, creato al primo avvio se il database è vuoto.
// Configuralo con le variabili d'ambiente ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
// Se non le imposti, viene creato un admin di default con password nota: in quel
// caso l'app OBBLIGA a cambiarla al primo accesso. Nuovi membri si aggiungono
// dalla UI (Impostazioni → Team), non serve toccare il codice.
function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const name = process.env.ADMIN_NAME || 'Admin';
  // Password di default (nessuna ADMIN_PASSWORD impostata) => forza il cambio.
  const mustChange = process.env.ADMIN_PASSWORD ? 0 : 1;
  return { name, email, password, mustChange };
}

async function seedUsers(db: DB) {
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existing.length > 0) return;

  const { hashPassword } = await import('@/lib/password');
  const a = seedAdmin();
  const [admin] = await db.insert(schema.users).values({
    name: a.name, email: a.email, role: 'admin',
    aiEnabled: 1, mustChangePassword: a.mustChange,
    passwordHash: hashPassword(a.password),
  }).returning();

  // I progetti già esistenti (creati prima del multi-utente) vanno all'admin
  if (admin) {
    await db.execute(sql`UPDATE projects SET owner_id = ${admin.id} WHERE owner_id IS NULL`);
  }
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.meta).where(sql`${schema.meta.key} = ${key}`);
  return rows.length ? (rows[0].value as T) : null;
}

export async function setMeta(key: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.meta).values({ key, value })
    .onConflictDoUpdate({ target: schema.meta.key, set: { value } });
}
