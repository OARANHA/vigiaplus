import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
const original = process.env.DEMO_MODE;
after(() => { if (original === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = original; });
for (const pathname of ['/settings', '/query', '/messages', '/reviews', '/sport', '/evidenze', '/wikipedia', '/impostazioni/account']) {
  test(`demo recusa POST de Server Action em ${pathname}`, () => {
    process.env.DEMO_MODE = '1';
    assert.equal(proxy(new NextRequest('http://localhost:3000'+pathname, { method: 'POST' })).status, 403);
  });
}
test('demo continua permitindo páginas GET e API de cookie de idioma', () => {
  process.env.DEMO_MODE = '1';
  assert.equal(proxy(new NextRequest('http://localhost:3000/settings')).status, 200);
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/locale', { method: 'POST' })).status, 200);
});
