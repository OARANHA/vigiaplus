import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { countryName, countryFlag, toCountryCode } from '../lib/country-codes';

test('helpers de países usados no mapa compilam para navegador sem banco ou módulos Node', async () => {
  const result = await build({ entryPoints: ['lib/country-codes.ts'], bundle: true, platform: 'browser', write: false, logLevel: 'silent', metafile: true });
  assert.ok(!Object.keys(result.metafile!.inputs).some(p => p.includes('lib/db/') || p.includes('lib/password')));
});

test('códigos ISO, nomes e bandeira do Brasil preservados', () => {
  assert.equal(toCountryCode('076'), 'br');
  assert.equal(toCountryCode('Brazil'), 'br');
  assert.equal(countryName('br'), 'Brazil');
  assert.equal(countryFlag('br'), '🇧🇷');
});
