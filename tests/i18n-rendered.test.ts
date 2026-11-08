import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICT, fmt, tFor, clientLocale } from '../lib/i18n-dict';
import { verdictLabel, overallLabel } from '../lib/kpi-export';
import { fmtNumber, formatKpi, formatDelta, type Lang } from '../lib/kpi-standard';
import { phaseLabel } from '../lib/trials';
import { localeDirective, kpiLang } from '../lib/content-locale';
import type { Reliability } from '../lib/data-reliability';

// ---------------------------------------------------------------------------
// AUDIT DO INCREMENTO 1 — texto EFETIVAMENTE RENDERIZADO, não só paridade de chaves.
//
// A auditoria externa encontrou telas pt-BR com controles em inglês
// (Search text…, Export, filtros, títulos de gráficos) embora o dicionário
// tivesse paridade de chaves: os componentes simplesmente não passavam pelo
// dicionário. Estes testes verificam os valores RENDERIZADOS que o dicionário
// + fmt() produzem, e que os fontes não voltaram a conter literais hardcoded.
// ---------------------------------------------------------------------------

const t = tFor('pt');

test('controles principais renderizam em pt-BR (valores efetivamente exibidos)', () => {
  // botões e controles apontados na auditoria
  assert.equal(t('demo.live', 'Live demo'), 'Demo ao vivo');
  assert.equal(t('ui.export', 'Export'), 'Exportar');
  assert.equal(t('ui.searchPlaceholder', 'Search text…'), 'Buscar no texto…');
  assert.equal(t('ui.search', 'Search'), 'Buscar');
  assert.equal(t('listening.semanticToggle', 'semantic'), 'semântica');
  assert.equal(t('translate.original', 'original language'), 'idioma original');
  assert.equal(t('translate.to', 'translate to {l}'), 'traduzir para {l}');
  assert.equal(t('ui.kind', 'Type'), 'Tipo');
  assert.equal(t('ui.articles', 'articles'), 'artigos');
  assert.equal(t('ui.posts', 'posts'), 'posts');
  assert.equal(t('ui.positive', 'positive'), 'positivo');
  assert.equal(t('ui.neutral', 'neutral'), 'neutro');
  assert.equal(t('ui.negative', 'negative'), 'negativo');
  assert.equal(t('ui.sortEngagement', 'engagement'), 'engajamento');
  assert.equal(t('ui.sortRelevance', 'relevance'), 'relevância');
  assert.equal(t('ui.open', 'open'), 'abrir');
  assert.equal(t('ui.readFull', 'Read the full article'), 'Ler a matéria completa');
  assert.equal(t('ui.translate', 'translate'), 'traduzir');
  assert.equal(t('ui.translated', 'translated'), 'traduzido');
  assert.equal(t('ui.copy', 'copy'), 'copiar');
  assert.equal(t('ui.copied', 'copied'), 'copiado');
  assert.equal(t('content.aiWritesIn', 'AI writes in'), 'a IA escreve em');
});

test('dashboard renderiza em pt-BR: painel Radar, gráficos e estatísticas', () => {
  assert.equal(t('dash.radar', ''), 'Radar — tendências emergentes nas últimas 24 horas');
  assert.equal(t('dash.volume', ''), 'Volume por fonte (14 dias)');
  assert.equal(t('dash.sentiment7', ''), 'Sentimento (7 dias)');
  assert.equal(t('dash.monitoring', 'Monitoring: {kw}'), 'Monitorando: {kw}');
  // composição com número: "41 menções em 24h (norm 9.2/dia)"
  assert.equal(
    fmt(t('dash.mentions24', ''), { n: 41, norm: '9.2' }),
    '41 menções em 24h (norm 9.2/dia)',
  );
  assert.equal(fmt(t('dash.score', ''), { v: '0.09' }), 'escore 0.09');
  assert.equal(t('dash.awaitingScore', ''), 'aguardando análise');
  assert.equal(fmt(t('listening.coverage', ''), { with: '74', total: '74' }),
    '74 de 74 artigos podem ser lidos na íntegra aqui.');
});

