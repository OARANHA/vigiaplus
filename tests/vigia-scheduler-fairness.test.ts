import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseNextClient, quarterHourSlot } from '../lib/vigia/scheduler';

test('scheduler: tenant nunca atendido precede tenant com histórico, sem mutar entradas', () => {
  const candidates = Object.freeze([
    Object.freeze({ projectId: 21, tenantId: 2 }),
    Object.freeze({ projectId: 11, tenantId: 1 }),
    Object.freeze({ projectId: 31, tenantId: 3 }),
  ]);
  const history = Object.freeze([
    Object.freeze({ projectId: 11, tenantId: 1, slotAt: new Date('2026-11-09T12:00:00Z') }),
    Object.freeze({ projectId: 21, tenantId: 2, slotAt: new Date('2026-11-09T12:15:00Z') }),
  ]);
  assert.deepEqual(chooseNextClient(candidates, history), { projectId: 31, tenantId: 3 });
  assert.deepEqual(candidates.map(x => x.projectId), [21, 11, 31]);
});

test('scheduler: usa a última execução do tenant, não a primeira ou a última do projeto', () => {
  const candidates = [
    { projectId: 10, tenantId: 1 },
    { projectId: 11, tenantId: 1 },
    { projectId: 20, tenantId: 2 },
  ];
  const history = [
    { projectId: 10, tenantId: 1, slotAt: new Date('2026-11-09T10:00:00Z') },
    { projectId: 11, tenantId: 1, slotAt: new Date('2026-11-09T12:30:00Z') },
    { projectId: 20, tenantId: 2, slotAt: new Date('2026-11-09T12:00:00Z') },
  ];
  assert.deepEqual(chooseNextClient(candidates, history), { projectId: 20, tenantId: 2 });
});

test('scheduler: desempate estável por projeto mais antigo e id', () => {
  const candidates = [
    { projectId: 12, tenantId: 1 },
    { projectId: 11, tenantId: 1 },
    { projectId: 20, tenantId: 2 },
  ];
  assert.deepEqual(chooseNextClient(candidates, []), { projectId: 11, tenantId: 1 });
  assert.equal(chooseNextClient([], []), null);
  const history = [
    { projectId: 11, tenantId: 1, slotAt: new Date('2026-11-09T11:00:00Z') },
    { projectId: 20, tenantId: 2, slotAt: new Date('2026-11-09T11:00:00Z') },
  ];
  assert.deepEqual(chooseNextClient(candidates, history), { projectId: 12, tenantId: 1 });
});

test('scheduler: slots UTC atravessam dia e hora sem depender do fuso local', () => {
  assert.equal(quarterHourSlot(new Date('2026-11-09T23:59:59.999Z')).toISOString(), '2026-11-09T23:45:00.000Z');
  assert.equal(quarterHourSlot(new Date('2026-11-10T00:00:00.000Z')).toISOString(), '2026-11-10T00:00:00.000Z');
});
