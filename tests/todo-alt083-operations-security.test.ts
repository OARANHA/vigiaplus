import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateWorkerHealth, sanitizedWorkerSummary, WORKER_HEALTH_MAX_LAG_MS }
  from '../lib/notifications/operations-health';
import { requireOwner } from '../lib/tenant/rbac';
import type { TenantContext } from '../lib/tenant/context';
import { AppError } from '../lib/tenant/errors';

const now = Date.parse('2026-11-11T12:00:00Z');
function worker(worker: string, status: string, finishedAt: string | null) {
  return {worker,status,finishedAt};
}
test('ALT-08.3 health: ausência, atraso, erro, relógio futuro e dry-run nunca são saudáveis', () => {
  assert.equal(evaluateWorkerHealth(null,now),'not_observed');
  assert.equal(evaluateWorkerHealth(worker('notify','success',new Date(now).toISOString()),now),'healthy');
  assert.equal(evaluateWorkerHealth(worker('notify','success',new Date(now-WORKER_HEALTH_MAX_LAG_MS).toISOString()),now),'healthy');
  assert.equal(evaluateWorkerHealth(worker('notify','success',new Date(now-WORKER_HEALTH_MAX_LAG_MS-1).toISOString()),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify','success',new Date(now+1).toISOString()),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify','error',new Date(now).toISOString()),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify_dry_run','success',new Date(now).toISOString()),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify','success','invalid'),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify','success',null),now),'degraded');
  assert.equal(evaluateWorkerHealth(worker('notify','success',new Date(now).toISOString()),NaN),'degraded');
});

test('ALT-08.3 summary: permitir somente contadores finitos não negativos, nunca destinatário, email ou token', () => {
  const safe=sanitizedWorkerSummary({
    tenants:4,regras:2,canais:0, fatos:10, planejados:7,
    enfileirados:5, entregas:{sent:3,failed:1,recipient:'private@example.com'},
    token:'private-token', destination:'private@example.com', message:'private text',
  });
  assert.deepEqual(safe,{
    tenants:4,regras:2,canais:0,fatos:10,planejados:7,enfileirados:5,
    entregas:{sent:3,failed:1},
  });
  assert.deepEqual(sanitizedWorkerSummary({tenants:-1,canais:Infinity,entregas:{sent:2.5,failed:0}}),{});
  assert.deepEqual(sanitizedWorkerSummary('invalid'),{});
});

function ctx(role:TenantContext['role'], tenantId:number|null, system=false):TenantContext {
  return {
    userId:1,userName:'test',role,tenantId,system,surface:'console',
    density:'avancado',vocabulary:'tecnico',ip:null,requestId:'test',
  };
}
test('ALT-08.3 RBAC: console operacional proprietário independe de densidade; cliente e analista negados', () => {
  assert.equal(requireOwner(ctx('owner',null,true)).role,'owner');
  assert.equal(requireOwner(ctx('owner',5,false)).role,'owner');
  for (const role of ['analyst','client_admin','client_viewer'] as const) {
    const user=ctx(role,41);
    assert.throws(()=>requireOwner(user),(err:unknown)=>
      err instanceof AppError && err.code==='FORBIDDEN' && err.status===403);
  }
});

test('ALT-08.3 contract: observabilidade requer owner antes da primeira query e nunca aceita tenant_id de request',()=>{
  const content=readFileSync(resolve('app/api/console/notifications/operations/route.ts'),'utf8');
  assert.ok(content.indexOf('requireOwner(ctx)') < content.indexOf('const db = await getDb()'));
  assert.ok(content.includes('resolveTenantContext({ surface: \'console\' })'));
  assert.ok(content.includes('sanitizedWorkerSummary(r.summary)'));
  assert.ok(content.includes('evaluateWorkerHealth('));
  assert.ok(content.includes('Cache-Control'));
  assert.ok(!content.includes('requestedTenantId'));
  assert.ok(!content.includes('request.nextUrl.searchParams'));
});
