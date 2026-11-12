-- VIGIAPLUS ALT-08.10C.3: FROZEN legacy bootstrap snapshot; DO NOT DEPLOY.
-- Source: lib/db/index.ts const DDL, extracted in original statement order.
-- This snapshot is NOT automatically run by scripts/migrate.ts.
-- Includes legacy data UPDATE; requires full snapshot + rollback review.
-- Schema operational readiness: NO-GO.

-- bootstrap statement 001/186
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]',
    languages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 002/186
CREATE TABLE IF NOT EXISTS benchmark_entities (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    keywords JSONB NOT NULL DEFAULT '[]'
  );

-- bootstrap statement 003/186
CREATE TABLE IF NOT EXISTS mentions (
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
  );

-- bootstrap statement 004/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS all_terms JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 005/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS exclude_terms JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 006/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS countries JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 007/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS telegram_channels JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 008/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brand_voice TEXT;

-- bootstrap statement 009/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS semantic_context TEXT;

-- bootstrap statement 010/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rss_feeds JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 011/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'listening';

-- bootstrap statement 012/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS talkwalker_project TEXT;

-- bootstrap statement 013/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS talkwalker_topics JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 014/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_messages JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 015/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS relevance INTEGER;

-- bootstrap statement 016/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS relevance_reason TEXT;

-- bootstrap statement 017/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS translations JSONB;

-- bootstrap statement 018/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS emotion TEXT;

-- bootstrap statement 019/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'post';

-- bootstrap statement 020/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS article_text TEXT;

-- bootstrap statement 021/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS article_at TIMESTAMPTZ;

-- bootstrap statement 022/186
UPDATE mentions SET kind = 'article'
     WHERE kind = 'post' AND source IN ('googlenews','gdelt','newsapi','rss','upload');

-- bootstrap statement 023/186
CREATE INDEX IF NOT EXISTS mentions_article_todo ON mentions (project_id)
     WHERE kind = 'article' AND article_at IS NULL;

-- bootstrap statement 024/186
ALTER TABLE benchmark_entities ADD COLUMN IF NOT EXISTS is_own_brand INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 025/186
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    ai_enabled INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 026/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 027/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id INTEGER;

-- bootstrap statement 028/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

