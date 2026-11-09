// Testes unitarios PUROS do modulo de avaliacao H2: sem banco, sem I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSilenced, ruleMatches, buildMessage, planDeliveries,
  type RuleInput, type ChannelInput, type FactInput,
} from '../lib/notifications/evaluate';

const DIA = '2026-05-01';
function utc(hhmm: string): Date { return new Date(`${DIA}T${hhmm}:00Z`); }
const AO_MEIO_DIA = utc('12:00');

function rule(o: Partial<RuleInput> = {}): RuleInput {
  return {
    id: 1, type: 'crise_aberta', threshold: {}, channels: [],
    silencioDe: null, silencioAte: null, slaMinutes: 900, active: 1,
    ...o,
  };
}
function channel(o: Partial<ChannelInput> = {}): ChannelInput {
  return { channel: 'email', destination: 'ops@exemplo.com', active: 1, verified: 1, ...o };
}
function fact(o: Partial<FactInput> = {}): FactInput {
  return { kind: 'incident', id: 42, title: 'Queda do servico', severity: 'alta', ...o };
}

// ---------------------------------------------------------------------------
// isSilenced: janela inclusiva, inclusive quando cruza a meia-noite.
// ---------------------------------------------------------------------------

test('silencio no mesmo dia: extremos inclusivos e fora da janela', () => {
  const r = rule({ silencioDe: '09:00', silencioAte: '18:00' });
  assert.equal(isSilenced(r, utc('09:00')), true, 'inicio inclusivo');
  assert.equal(isSilenced(r, utc('18:00')), true, 'fim inclusivo');
  assert.equal(isSilenced(r, utc('12:00')), true);
  assert.equal(isSilenced(r, utc('08:59')), false);
  assert.equal(isSilenced(r, utc('18:01')), false);
});

test('silencio cruzando a meia-noite: 22:00 -> 06:00', () => {
  const r = rule({ silencioDe: '22:00', silencioAte: '06:00' });
  assert.equal(isSilenced(r, utc('22:00')), true, 'inicio inclusivo');
  assert.equal(isSilenced(r, utc('23:30')), true);
  assert.equal(isSilenced(r, utc('00:00')), true, 'depois da meia-noite');
  assert.equal(isSilenced(r, utc('03:15')), true);
  assert.equal(isSilenced(r, utc('06:00')), true, 'fim inclusivo');
  assert.equal(isSilenced(r, utc('06:01')), false);
  assert.equal(isSilenced(r, utc('12:00')), false);
  assert.equal(isSilenced(r, utc('21:59')), false);
});

test('janela ausente ou invalida nunca silencia', () => {
  assert.equal(isSilenced(rule(), AO_MEIO_DIA), false);
  assert.equal(isSilenced(rule({ silencioDe: '22:00' }), AO_MEIO_DIA), false);
  assert.equal(isSilenced(rule({ silencioDe: '99:99', silencioAte: '06:00' }), AO_MEIO_DIA), false);
  assert.equal(isSilenced(rule({ silencioDe: '22:00', silencioAte: '06:99' }), AO_MEIO_DIA), false);
});

// ---------------------------------------------------------------------------
// ruleMatches: os tres tipos + coeracao segura de numeros.
// ---------------------------------------------------------------------------

test('crise_aberta: incidente igual/acima do threshold.severity', () => {
  assert.equal(ruleMatches(
    rule({ type: 'crise_aberta', threshold: { severity: 'media' } }),
    fact({ kind: 'incident', severity: 'alta' }),
  ), true);
  assert.equal(ruleMatches(
    rule({ type: 'crise_aberta', threshold: { severity: 'critica' } }),
    fact({ kind: 'incident', severity: 'baixa' }),
  ), false);
  assert.equal(ruleMatches(
    rule({ type: 'crise_aberta', threshold: { severity: 'alta' } }),
    fact({ kind: 'reputation', severity: 'alta' }),
  ), false, 'tipo de fato errado nao casa');
  // threshold numerico em string e lido por coeracao segura.
  assert.equal(ruleMatches(
    rule({ type: 'crise_aberta', threshold: { severity: '3' } }),
    fact({ kind: 'incident', severity: 'alta' }),
  ), true);
});

