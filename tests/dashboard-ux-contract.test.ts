import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const source=(path:string)=>readFileSync(join(process.cwd(),path),'utf8');

test('console operacional exige owner e comunica fila e proveniência',()=>{
  const api=source('app/api/console/operations/route.ts');
  const view=source('components/owner-operational-overview.tsx');
  assert.match(api,/requireOwner\(ctx\)/);
  for(const name of ['collectionRuns','incidents','invoices'])assert.ok(api.includes(name));
  for(const label of ['Fila de atenção','Ausência de execução, não falha','Visão do cliente'])
    assert.ok(view.includes(label));
});
test('falha em publicações não derruba resumo, e recuperação está disponível',()=>{
  const page=source('app/portal/page.tsx');
  assert.match(page,/Promise\.allSettled/);
  assert.match(page,/overview\.status\s*===\s*'fulfilled'/);
  assert.match(page,/publications\.status\s*===\s*'fulfilled'/);
  assert.match(page,/setEvidenceError/);
  assert.match(page,/setRefreshToken/);
  assert.match(page,/Fontes com publicações/);
  assert.doesNotMatch(page,/Fontes observadas/);
});
test('não confunde analista system com proprietário; tenant solicitado precisa ser autorizado',()=>{
  const page=source('app/portal/page.tsx');
  assert.match(page,/permissions\.permissions\?\.role === 'owner'/);
  assert.match(page,/permissions\.permissions\?\.role === 'analyst'/);
  assert.match(page,/result\.tenants\.find/);
  assert.doesNotMatch(page,/if \(permissions\.permissions\?\.system\)/);
});
test('briefing deriva somente de fatos, declara limites e janela',()=>{
  const summary=source('app/api/app/summary/route.ts');
  const view=source('components/client-decision-brief.tsx');
  assert.match(summary,/window_days: WINDOW_DAYS/);
  assert.match(summary,/lastCollection/);
  assert.match(view,/Pontuação de reputação indisponível/);
  assert.match(view,/A ausência de resultados não confirma ausência de repercussão/);
  assert.match(view,/Ler na fonte original/);
  assert.match(view,/Última tentativa de coleta/);
});
