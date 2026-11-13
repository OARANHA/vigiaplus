/**
 * ALT-08.10C.26: production isolation gate. No database/network access.
 * Executed before and after a clean npm-ci-only production build.
 */
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const route=resolve(root,'app/api/ci/alt0810c25/route.ts');
const fixture=resolve(root,'scripts/tests/fixtures/alt0810c25-route.fixture.txt');
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')) as {
 dependencies:Record<string,string>;devDependencies:Record<string,string>};
const lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8')) as {
 packages:Record<string,unknown>};
const workflow=readFileSync(resolve(root,'.github/workflows/ci.yml'),'utf8');
const cfg=readFileSync(resolve(root,'next.config.ts'),'utf8');
assert.equal(existsSync(route),false,'CI-only Next.js route leaked into app tree');
assert.equal(existsSync(fixture),true,'CI fixture missing');
assert.equal(pkg.dependencies.pg,undefined,'pg must not be a production dependency');
assert.equal(pkg.devDependencies.pg,undefined,'pg must not be a dev dependency');
assert.equal(lock.packages['node_modules/pg'],undefined,'pg must not be present in committed npm lock');
assert.doesNotMatch(cfg,/serverExternalPackages:[^\n]*["']pg["']/,'pg must not be in operational Next config');
const buildJob=workflow.split(/^  postgres-disposable:/m)[0];
assert.doesNotMatch(buildJob,/npm install\s+--no-save[^\n]*\bpg\b/,'build job cannot install PG');
assert.match(buildJob,/run: npm ci/,'clean installation must be present');
assert.match(buildJob,/run: npm run build/,'production build must run');
const before=process.argv.includes('--postbuild');
if(before){
 const next=resolve(root,'.next');
 assert.equal(existsSync(next),true,'Next build output missing');
 const manifest=resolve(next,'server/app-paths-manifest.json');
 assert.equal(existsSync(manifest),true,'Next App Router paths manifest missing');
 const content=readFileSync(manifest,'utf8');
 assert.doesNotMatch(content,/alt0810c25/i,'CI-only handler found in Next App Router manifest');
 const server=resolve(next,'server/app/api/ci');
 const names=existsSync(server)?readdirSync(server):[];
 assert.equal(names.some(x=>x.includes('alt0810c25')),false,'CI route bundled in server');
}
console.log(`ALT0810C26: CI route absent in app, pg absent from npm lock and production config; npm ci-only build ${before?'artifact verified':'contract verified'}`);
