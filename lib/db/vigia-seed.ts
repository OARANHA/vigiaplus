// Seed multi-tenant do VigiaPlus.
// Cria: tenants piloto, planos, memberships, LLM providers, reputation targets,
// incidente de exemplo, assinaturas, canais de notificacao.
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { PLANS, PLAN_FEATURES } from '@/lib/tenant/catalog';

async function hashPasswordPlain(text: string): Promise<string> {
  const { hashPassword } = await import('@/lib/password');
  return hashPassword(text);
}

export async function seedVigiaPlus(db: DB): Promise<void> {
  // So criar se nao houver tenants ainda.
  const existing = await db.select({ id: schema.tenants.id }).from(schema.tenants).limit(1);
  if (existing.length > 0) return;

  // --- Planos ---------------------------------------------------------------
  for (const p of PLANS) {
    await db.insert(schema.plans).values({
      key: p.key,
      label: p.label,
      priceBrl: p.price_brl ?? null,
      aiQuotaBrl: p.ai_quota_brl,
      mentionsLimit: p.mentions_limit,
      retentionMonths: p.retention_months,
    }).onConflictDoNothing();
  }
  for (const [planKey, features] of Object.entries(PLAN_FEATURES)) {
    for (const featureKey of features) {
      await db.insert(schema.planFeatures).values({ planKey, featureKey }).onConflictDoNothing();
    }
  }

  // --- Tenants --------------------------------------------------------------
  const [aurora] = await db.insert(schema.tenants).values({
    name: 'Aurora Mobility',
    slug: 'aurora',
    cnpj: '12.345.678/0001-90',
    domain: 'vigia.aurora.com.br',
    planKey: 'empresa',
    status: 'active',
    locale: 'pt-BR',
    retentionDays: 365,
  }).returning();

  const [boreal] = await db.insert(schema.tenants).values({
    name: 'Grupo Boreal',
    slug: 'boreal',
    cnpj: '98.765.432/0001-10',
    domain: 'vigia.boreal.com.br',
    planKey: 'padrao',
    status: 'active',
    locale: 'pt-BR',
    retentionDays: 180,
  }).returning();

  // --- Usuarios -------------------------------------------------------------
  const ownerHash = await hashPasswordPlain('vigia2026');
  const [owner] = await db.insert(schema.users).values({
    name: 'Dono',
    email: 'owner@vigiaplus.local',
    globalRole: 'owner',
    role: 'admin',
    aiEnabled: 1,
    mustChangePassword: 0,
    passwordHash: ownerHash,
    locale: 'pt-BR',
  }).returning();

  const analystHash = await hashPasswordPlain('vigia2026');
  const [analyst] = await db.insert(schema.users).values({
    name: 'Rafael (analista)',
    email: 'rafael@vigiaplus.local',
    globalRole: 'analyst',
    role: 'member',
    aiEnabled: 1,
    mustChangePassword: 0,
    passwordHash: analystHash,
    locale: 'pt-BR',
  }).returning();

  const marinaHash = await hashPasswordPlain('aurora2026');
  const [marina] = await db.insert(schema.users).values({
    name: 'Marina Costa',
    email: 'marina@aurora.com.br',
    globalRole: null,
    role: 'member',
    aiEnabled: 1,
    mustChangePassword: 0,
    passwordHash: marinaHash,
    locale: 'pt-BR',
  }).returning();

  const carlosHash = await hashPasswordPlain('aurora2026');
  const [carlos] = await db.insert(schema.users).values({
    name: 'Carlos Mendes',
    email: 'carlos@aurora.com.br',
    globalRole: null,
    role: 'member',
    aiEnabled: 0,
    mustChangePassword: 0,
    passwordHash: carlosHash,
    locale: 'pt-BR',
  }).returning();

  const helenaHash = await hashPasswordPlain('boreal2026');
  const [helena] = await db.insert(schema.users).values({
    name: 'Helena Prado',
    email: 'helena@boreal.com.br',
    globalRole: null,
    role: 'member',
    aiEnabled: 1,
    mustChangePassword: 0,
    passwordHash: helenaHash,
    locale: 'pt-BR',
  }).returning();

  // --- Memberships ----------------------------------------------------------
  await db.insert(schema.memberships).values([
    { tenantId: aurora.id, userId: marina.id, role: 'client_admin' },
    { tenantId: aurora.id, userId: carlos.id, role: 'client_viewer' },
    { tenantId: boreal.id, userId: helena.id, role: 'client_admin' },
  ]);

  // --- Assinaturas ----------------------------------------------------------
  await db.insert(schema.subscriptions).values([
    { tenantId: aurora.id, gateway: 'manual', planKey: 'empresa', status: 'active' },
    { tenantId: boreal.id, gateway: 'manual', planKey: 'padrao', status: 'active' },
  ]);

  // --- Overrides por contrato -----------------------------------------------
  // Boreal nao comprou playbook de IA.
  await db.insert(schema.tenantFeatures).values({
    tenantId: boreal.id,
    featureKey: 'crisis_playbook',
    enabled: 0,
    reason: 'contrato sem modulo de IA',
  });

  // --- Alvos de reputacao ---------------------------------------------------
  await db.insert(schema.reputationTargets).values([
    { tenantId: aurora.id, name: 'Aurora Mobility', kind: 'brand', score: 72, isBaseline: 1 },
    { tenantId: aurora.id, name: 'Setor de mobilidade urbana', kind: 'market', score: 64 },
    { tenantId: boreal.id, name: 'Grupo Boreal', kind: 'brand', score: 81, isBaseline: 1 },
    { tenantId: boreal.id, name: 'Setor de energia', kind: 'market', score: 70 },
  ]);

  // --- Incidente de exemplo -------------------------------------------------
  const [incident] = await db.insert(schema.incidents).values({
    tenantId: aurora.id,
    title: 'Aumento de comentarios sobre atendimento',
    status: 'monitoring',
    severity: 'low',
    owner: 'Rafael (analista)',
    slaNextAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).returning();

  await db.insert(schema.incidentActions).values({
    incidentId: incident.id,
    actor: 'Rafael (analista)',
    action: 'INCIDENT_OPENED',
    payload: { reason: 'volume de menções negativas acima da baseline' },
  });

  // --- Canais de notificacao ------------------------------------------------
  await db.insert(schema.notificationChannels).values([
    { tenantId: aurora.id, channel: 'whatsapp', destination: 'Marina Costa', verified: 1, active: 1 },
    { tenantId: aurora.id, channel: 'email', destination: 'marina@aurora.com.br', verified: 1, active: 1 },
    { tenantId: boreal.id, channel: 'email', destination: 'helena@boreal.com.br', verified: 1, active: 1 },
  ]);

  // --- LLM Providers (dados, nao union type) --------------------------------
  await db.insert(schema.llmProviders).values([
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyRef: 'ENV:OPENAI_API_KEY',
      model: 'gpt-4o-mini',
      enabled: 1,
      scope: 'global',
      capabilities: ['chat', 'json', 'tools'],
      contextWindow: 128000,
      precoIn: 0.15,
      precoOut: 0.6,
    },
    {
      id: 'azure',
      name: 'Azure OpenAI',
      baseUrl: 'https://vigiaplus.openai.azure.com/v1',
      apiKeyRef: 'ENV:AZURE_API_KEY',
      model: 'gpt-4o',
      enabled: 1,
      scope: 'global',
      capabilities: ['chat', 'json', 'tools', 'vision'],
      contextWindow: 128000,
    },
  ]);

  await db.insert(schema.llmRoutes).values([
    { purpose: 'classification', providerId: 'openai', priority: 0 },
    { purpose: 'playbook', providerId: 'azure', priority: 0 },
  ]);

  // --- Projetos do tenant Aurora -------------------------------------------
  // Reaproveita a estrutura do crises original, mas com tenant_id.
  const [proj] = await db.insert(schema.projects).values({
    tenantId: aurora.id,
    name: 'Aurora - Monitoramento de marca',
    keywords: ['Aurora Mobility', 'Aurora app'],
    languages: ['pt'],
    mode: 'listening',
    ownerId: owner.id,
    visibility: 'private',
  }).returning();

  await db.insert(schema.benchmarkEntities).values([
    { projectId: proj.id, name: 'Aurora Mobility', keywords: ['Aurora Mobility', 'Aurora app'], isOwnBrand: 1 },
    { projectId: proj.id, name: 'Concorrente X', keywords: ['Concorrente X'] },
  ]);

  // --- Faturas --------------------------------------------------------------
  await db.insert(schema.invoices).values([
    { tenantId: aurora.id, amountBrl: 1790, status: 'paid', dueAt: '2026-11-02', paidAt: new Date() },
    { tenantId: boreal.id, amountBrl: 590, status: 'paid', dueAt: '2026-11-10', paidAt: new Date() },
  ]);
}