test('benchmark renderiza em pt-BR: títulos de gráficos e tabela', () => {
  assert.equal(t('bench.volumeTrend', 'Volume trend'), 'Tendência de volume');
  assert.equal(t('bench.detail', 'Detail'), 'Detalhe');
  assert.equal(t('bench.entity', 'Entity'), 'Entidade');
  assert.equal(t('bench.keywords', 'Keywords'), 'Palavras-chave');
  assert.equal(t('bench.mentions', 'Mentions'), 'Menções');
  assert.equal(t('bench.avgSentiment', 'Avg sentiment'), 'Sentimento médio');
  assert.equal(t('bench.pending', 'pending'), 'pendente');
});

test('hub de insights renderiza grupos e perguntas em pt-BR', () => {
  assert.equal(t('ins.hub.g1', ''), 'Formato da conversa');
  assert.equal(t('ins.hub.g3', ''), 'Momentum e saúde');
  assert.equal(t('ins.hub.q.topics', ''), 'Quais temas são grandes, quais são amados ou odiados, quais estão crescendo?');
  assert.equal(t('ins.hub.l.crisis', ''), 'Radar de crise');
  // todas as chaves do hub têm valor pt preenchido
  for (const k of Object.keys(DICT.pt)) {
    if (k.startsWith('ins.hub.')) assert.ok(DICT.pt[k].length > 0, `chave ${k} vazia`);
  }
});

test('KPI: rótulos de veredito, período e números em pt-BR', () => {
  assert.equal(verdictLabel('reliable', 'pt' as Lang), 'confiável');
  assert.equal(verdictLabel('caution', 'pt' as Lang), 'com cautela');
  assert.equal(verdictLabel('unusable', 'pt' as Lang), 'não usar');
  const r = { overall: 'suitable' } as unknown as Reliability;
  assert.equal(overallLabel(r, 'pt' as Lang), 'Dados adequados');
  // números no formato pt-BR: 1.234,5
  assert.equal(fmtNumber(1234.5, 'pt', 1), '1.234,5');
  assert.equal(formatKpi(null, 'count', 'pt'), 'n/d');
  assert.equal(formatDelta({ delta: 2.5, unit: 'pct' }, 'pt'), '+2,5 pts');
  assert.equal(phaseLabel(['PHASE2'], 'pt'), 'fase 2');
  // kpiLang agora entrega pt (antes mapeava para en)
  assert.equal(kpiLang('pt'), 'pt');
});

test('diretiva de conteúdo da IA continua pedindo Brazilian Portuguese', () => {
  assert.match(localeDirective('pt'), /Brazilian Portuguese/);
});

test('fmt() interpola e preserva placeholders ausentes', () => {
  assert.equal(fmt('{n} seções selecionadas', { n: 12 }), '12 seções selecionadas');
  assert.equal(fmt('{n} {tot}', { n: 1 }), '1 {tot}');
});

test('clientLocale: pt-BR e pt viram o locale pt', () => {
  // no servidor sem document usa a tag global; aqui simulamos os dois casos
  (globalThis as { __srLocaleTag?: string }).__srLocaleTag = 'pt-BR';
  assert.equal(clientLocale(), 'pt');
  (globalThis as { __srLocaleTag?: string }).__srLocaleTag = 'it-IT';
  assert.equal(clientLocale(), 'it');
  (globalThis as { __srLocaleTag?: string }).__srLocaleTag = undefined;
  assert.equal(clientLocale(), 'en');
});

// ── Anti-regressão: os literais hardcoded que a auditoria encontrou não voltam ──

const read = (p: string) => readFileSync(p, 'utf8');

test('fontes: banner demo, export e busca passam pelo dicionário', () => {
  const layout = read('app/layout.tsx');
  assert.ok(layout.includes("t('demo.banner'"), 'banner demo deve usar t()');
  assert.ok(!layout.includes("— read-only, sample data"), 'literal do banner não pode voltar');
  const exportBar = read('components/export-bar.tsx');
  assert.ok(exportBar.includes("t('ui.export'"), 'botão Export deve usar t()');
  assert.ok(exportBar.includes("t('export.selected'"), 'contagem de seções deve usar t()');
  assert.ok(exportBar.includes("t('export.period'"), 'período dos dados deve usar t()');
  const searchBox = read('components/search-box.tsx');
  assert.ok(searchBox.includes("t('ui.searchPlaceholder'"), 'placeholder de busca deve usar t()');
  assert.ok(searchBox.includes("t('listening.semanticToggle'"), 'chip semântico deve usar t()');
});