test('score_queda: score < minScore OU delta <= maxDelta', () => {
  const r = rule({ type: 'score_queda', threshold: { minScore: 70, maxDelta: -5 } });
  assert.equal(ruleMatches(r, fact({ kind: 'reputation', score: 61 })), true, 'score abaixo');
  assert.equal(ruleMatches(r, fact({ kind: 'reputation', score: 80, delta: -9 })), true, 'delta alem do limite');
  assert.equal(ruleMatches(r, fact({ kind: 'reputation', score: 80, delta: -1 })), false, 'nenhum dos dois');
  // minScore como string numerica tambem e aceito.
  assert.equal(ruleMatches(
    rule({ type: 'score_queda', threshold: { minScore: '70' } }),
    fact({ kind: 'reputation', score: 69 }),
  ), true);
});

test('fatura_vencida: apenas kind billing', () => {
  assert.equal(ruleMatches(rule({ type: 'fatura_vencida' }), fact({ kind: 'billing' })), true);
  assert.equal(ruleMatches(rule({ type: 'fatura_vencida' }), fact({ kind: 'incident' })), false);
});

test('tipo de regra desconhecido nunca casa', () => {
  assert.equal(ruleMatches(rule({ type: 'inexistente' }), fact()), false);
});

// ---------------------------------------------------------------------------
// buildMessage: numero, comparacao e origem; sem adjetivo vago; sem historia inventada.
// ---------------------------------------------------------------------------

test('mensagem de reputacao traz numero, comparacao e origem', () => {
  const m = buildMessage(
    rule({ type: 'score_queda', threshold: { minScore: 70 } }),
    fact({
      kind: 'reputation', id: 7, title: 'Marca X', severity: 'media',
      score: 61, source: '1.240 comentarios em 14 dias',
    }),
  );
  assert.match(m.message, /\d/, 'contem numero');
  assert.ok(m.message.includes('61'));
  assert.ok(m.message.includes('70'));
  assert.match(m.message, /9 pontos/, 'diferenca calculada');
  assert.ok(m.message.includes('abaixo da referencia'), 'comparacao explicita');
  assert.ok(m.message.includes('Base:'), 'origem explicita');
  assert.ok(m.message.includes('1.240 comentarios em 14 dias'), 'origem verbatim');
  assert.ok(m.title.includes('61'));
  assert.equal(m.severity, 'media');
  for (const vago of ['preocupante', 'significativo', 'relevante', 'expressivo', 'drastico', 'acentuado']) {
    assert.ok(!m.message.toLowerCase().includes(vago), `sem adjetivo vago "${vago}"`);
  }
});

test('mensagem nunca inventa variacao temporal sem historico', () => {
  // Fato sem delta, sem source: nada de "subiu/caiu/ontem/tendencia".
  const m = buildMessage(
    rule({ type: 'score_queda', threshold: { minScore: 70 } }),
    fact({ kind: 'reputation', id: 7, title: 'Marca X', severity: 'media', score: 61 }),
  );
  for (const inventado of [
    'ontem', 'semana passada', 'ultimos dias', 'tendencia', 'subiu', 'caiu',
    'aumentou', 'diminuiu', 'vs.', 'variacao de',
  ]) {
    assert.ok(!m.message.toLowerCase().includes(inventado), `nao deve inventar "${inventado}"`);
  }
  // A comparacao permitida e contra a referencia configurada, nao contra o tempo.
  assert.ok(m.message.includes('abaixo da referencia (70)'));
  assert.ok(m.message.includes('Base:'), 'origem presente mesmo sem source');
});

test('mensagens de incidente e fatura tambem tem numero e origem', () => {
  const mi = buildMessage(
    rule({ type: 'crise_aberta', threshold: { severity: 'media' } }),
    fact({ kind: 'incident', severity: 'alta' }),
  );
  assert.match(mi.message, /\d/);
  assert.ok(mi.message.includes('Base:'));
  assert.equal(mi.severity, 'alta');

  const mb = buildMessage(rule({ type: 'fatura_vencida' }), fact({ kind: 'billing', id: 3 }));
  assert.match(mb.message, /\d/);
  assert.ok(mb.message.includes('Base:'));
});