-- bootstrap statement 029/186
CREATE TABLE IF NOT EXISTS trends (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    n24 INTEGER NOT NULL,
    baseline REAL NOT NULL,
    score REAL NOT NULL,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 030/186
CREATE TABLE IF NOT EXISTS narratives (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    stance TEXT,
    coordinated INTEGER NOT NULL DEFAULT 0,
    accounts JSONB NOT NULL DEFAULT '[]',
    mention_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 031/186
ALTER TABLE narratives ADD COLUMN IF NOT EXISTS mention_ids JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 032/186
CREATE TABLE IF NOT EXISTS influencer_profiles (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    profile_md TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 033/186
CREATE TABLE IF NOT EXISTS content_ideas (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_md TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 034/186
CREATE TABLE IF NOT EXISTS share_links (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 035/186
CREATE TABLE IF NOT EXISTS timeline_events (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_date DATE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    importance INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 036/186
CREATE INDEX IF NOT EXISTS mentions_proj_pub ON mentions (project_id, published_at DESC);

-- bootstrap statement 037/186
CREATE INDEX IF NOT EXISTS mentions_pending ON mentions (project_id) WHERE analyzed_at IS NULL;

-- bootstrap statement 038/186
CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 039/186
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'media',
    message TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 040/186
CREATE TABLE IF NOT EXISTS briefs (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    brief_date DATE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, brief_date)
  );

-- bootstrap statement 041/186
CREATE TABLE IF NOT EXISTS api_usage (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
  );

-- bootstrap statement 042/186
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value JSONB
  );

-- bootstrap statement 043/186
CREATE TABLE IF NOT EXISTS review_sources (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    identifier TEXT NOT NULL,
    label TEXT NOT NULL,
    country TEXT,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 044/186
CREATE TABLE IF NOT EXISTS reviews (
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
  );

-- bootstrap statement 045/186
CREATE INDEX IF NOT EXISTS reviews_proj_pub ON reviews (project_id, published_at DESC);

-- bootstrap statement 046/186
CREATE TABLE IF NOT EXISTS sport_sources (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    competition TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    ticker TEXT,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 047/186
CREATE TABLE IF NOT EXISTS sport_matches (
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
  );

-- bootstrap statement 048/186
CREATE INDEX IF NOT EXISTS sport_matches_proj_date ON sport_matches (project_id, utc_date DESC);

-- bootstrap statement 049/186
CREATE TABLE IF NOT EXISTS stock_prices (
    id SERIAL PRIMARY KEY,
    ticker TEXT NOT NULL,
    date DATE NOT NULL,
    close REAL NOT NULL,
    change_pct REAL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ticker, date)
  );

-- bootstrap statement 050/186
CREATE TABLE IF NOT EXISTS search_interest (
    id SERIAL PRIMARY KEY,
    entity_id INTEGER NOT NULL REFERENCES benchmark_entities(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    value INTEGER NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_id, date)
  );

-- bootstrap statement 051/186
CREATE TABLE IF NOT EXISTS wiki_pages (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 052/186
CREATE TABLE IF NOT EXISTS wiki_edits (
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
  );

-- bootstrap statement 053/186
CREATE INDEX IF NOT EXISTS wiki_edits_page_ts ON wiki_edits (page_id, "timestamp" DESC);

-- bootstrap statement 054/186
CREATE TABLE IF NOT EXISTS import_files (
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
  );

-- bootstrap statement 055/186
CREATE TABLE IF NOT EXISTS import_rows (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    data JSONB NOT NULL
  );

-- bootstrap statement 056/186
CREATE INDEX IF NOT EXISTS import_rows_file ON import_rows (file_id, row_index);

-- bootstrap statement 057/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS used_ai INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 058/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS issues JSONB;

-- bootstrap statement 059/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS sheet_name TEXT;

-- bootstrap statement 060/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'mentions';

-- bootstrap statement 061/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS metric_map JSONB;

-- bootstrap statement 062/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '{}';

-- bootstrap statement 063/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS archetype TEXT;

-- bootstrap statement 064/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS people INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 065/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS custom JSONB;

-- bootstrap statement 066/186
CREATE TABLE IF NOT EXISTS metric_points (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    import_file_id INTEGER,
    entity TEXT NOT NULL,
    metric TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    value REAL NOT NULL,
    dims JSONB NOT NULL DEFAULT '{}'
  );

-- bootstrap statement 067/186
CREATE INDEX IF NOT EXISTS metric_points_proj ON metric_points (project_id, metric, date);

-- bootstrap statement 068/186
CREATE INDEX IF NOT EXISTS metric_points_file ON metric_points (import_file_id);

-- bootstrap statement 069/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS import_file_id INTEGER;

-- bootstrap statement 070/186
CREATE INDEX IF NOT EXISTS mentions_import_file ON mentions (import_file_id);

-- bootstrap statement 071/186
CREATE TABLE IF NOT EXISTS custom_reports (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 30,
    pages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 072/186
CREATE INDEX IF NOT EXISTS custom_reports_project ON custom_reports (project_id);

-- bootstrap statement 073/186
CREATE TABLE IF NOT EXISTS periodic_reports (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cadence TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    pages JSONB NOT NULL DEFAULT '[]',
    provenance JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 074/186
CREATE INDEX IF NOT EXISTS periodic_reports_project ON periodic_reports (project_id, cadence, created_at DESC);

-- bootstrap statement 075/186
CREATE TABLE IF NOT EXISTS studio_charts (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    spec JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 076/186
CREATE INDEX IF NOT EXISTS studio_charts_project ON studio_charts (project_id);

-- bootstrap statement 077/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS country TEXT;

-- bootstrap statement 078/186
CREATE INDEX IF NOT EXISTS mentions_country ON mentions (project_id, country);

-- bootstrap statement 079/186
ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment TEXT;

-- bootstrap statement 080/186
ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment_at TIMESTAMPTZ;

-- bootstrap statement 081/186
ALTER TABLE studio_charts ADD COLUMN IF NOT EXISTS comment_for TEXT;

-- bootstrap statement 082/186
ALTER TABLE import_files ADD COLUMN IF NOT EXISTS constants JSONB NOT NULL DEFAULT '{}';

-- bootstrap statement 083/186
ALTER TABLE periodic_reports ADD COLUMN IF NOT EXISTS pov JSONB;

-- bootstrap statement 084/186
CREATE TABLE IF NOT EXISTS fact_checks (
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
  );

-- bootstrap statement 085/186
CREATE INDEX IF NOT EXISTS fact_checks_project ON fact_checks (project_id, verdict);

-- bootstrap statement 086/186
CREATE TABLE IF NOT EXISTS clinical_trials (
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
  );

-- bootstrap statement 087/186
CREATE INDEX IF NOT EXISTS clinical_trials_project ON clinical_trials (project_id, status);

-- bootstrap statement 088/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS evidence_terms JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 089/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS query_plan JSONB;

-- bootstrap statement 090/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS query_ids JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 091/186
CREATE INDEX IF NOT EXISTS mentions_query_ids ON mentions USING gin (query_ids);

-- bootstrap statement 092/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS enabled_sources JSONB NOT NULL DEFAULT '[]';

-- bootstrap statement 093/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pilot_key TEXT;

-- bootstrap statement 094/186
CREATE UNIQUE INDEX IF NOT EXISTS projects_pilot_unique ON projects (pilot_key) WHERE pilot_key IS NOT NULL;

-- bootstrap statement 095/186
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS canonical_key TEXT;

-- bootstrap statement 096/186
CREATE INDEX IF NOT EXISTS mentions_canonical_key ON mentions (project_id, canonical_key) WHERE canonical_key IS NOT NULL;

-- bootstrap statement 097/186
CREATE TABLE IF NOT EXISTS collection_runs (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "trigger" TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    raw_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
    new_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
    discarded_count INTEGER NOT NULL DEFAULT 0, error TEXT
  );

-- bootstrap statement 098/186
CREATE UNIQUE INDEX IF NOT EXISTS collection_one_active_per_project ON collection_runs(project_id)
    WHERE status IN ('pending', 'running');

-- bootstrap statement 099/186
CREATE INDEX IF NOT EXISTS collection_runs_history ON collection_runs(project_id, started_at DESC);

-- bootstrap statement 100/186
CREATE TABLE IF NOT EXISTS collection_run_sources (
    id SERIAL PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL, origin_url TEXT, query TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending', raw_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0, discarded_count INTEGER NOT NULL DEFAULT 0,
    discard_reasons JSONB NOT NULL DEFAULT '{}', http_status INTEGER, error TEXT,
    duration_ms INTEGER, last_success_at TIMESTAMPTZ
  );

-- bootstrap statement 101/186
CREATE INDEX IF NOT EXISTS collection_sources_history ON collection_run_sources(project_id, source, finished_at DESC);

-- bootstrap statement 102/186
CREATE TABLE IF NOT EXISTS mention_entities (
    id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES benchmark_entities(id) ON DELETE CASCADE,
    UNIQUE (mention_id, entity_id)
  );

-- bootstrap statement 103/186
CREATE INDEX IF NOT EXISTS mention_entities_project ON mention_entities(project_id, entity_id);

-- bootstrap statement 104/186
CREATE TABLE IF NOT EXISTS mention_discoveries (
    id SERIAL PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mention_id INTEGER NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
    source TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT,
    duplicate INTEGER NOT NULL DEFAULT 0, discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, source, external_id)
  );

-- bootstrap statement 105/186
CREATE INDEX IF NOT EXISTS mention_discoveries_mention ON mention_discoveries(mention_id, source);

-- bootstrap statement 106/186
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    cnpj TEXT,
    domain TEXT,
    plan_key TEXT NOT NULL DEFAULT 'trial',
    status TEXT NOT NULL DEFAULT 'active',
    locale TEXT NOT NULL DEFAULT 'pt-BR',
    time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    alert_rate_limit_per_hour INTEGER NOT NULL DEFAULT 100,
    critical_bypass_silence INTEGER NOT NULL DEFAULT 1,
    retention_days INTEGER NOT NULL DEFAULT 180,
    brand_config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 107/186
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- bootstrap statement 108/186
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS alert_rate_limit_per_hour INTEGER NOT NULL DEFAULT 100;

-- bootstrap statement 109/186
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS critical_bypass_silence INTEGER NOT NULL DEFAULT 1;

-- bootstrap statement 110/186
CREATE TABLE IF NOT EXISTS memberships (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'client_viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 111/186
CREATE TABLE IF NOT EXISTS plans (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    price_brl REAL,
    ai_quota_brl REAL NOT NULL DEFAULT 0,
    mentions_limit INTEGER NOT NULL DEFAULT 5000,
    retention_months INTEGER NOT NULL DEFAULT 1
  );

-- bootstrap statement 112/186
CREATE TABLE IF NOT EXISTS plan_features (
    plan_key TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    PRIMARY KEY (plan_key, feature_key)
  );

-- bootstrap statement 113/186
CREATE TABLE IF NOT EXISTS tenant_features (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    feature_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    expires_at TIMESTAMPTZ,
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 114/186
CREATE TABLE IF NOT EXISTS reputation_targets (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'brand',
    keywords JSONB NOT NULL DEFAULT '[]',
    is_baseline INTEGER NOT NULL DEFAULT 0,
    score REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 115/186
CREATE TABLE IF NOT EXISTS incidents (
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
  );

-- bootstrap statement 116/186
CREATE TABLE IF NOT EXISTS incident_actions (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 117/186
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    gateway TEXT NOT NULL DEFAULT 'manual',
    gateway_id TEXT,
    plan_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    vigencia_ate TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 118/186
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    gateway_id TEXT,
    amount_brl REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    due_at DATE,
    paid_at TIMESTAMPTZ,
    pix_qrcode TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 119/186
CREATE TABLE IF NOT EXISTS payment_events (
    id TEXT PRIMARY KEY,
    tenant_id INTEGER,
    type TEXT NOT NULL,
    amount_brl REAL NOT NULL DEFAULT 0,
    gateway TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 120/186
CREATE TABLE IF NOT EXISTS llm_providers (
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
  );

-- bootstrap statement 121/186
CREATE TABLE IF NOT EXISTS llm_routes (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER,
    purpose TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    fallback_ids JSONB NOT NULL DEFAULT '[]',
    temperature REAL NOT NULL DEFAULT 0.2,
    max_tokens INTEGER NOT NULL DEFAULT 1024,
    priority INTEGER NOT NULL DEFAULT 0
  );

-- bootstrap statement 122/186
CREATE TABLE IF NOT EXISTS llm_usage (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    provider_id TEXT,
    purpose TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_brl REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 123/186
CREATE INDEX IF NOT EXISTS llm_usage_tenant ON llm_usage (tenant_id, created_at DESC);

-- bootstrap statement 124/186
CREATE TABLE IF NOT EXISTS notification_channels (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verified_at TIMESTAMPTZ,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 125/186
ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- bootstrap statement 126/186
CREATE TABLE IF NOT EXISTS notification_channel_proofs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL UNIQUE REFERENCES notification_channels(id) ON DELETE CASCADE,
    destination TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  );

-- bootstrap statement 127/186
CREATE INDEX IF NOT EXISTS notification_channel_proofs_tenant ON notification_channel_proofs (tenant_id, channel_id);

-- bootstrap statement 128/186
CREATE TABLE IF NOT EXISTS alert_rules (
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
  );

-- bootstrap statement 129/186
CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    actor TEXT,
    tenant_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    reason TEXT,
    ip TEXT,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 130/186
CREATE INDEX IF NOT EXISTS audit_events_tenant ON audit_events (tenant_id, created_at DESC);

-- bootstrap statement 131/186
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    scopes JSONB NOT NULL DEFAULT '[]',
    rate_limit INTEGER NOT NULL DEFAULT 60,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 132/186
CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client_viewer',
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 133/186
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- bootstrap statement 134/186
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 135/186
CREATE INDEX IF NOT EXISTS password_reset_tokens_user
    ON password_reset_tokens (user_id, created_at DESC);

-- bootstrap statement 136/186
CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
    key_hash TEXT PRIMARY KEY,
    next_allowed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 137/186
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 1;

-- bootstrap statement 138/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS global_role TEXT;

-- bootstrap statement 139/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS view_density TEXT NOT NULL DEFAULT 'basico';

-- bootstrap statement 140/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS view_vocabulary TEXT NOT NULL DEFAULT 'leigo';

-- bootstrap statement 141/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'pt-BR';

-- bootstrap statement 142/186
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 143/186
CREATE INDEX IF NOT EXISTS projects_tenant ON projects (tenant_id);

-- bootstrap statement 144/186
CREATE INDEX IF NOT EXISTS memberships_tenant ON memberships (tenant_id);

-- bootstrap statement 145/186
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);

-- bootstrap statement 146/186
CREATE INDEX IF NOT EXISTS incidents_tenant ON incidents (tenant_id, status);

-- bootstrap statement 147/186
CREATE INDEX IF NOT EXISTS reputation_targets_tenant ON reputation_targets (tenant_id);

-- bootstrap statement 148/186
CREATE INDEX IF NOT EXISTS subscriptions_tenant ON subscriptions (tenant_id, status);

-- bootstrap statement 149/186
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- bootstrap statement 150/186
CREATE TABLE IF NOT EXISTS auth_login_limits (
    key_hash TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 151/186
CREATE INDEX IF NOT EXISTS auth_login_limits_lock ON auth_login_limits (locked_until);

-- bootstrap statement 152/186
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gateway_customer_id TEXT;

-- bootstrap statement 153/186
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ;

-- bootstrap statement 154/186
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- bootstrap statement 155/186
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'manual';

-- bootstrap statement 156/186
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT;

-- bootstrap statement 157/186
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference TEXT;

-- bootstrap statement 158/186
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link TEXT;

-- bootstrap statement 159/186
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;

-- bootstrap statement 160/186
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_id INTEGER,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    kind TEXT NOT NULL,
    event_ref TEXT,
    source_project_id INTEGER,
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    provider_message_id TEXT,
    delivery_state TEXT NOT NULL DEFAULT 'unconfirmed',
    delivery_state_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    delivery_failure_code TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    dedupe_key TEXT NOT NULL,
    error TEXT,
    sla_due_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 161/186
CREATE TABLE IF NOT EXISTS notification_worker_runs (
    run_id TEXT PRIMARY KEY,
    worker TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success','error','timeout')),
    exit_code INTEGER,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 162/186
CREATE INDEX IF NOT EXISTS notification_worker_runs_recent ON notification_worker_runs (finished_at DESC);

-- bootstrap statement 163/186
CREATE TABLE IF NOT EXISTS notification_dispatch_attempts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    delivery_id INTEGER REFERENCES notification_deliveries(id) ON DELETE SET NULL,
    attempt_count INTEGER NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (delivery_id,attempt_count)
  );

-- bootstrap statement 164/186
CREATE INDEX IF NOT EXISTS notification_dispatch_attempts_hour
    ON notification_dispatch_attempts(tenant_id,claimed_at DESC);

-- bootstrap statement 165/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;

-- bootstrap statement 166/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- bootstrap statement 167/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS delivery_state TEXT NOT NULL DEFAULT 'unconfirmed';

-- bootstrap statement 168/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS delivery_state_at TIMESTAMPTZ;

-- bootstrap statement 169/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- bootstrap statement 170/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS delivery_failure_code TEXT;

-- bootstrap statement 171/186
CREATE INDEX IF NOT EXISTS notification_deliveries_provider_email ON notification_deliveries (provider_message_id) WHERE channel='email' AND provider_message_id IS NOT NULL;

-- bootstrap statement 172/186
CREATE TABLE IF NOT EXISTS notification_provider_events (
    id SERIAL PRIMARY KEY,
    webhook_id TEXT NOT NULL UNIQUE,
    provider_message_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    delivery_id INTEGER REFERENCES notification_deliveries(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- bootstrap statement 173/186
CREATE INDEX IF NOT EXISTS notification_provider_events_pending ON notification_provider_events (provider_message_id, recipient) WHERE delivery_id IS NULL;

-- bootstrap statement 174/186
CREATE INDEX IF NOT EXISTS notification_provider_events_delivery ON notification_provider_events (delivery_id, occurred_at DESC);

-- bootstrap statement 175/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS event_ref TEXT;

-- bootstrap statement 176/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS source_project_id INTEGER;

-- bootstrap statement 177/186
CREATE INDEX IF NOT EXISTS notification_deliveries_event_lookup ON notification_deliveries (tenant_id, event_ref);

-- bootstrap statement 178/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- bootstrap statement 179/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS lease_owner TEXT;

-- bootstrap statement 180/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- bootstrap statement 181/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

-- bootstrap statement 182/186
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- bootstrap statement 183/186
CREATE INDEX IF NOT EXISTS notification_deliveries_ready ON notification_deliveries (status, next_attempt_at, lease_expires_at, created_at);

-- bootstrap statement 184/186
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedupe ON notification_deliveries (tenant_id, dedupe_key);

-- bootstrap statement 185/186
CREATE INDEX IF NOT EXISTS notification_deliveries_tenant ON notification_deliveries (tenant_id, created_at DESC);

-- bootstrap statement 186/186
CREATE INDEX IF NOT EXISTS invoices_tenant ON invoices (tenant_id, status, due_at);