test('fontes: dashboard, listening, benchmark e insights usam o dicionário', () => {
  const dash = read('app/dashboard/page.tsx');
  assert.ok(dash.includes("t('dash.volume'"), 'título do gráfico de volume deve usar t()');
  assert.ok(dash.includes("t('dash.sentiment7'"), 'título do gráfico de sentimento deve usar t()');
  assert.ok(dash.includes("t('dash.radar'"), 'painel Radar deve usar t()');
  assert.ok(dash.includes("t('dash.mentions24'"), 'estatística do Radar deve usar t()');
  const listening = read('app/listening/page.tsx');
  assert.ok(listening.includes("t('listening.semanticChip'"), 'chip semântico deve usar t()');
  assert.ok(listening.includes("t('listening.coverage'"), 'linha de cobertura deve usar t()');
  assert.ok(listening.includes("t(`ui.${s}`"), 'chips de sentimento devem usar t()');
  const bench = read('app/benchmark/page.tsx');
  assert.ok(bench.includes("t('bench.volumeTrend'"), 'título do gráfico deve usar t()');
  assert.ok(bench.includes("t('bench.detail'"), 'título da tabela deve usar t()');
  const insights = read('app/insights/page.tsx');
  assert.ok(insights.includes("t(g.titleKey"), 'grupos do hub devem usar chaves do dicionário');
  assert.ok(!insights.includes("title: 'Shape of the conversation'"), 'grupos hardcoded não podem voltar');
  assert.ok(!insights.includes('I tuoi grafici'), 'literal italiano não pode voltar');
});

test('fontes: brief e cópia sem literais em inglês/italiano', () => {
  const brief = read('app/brief/page.tsx');
  assert.ok(!brief.includes("toLocaleDateString('en-US'"), 'data do brief deve seguir o locale');
  const copy = read('components/copy-button.tsx');
  assert.ok(copy.includes("t('ui.copy'"), 'botão copiar deve usar o dicionário');
});

// ── Paridade das chamadas L() na pilha KPI: cada chamada deve trazer o pt ──

/** Tokenizador mínimo de chamadas L(lang, ...): devolve o nº de argumentos após lang. */
function lCallAridities(source: string): number[] {
  const arities: number[] = [];
  const re = /L\(lang,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length;
    const stack: string[] = [];
    const parenStack = [0];
    let args = 0, cur = '';
    let closed = false;
    while (i < source.length && !closed) {
      const c = source[i];
      if (stack.length && (stack[stack.length - 1] === "'" || stack[stack.length - 1] === '"')) {
        cur += c;
        if (c === '\\') { cur += source[i + 1]; i += 2; continue; }
        if (c === stack[stack.length - 1]) stack.pop();
        i += 1; continue;
      }
      if (stack.length && stack[stack.length - 1] === '`') {
        if (c === '\\') { cur += c + source[i + 1]; i += 2; continue; }
        if (c === '`') { stack.pop(); i += 1; continue; }
        if (c === '$' && source[i + 1] === '{') { stack.push('${'); parenStack.push(0); i += 2; continue; }
        i += 1; continue;
      }
      if (c === "'" || c === '"' || c === '`') { stack.push(c); i += 1; continue; }
      if (c === '(') { parenStack[parenStack.length - 1] += 1; i += 1; continue; }
      if (c === ')') {
        if (parenStack[parenStack.length - 1] === 0 && stack.length === 0) {
          if (cur.trim()) args += 1;
          closed = true; break;
        }
        if (parenStack[parenStack.length - 1] > 0) parenStack[parenStack.length - 1] -= 1;
        i += 1; continue;
      }
      if (c === '}' && stack.length && stack[stack.length - 1] === '${') {
        stack.pop(); parenStack.pop(); i += 1; continue;
      }
      if (c === ',' && parenStack[parenStack.length - 1] === 0 && stack.length === 0) {
        if (cur.trim()) args += 1;
        cur = ''; i += 1; continue;
      }
      cur += c; i += 1;
    }
    if (closed) arities.push(args);
  }
  return arities;
}

test('pilha KPI: toda chamada L(lang, it, en) traz também o pt (4º argumento)', () => {
  for (const file of ['lib/kpi-standard.ts', 'lib/data-reliability.ts']) {
    const arities = lCallAridities(read(file));
    assert.ok(arities.length >= 40, `${file}: esperava muitas chamadas L, achei ${arities.length}`);
    const semPt = arities.filter((a) => a < 3).length;
    assert.equal(semPt, 0, `${file}: ${semPt} chamadas L sem tradução pt`);
  }
});
