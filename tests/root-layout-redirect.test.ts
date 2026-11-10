import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p: string) => readFileSync(p, 'utf8');

test('home: "/" não monta shell antigo antes do redirecionamento da conta', () => {
  const layout = src('app/layout.tsx');
  const page = src('app/page.tsx');
  const proxy = src('proxy.ts');
  assert.match(layout, /const pageIsEntryRedirect = pathname === '\/';/);
  assert.match(layout, /pageIsPublic \|\| pageIsEntryRedirect \|\| pageIsClient \|\| pageIsConsole/);
  assert.ok(layout.indexOf('if (pageIsPublic || pageIsEntryRedirect') <
    layout.indexOf('const [projects, current, lastIngest]'),
    'O layout sem sidebar precisa ser escolhido antes de buscar dados do shell legado');
  assert.match(page, /redirect\('\/console'\)/);
  assert.match(page, /redirect\('\/portal'\)/);
  assert.match(proxy, /url\.pathname = pathname === '\/' \? '\/landing' : '\/login'/);
});
