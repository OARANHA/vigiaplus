/**
 * Somente desenvolvimento local: dados rotulados como exemplos e credenciais
 * fornecidas via variáveis privadas. Nunca executa com banco remoto.
 *
 * node --env-file=.env.local --import tsx scripts/dev/seed-functional-preview.ts
 */
import { eq, and } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import {
  users, tenants, memberships, projects, reputationTargets,
  mentions, incidents, subscriptions,
} from '../../lib/db/schema';
import { hashPassword } from '../../lib/password';

function checkLocalOnly() {
  const env = process.env;
  if (env.NODE_ENV === 'production' || env.DATABASE_URL ||
      env.DEMO_MODE === '1' || env.LOCAL_PREVIEW !== '1' ||
      !env.PGLITE_DIR?.replaceAll('\\','/').includes('.data/functional-preview') ||
      !env.APP_URL?.startsWith('http://127.0.0.1:3199')) {
    throw new Error('Recusado: fixture restrita a PGlite local e LOCAL_PREVIEW=1');
  }
  for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'LOCAL_CLIENT_PASSWORD', 'LOCAL_CLIENT_B_PASSWORD']) {
    const value = env[key];
    if (!value || value.length < 12) throw new Error('Credencial local ausente ou curta: ' + key);
  }
}

async function main() {
  checkLocalOnly();
  const db = await getDb();
  const ownerEmail = process.env.ADMIN_EMAIL!.trim().toLowerCase();
  const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));
  if (!owner || owner.globalRole !== 'owner') throw new Error('Proprietário inicial não criado');
  // Apenas na fixture LOCAL, não na rotina de bootstrap geral.
  await db.update(users).set({ mustChangePassword: 0 }).where(eq(users.id, owner.id));

  const specs = [
    { slug:'exemplo-alfa', name:'Organização Exemplo · Alfa',
      email:'cliente-alfa@vigiaplus.local', password:process.env.LOCAL_CLIENT_PASSWORD!,
      title:'SIMULAÇÃO — Publicação de exemplo do cliente Alfa' },
    { slug:'exemplo-beta', name:'Organização Exemplo · Beta',
      email:'cliente-beta@vigiaplus.local', password:process.env.LOCAL_CLIENT_B_PASSWORD!,
      title:'SIMULAÇÃO — Publicação de exemplo do cliente Beta' },
  ];
  for (const spec of specs) {
    await db.insert(tenants).values({
      name: spec.name, slug: spec.slug, planKey: 'trial', status: 'active', locale: 'pt-BR',
    }).onConflictDoNothing();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, spec.slug));
    if (!tenant) throw new Error('Falha ao criar tenant local');

    await db.insert(users).values({
      name: 'Cliente de teste · ' + spec.slug.split('-')[1].toUpperCase(),
      email: spec.email, passwordHash: hashPassword(spec.password),
      role: 'member', globalRole: null, aiEnabled: 0, mustChangePassword: 0,
      locale: 'pt-BR',
    }).onConflictDoNothing();
    const [user] = await db.select().from(users).where(eq(users.email, spec.email));
    if (!user) throw new Error('Falha ao criar usuário local');

    const [membership] = await db.select().from(memberships)
      .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, user.id)));
    if (!membership) await db.insert(memberships).values({
      tenantId: tenant.id, userId: user.id, role: 'client_admin',
    });

    const existing = await db.select().from(projects).where(eq(projects.tenantId, tenant.id));
    let project = existing[0];
    if (!project) {
      [project] = await db.insert(projects).values({
        name: 'Monitoramento ilustrativo · ' + spec.slug.split('-')[1],
        tenantId: tenant.id, ownerId: owner.id, mode: 'listening',
        keywords: ['Organização Exemplo'], enabledSources: [],
        languages: ['pt'], countries: ['BR'],
      }).returning();
    }
    if (!(await db.select().from(reputationTargets).where(eq(reputationTargets.tenantId, tenant.id))).length) {
      await db.insert(reputationTargets).values([
        { tenantId: tenant.id, name: spec.name, kind: 'brand', score: null,
          keywords: ['Organização Exemplo'] },
        { tenantId: tenant.id, name: 'Contexto comparativo', kind: 'market',
          score: null, keywords: ['Setor'] },
      ]);
    }
    if (!(await db.select().from(mentions).where(eq(mentions.projectId, project.id))).length) {
      await db.insert(mentions).values({
        projectId: project.id, externalId: 'exemplo-local-' + spec.slug,
        source: 'rss', title: spec.title,
        content: 'Conteúdo fictício exclusivo para verificar o layout e o isolamento de clientes. Não representa coleta real.',
        url: null, publishedAt: new Date(),
      });
    }
    if (!(await db.select().from(incidents).where(eq(incidents.tenantId, tenant.id))).length) {
      await db.insert(incidents).values({
        tenantId: tenant.id, title: 'SIMULAÇÃO — Acompanhamento de ocorrência ilustrativa',
        status: 'monitoring', severity: 'low', owner: 'Equipe de teste',
      });
    }
    if (!(await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.id))).length) {
      await db.insert(subscriptions).values({
        tenantId: tenant.id, planKey: 'trial', gateway: 'manual',
        status: 'active', vigenciaAte: new Date(Date.now() + 30 * 86400_000),
      });
    }
  }
  console.log('Fixture local concluída: proprietário + 2 clientes + projetos e evidências identificados como SIMULAÇÃO');
}
main().catch((err) => { console.error(err instanceof Error ? err.message : 'Erro da fixture'); process.exitCode = 1; });
