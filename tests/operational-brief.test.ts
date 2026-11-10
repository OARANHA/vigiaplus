import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOperationalOverview} from '../lib/vigia/operational-brief';
const d=new Date('2026-11-09T19:00:00Z');
const t=[{id:1,name:'Alfa',status:'active'},{id:2,name:'Beta',status:'active'}];
const p=[{id:11,tenantId:1,name:'Notícias',mode:'listening'},{id:12,tenantId:1,name:'RSS',mode:'listening'},{id:21,tenantId:2,name:'Arquivo',mode:'upload'}];
test('prioridades por incidentes, última falha, fatura vencida e ausência de histórico',()=>{
  const x=buildOperationalOverview({tenants:t,projects:p,
    runs:[{id:1,projectId:11,status:'success',startedAt:new Date('2026-11-08T10:00:00Z'),newCount:4},
      {id:2,projectId:11,status:'failed',startedAt:new Date('2026-11-09T10:00:00Z'),newCount:0}],
    incidents:[{id:1,tenantId:1,title:'Grave',status:'monitoring',severity:'high'},
      {id:2,tenantId:2,title:'Resolvido',status:'closed',severity:'critical'}],
    invoices:[{id:1,tenantId:2,status:'overdue'},{id:2,tenantId:1,status:'open'}]},d);
  assert.deepEqual([x.summary.projects,x.summary.projectsWithoutRuns,x.summary.projectsWithFailedRuns,
    x.summary.criticalIncidents,x.summary.invoicesOverdue],[2,1,1,1,1]);
  assert.equal(x.signals[0].priority,'critica');
  assert.equal(x.clients[0].collection,'falha');
  assert.equal(x.clients[1].collection,'sem_projeto');
  assert.equal(x.summary.lastCollectionAt,'2026-11-09T10:00:00.000Z');
  assert.ok(x.signals.some(s=>s.kind==='coverage'&&s.priority==='informativa'));
});
test('sem dados: ausência de histórico não vira falha ou inferência de risco',()=>{
  const x=buildOperationalOverview({tenants:[t[0]],projects:[],runs:[],incidents:[],invoices:[]},d);
  assert.equal(x.signals.length,0);
  assert.equal(x.summary.lastCollectionAt,null);
  assert.equal(x.clients[0].collection,'sem_projeto');
});
test('última coleta parcial é diferente de falha',()=>{
  const x=buildOperationalOverview({tenants:[t[0]],projects:[p[0]],
    runs:[{id:3,projectId:11,status:'partial',startedAt:d,newCount:1}],incidents:[],invoices:[]},d);
  assert.equal(x.clients[0].collection,'parcial');
  assert.equal(x.summary.projectsWithFailedRuns,0);
});
