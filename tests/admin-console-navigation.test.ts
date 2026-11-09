import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_GROUPS } from '../lib/admin-navigation';

test('console: atalhos com destino existente e sem duplicações', () => {
  const links = CONSOLE_GROUPS.flatMap((group) => group.links);
  assert.ok(CONSOLE_GROUPS.length >= 3);
  assert.ok(links.length >= 8);
  assert.equal(new Set(links.map((x) => x.href)).size, links.length);
  const page = readFileSync(join(process.cwd(), 'components/console-owner-dashboard.tsx'), 'utf8');
  for (const link of links) {
    assert.ok(link.label.trim().length > 2);
    assert.ok(!/coming soon|in preparation|em preparação/i.test(link.label));
    if (link.href.startsWith('#')) {
      assert.ok(page.includes('id="' + link.href.slice(1) + '"'), 'Âncora ausente: ' + link.href);
    } else {
      assert.ok(link.href.startsWith('/'));
      assert.ok(existsSync(join(process.cwd(), 'app', link.href.slice(1), 'page.tsx')), 'Rota ausente: ' + link.href);
    }
  }
});

test('console: gate server para proprietário e tema consistente', () => {
  const server = readFileSync(join(process.cwd(), 'app/console/page.tsx'), 'utf8');
  const dashboard = readFileSync(join(process.cwd(), 'components/console-owner-dashboard.tsx'), 'utf8');
  assert.match(server, /globalRole !== 'owner'/);
  assert.match(server, /notFound\(\)/);
  assert.doesNotMatch(dashboard, /bg-white|bg-gray-50|col-span-3 bg-white/);
  assert.match(dashboard, /var\(--panel\)/);
});
