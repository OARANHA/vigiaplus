import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSeenDate } from '../lib/connectors/gdelt';

test('GDELT: accepts valid UTC seendate', () => {
  assert.equal(parseSeenDate('20261109T123045Z')?.toISOString(), '2026-11-09T12:30:45.000Z');
});

test('GDELT: rejects absent, malformed or impossible timestamps', () => {
  for (const value of ['', 'unknown', '20261109', '20260230T120000Z', '20261309T120000Z', '20261109T250000Z', '20261109T126000Z']) {
    assert.equal(parseSeenDate(value), null, value);
  }
});
