import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source=(file:string)=>readFileSync(join(process.cwd(),file),'utf8');

test('administração do proprietário tem rota protegida e sidebar com seções reais',()=>{
  const page=source('app/console/admin/page.tsx');
  const workspace=source('components/owner-admin-workspace.tsx');
  const shell=source('components/console-owner-dashboard.tsx');
  const css=source('app/console/admin/owner-admin.css');
  assert.match(page,/globalRole !== 'owner'/);
  assert.match(page,/notFound\(\)/);
  assert.match(workspace,/vpx-owner-sidebar/);
  assert.match(workspace,/aria-label="Menu da administração"/);
  assert.match(workspace,/planos'|planos:/);
  assert.match(workspace,/recursos'|recursos:/);
  assert.match(workspace,/contratos'|contratos:/);
  assert.match(workspace,/privacidade'|privacidade:/);
  assert.match(workspace,/pendente/i);
  assert.match(css,/max-width:800px/);
  assert.match(shell,/\/console\/admin/);
  assert.ok(existsSync(join(process.cwd(),'app/api/console/plans/route.ts')));
  assert.ok(existsSync(join(process.cwd(),'app/api/console/subscriptions/route.ts')));
});

test('entitlements: assinatura validada antes de concessão manual e direitos vêm do banco',()=>{
  const code=source('lib/tenant/entitlements.ts');
  const atBilling=code.indexOf('if (!sub)');
  const atGrant=code.indexOf('const granted =');
  const atPlan=code.indexOf('const planRows =');
  assert.ok(atBilling > 0 && atGrant > atBilling && atPlan > atGrant);
  assert.match(code,/vigente\(o\)/);
  assert.match(code,/planFeatures\.planKey/);
  assert.doesNotMatch(code,/PLAN_FEATURES\[/);
  assert.match(code,/if \(!tenant\) throw AppError\.notFound/);
  assert.match(code,/A expiração deve ser uma data futura/);
});

test('planos: fluxo owner e proteção contra edição retroativa',()=>{
  const code=source('app/api/console/plans/route.ts');
  assert.match(code,/requireOwner\(ctx\)/);
  assert.match(code,/export async function GET/);
  assert.match(code,/export async function POST/);
  assert.match(code,/export async function PUT/);
  assert.match(code,/PLAN_IN_USE/);
  assert.match(code,/INSERT INTO plans/);
  assert.match(code,/INSERT INTO plan_features/);
  assert.match(code,/PLAN_CREATED/);
  assert.match(code,/PLAN_UPDATED/);
});

test('contrato manual nunca é emitido como pagamento e exige aprovação',()=>{
  const code=source('app/api/console/subscriptions/route.ts');
  assert.match(code,/manualApproval !== true/);
  assert.match(code,/s\.gateway !== 'manual'/);
  assert.match(code,/charged: false/);
  assert.match(code,/CONTRACT_MANUAL_ACTIVATION/);
  assert.doesNotMatch(code,/createStripeCheckout|createPixCharge/);
});

test('organização nova inicia pendente e sem acesso ou cobrança',()=>{
  const code=source('app/api/console/tenants/route.ts');
  assert.match(code,/status: 'pending'/);
  assert.match(code,/hasAccess: false/);
  assert.match(code,/requireOwner\(ctx\)/);
});
