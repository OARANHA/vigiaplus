/**
 * ALT-08.10C.35 — offline manifest preflight, reads repository files only.
 * No DB imports, credentials, network, Neon, migration or DDL.
 */
import {readFileSync} from 'node:fs';
import {validateC35Manifest,sha256} from '../lib/db/alt0810c35-operational-manifest';

const source=readFileSync(
  'schema/operational-rls/alt0810c35-disposable-manifest.json','utf8',
);
const m=validateC35Manifest(JSON.parse(source) as unknown);
console.log(JSON.stringify({
  gate:'ALT-08.10C.35',
  manifestId:m.id,
  sourceSha256:sha256(source),
  pinnedPredicateSha256:m.policy.usingSqlSha256,
  dependencyCount:m.dependencies.length,
  readerColumns:m.columns.filter(x=>x.readerSelect).map(x=>x.name),
  stagingAuthorized:m.stagingAuthorized,
  productionAuthorized:m.productionAuthorized,
  operationalRlsAuthorized:m.operationalRlsAuthorized,
  status:'FIXTURE_MANIFEST_VERIFIED_ONLY_NO_GO',
}));
