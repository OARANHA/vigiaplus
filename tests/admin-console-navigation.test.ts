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
  assert.doesNotMatch(dashboard, /\bbg-white(?:\s|["']|$)|\bbg-gray-50\b/);
  assert.match(dashboard, /VigiaDashboardShell/);
});

test('idioma padrão: toda a navegação global tem tradução explícita pt-BR', async () => {
  const { DICT, DEFAULT_LOCALE } = await import('../lib/i18n-dict');
  const { NAV_LINKS, NAV_TABS } = await import('../lib/nav');
  assert.equal(DEFAULT_LOCALE, 'pt');
  const items = [...NAV_LINKS, ...NAV_TABS];
  for (const item of items) {
    assert.ok(DICT.pt[item.key], 'Rótulo da navegação sem pt-BR: ' + item.key);
  }
  assert.equal(DICT.pt['nav.dashboard'], 'Painel geral');
  assert.equal(DICT.pt['nav.tv'], 'Sala de crise');
  assert.equal(DICT.pt['nav.vigia'], 'Piloto CRF-RS');
});

test('sidebar do dono reutiliza layout global e remove exportação analítica do console', () => {
  const side = readFileSync(join(process.cwd(), 'components/sidebar.tsx'), 'utf8');
  const root = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
  const tabs = readFileSync(join(process.cwd(), 'components/settings-tabs.tsx'), 'utf8');
  const exportWrapper = readFileSync(join(process.cwd(), 'components/contextual-export-bar.tsx'), 'utf8');
  assert.match(side, /globalRole === 'owner'/);
  assert.match(side, /Console do proprietário/);
  assert.match(root, /globalRole: user.globalRole/);
  assert.match(root, /ContextualExportBar/);
  assert.match(exportWrapper, /pathname === '\/console'/);
  for (const word of ['Minha conta', 'Equipe', 'Fontes', 'Orçamento', 'Créditos e informações legais']) {
    assert.ok(tabs.includes(word), 'Aba não traduzida: ' + word);
  }
  assert.doesNotMatch(tabs, /'My account'|'Sources'|'Credits & Legal'/);
});

test('páginas administrativas mantêm formulários de projetos e fontes em pt-BR', () => {
  const project = readFileSync(join(process.cwd(), 'app/settings/page.tsx'), 'utf8');
  const source = readFileSync(join(process.cwd(), 'app/impostazioni/fonti/page.tsx'), 'utf8');
  const budget = readFileSync(join(process.cwd(), 'app/impostazioni/budget/page.tsx'), 'utf8');
  const account = readFileSync(join(process.cwd(), 'app/impostazioni/account/page.tsx'), 'utf8');
  const credits = readFileSync(join(process.cwd(), 'app/impostazioni/credits/page.tsx'), 'utf8');
  assert.match(project, /code === 'pt'/);
  assert.match(project, /Qual tipo de projeto deseja criar/);
  assert.match(project, /Criar e configurar consultas/);
  assert.doesNotMatch(project, /What kind of project\?|New listening project|No active link/);
  assert.match(source, /Situação das fontes/);
  assert.match(source, /Notícias e fontes gerais/);
  assert.match(budget, /Configuradas nesta conta/);
  assert.match(account, /Alterar senha/);
  assert.match(credits, /Créditos e informações legais/);
  assert.match(credits, /Massimo Scognamiglio/);
  assert.match(credits, /GNU AGPL-3\.0/);
});

test('componentes administrativos apresentam rótulos e ações em pt-BR', () => {
  const components = [
    ['team-manager', 'Senha temporária gerada', 'Adicionar membro'],
    ['cost-control', 'Limite de gastos', 'Zerar contador'],
    ['ai-engine', 'Motor de IA', 'Salvar modelos'],
    ['connector-keys', 'Chaves configuradas', 'Salvar chaves'],
    ['editable-entity', 'Sua marca', 'Termos relacionados'],
    ['change-password-form', 'Senha atualizada', 'Atualizar senha'],
  ] as const;
  for (const [name, first, second] of components) {
    const source = readFileSync(join(process.cwd(), 'components', name + '.tsx'), 'utf8');
    assert.ok(source.includes(first), name + ' sem primeiro rótulo em português');
    assert.ok(source.includes(second), name + ' sem segundo rótulo em português');
  }
});
