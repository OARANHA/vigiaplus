import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brazilCivilDate, isInvoiceOverdue } from '../lib/billing/overdue';

const file = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('inadimplência distingue a vencer, vencida, processando e paga', () => {
  const today = '2026-11-10';
  assert.equal(isInvoiceOverdue({status:'open', dueAt:'2026-11-09'}, today), true);
  assert.equal(isInvoiceOverdue({status:'open', dueAt:today}, today), false);
  assert.equal(isInvoiceOverdue({status:'open', dueAt:'2026-11-11'}, today), false);
  assert.equal(isInvoiceOverdue({status:'open', dueAt:null}, today), false);
  assert.equal(isInvoiceOverdue({status:'processing', dueAt:'2026-11-09'}, today), false);
  assert.equal(isInvoiceOverdue({status:'paid', dueAt:'2026-11-09'}, today), false);
  assert.equal(isInvoiceOverdue({status:'overdue', dueAt:null}, today), true);
});

test('data de vencimento usa data civil em São Paulo, não UTC', () => {
  assert.equal(brazilCivilDate(new Date('2026-11-10T02:30:00Z')), '2026-11-09');
  assert.equal(brazilCivilDate(new Date('2026-11-10T03:01:00Z')), '2026-11-10');
});

test('featureState nega organizações inativas e assinaturas conflitantes antes de qualquer override', () => {
  const src = file('lib/tenant/entitlements.ts');
  const tenantGate = src.indexOf("organization.status !== 'active'");
  const duplicateGate = src.indexOf("validSubscriptions.length > 1");
  const manualGrant = src.indexOf('const granted =');
  assert.ok(tenantGate > 0 && duplicateGate > tenantGate && manualGrant > duplicateGate);
  assert.match(src, /cliente_inativo_ou_pendente/);
  assert.match(src, /contratos_conflitantes/);
  assert.match(src, /permissoes_duplicadas/);
  assert.match(src, /existing.length > 1/);
  assert.match(src, /T23:59:59\.999-03:00/);
});

test('planos atualizam matriz por diferença, sem apagar e reinserir a mesma capacidade', () => {
  const src = file('app/api/console/plans/route.ts');
  assert.match(src, /AND NOT \(feature_key = ANY/);
  assert.match(src, /WHERE NOT EXISTS \(/);
  assert.match(src, /ON CONFLICT DO NOTHING/);
  assert.match(src, /PLAN_IN_USE/);
  assert.match(src, /SELECT EXISTS \(SELECT 1 FROM updated\)/);
});

test('auditoria exige owner e não retorna IP ou metadados crus', () => {
  const src = file('app/api/console/audit/route.ts');
  assert.match(src, /requireOwner\(ctx\)/);
  assert.match(src, /limit\(limit\)/);
  assert.match(src, /tenant_id/);
  assert.doesNotMatch(src, /ip: auditEvents\.ip|meta: auditEvents\.meta/);
});

test('consumo usa contagens agregadas por organização e declara que quotas ainda não são aplicadas', () => {
  const route = file('app/api/console/usage/route.ts');
  const view = file('components/owner-admin-workspace.tsx');
  assert.match(route, /requireOwner\(ctx\)/);
  assert.match(route, /groupBy\(projects\.tenantId\)/);
  assert.match(route, /groupBy\(llmUsage\.tenantId\)/);
  assert.match(route, /quotasEnforced: false/);
  assert.match(view, /Trilha de auditoria/);
  assert.match(view, /Consumo e cotas/);
  assert.match(view, /bloqueio automático de cotas ainda não/);
});