// ---------------------------------------------------------------------------
// planDeliveries: dedupeKey estavel, sem duplicacao de canal, filtros.
// ---------------------------------------------------------------------------

test('dedupeKey estavel por dia e sem duplicacao de (canal, dedupeKey)', () => {
  const r = rule({ id: 7, type: 'fatura_vencida', channels: [] });
  const f = fact({ kind: 'billing', id: 42 });
  const chs: ChannelInput[] = [
    channel({ channel: 'email', destination: 'a@exemplo.com' }),
    channel({ channel: 'email', destination: 'b@exemplo.com' }), // mesmo canal
    channel({ channel: 'slack', destination: 'https://hooks.exemplo.com/x' }),
    channel({ channel: 'telegram', destination: 'chat', active: 0 }), // inativo
    channel({ channel: 'webhook', destination: 'https://y', verified: 0 }), // nao verificado
  ];
  const itens = planDeliveries([r], chs, f, AO_MEIO_DIA);
  assert.ok(itens.length > 0);

  const esperado = 'rule:7:fact:billing:42:dia:2026-05-01';
  assert.ok(itens.every((i) => i.dedupeKey === esperado), 'dedupeKey no formato estavel');
  const chaves = itens.map((i) => `${i.channel}::${i.dedupeKey}`);
  assert.equal(new Set(chaves).size, chaves.length, 'nenhum (canal, dedupeKey) repetido');
  assert.deepEqual(itens.map((i) => i.channel).sort(), ['email', 'slack'], 'so canais ativos e verificados');

  // Mesma entrada => mesmas chaves (estabilidade); outro dia => chave diferente.
  const deNovo = planDeliveries([r], chs, f, AO_MEIO_DIA);
  assert.deepEqual(deNovo.map((i) => i.dedupeKey), itens.map((i) => i.dedupeKey));
  const outroDia = planDeliveries([r], chs, f, new Date('2026-05-02T12:00:00Z'));
  assert.notEqual(outroDia[0].dedupeKey, itens[0].dedupeKey);
});

test('itens sao EnqueueInput prontos e respeitam tenantId injetado', () => {
  const r = rule({ id: 2 });
  const f = fact({ kind: 'incident' });
  const itens = planDeliveries([r], [channel()], f, AO_MEIO_DIA, 99);
  assert.equal(itens.length, 1);
  const i = itens[0];
  assert.equal(i.tenantId, 99);
  assert.equal(i.ruleId, 2);
  assert.equal(typeof i.destination, 'string');
  assert.equal(typeof i.title, 'string');
  assert.equal(typeof i.message, 'string');
  assert.equal(i.kind, 'incident');
  // Sem tenantId informado, o placeholder e 0 (camada de aplicacao injeta).
  assert.equal(planDeliveries([r], [channel()], f, AO_MEIO_DIA)[0].tenantId, 0);
});

test('filtra regras inativas, silenciadas e que nao casam com o fato', () => {
  assert.equal(planDeliveries([rule({ active: 0 })], [channel()], fact(), AO_MEIO_DIA).length, 0);
  assert.equal(planDeliveries(
    [rule({ silencioDe: '00:00', silencioAte: '23:59' })], [channel()], fact(), AO_MEIO_DIA,
  ).length, 0);
  assert.equal(planDeliveries(
    [rule({ type: 'fatura_vencida' })], [channel()], fact({ kind: 'incident' }), AO_MEIO_DIA,
  ).length, 0);
});

test('respeita rule.channels quando preenchido', () => {
  const r = rule({ id: 3, channels: ['slack'] });
  const chs = [
    channel({ channel: 'email', destination: 'a@exemplo.com' }),
    channel({ channel: 'slack', destination: 'https://hooks.exemplo.com/x' }),
  ];
  const itens = planDeliveries([r], chs, fact(), AO_MEIO_DIA);
  assert.deepEqual(itens.map((i) => i.channel), ['slack']);
});
