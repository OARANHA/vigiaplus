import assert from 'node:assert/strict';
import test from 'node:test';
import {assessOperationalReadiness} from '../lib/db/operational-readiness';
import type {CatalogSnapshot} from '../lib/db/disposable-catalog-snapshot';

const required=['users','memberships','tenants','subscriptions','plans','plan_features','tenant_features'];
const base:CatalogSnapshot={schema:'alt0810c6_fullschema',
 namespaces:[],relations:[],columns:[],constraints:[],indexes:[],policies:[],
 relationGrants:[],columnGrants:[],schemaGrants:[],roles:[],memberships:[]};
const row=(obj:Record<string,unknown>)=>JSON.stringify(obj);

test('ALT-08.10C.9: empty catalog is never ready',()=>{
 const result=assessOperationalReadiness(base);
 assert.deepEqual(result.missingTables,required);
 assert.equal(result.readyForOperationalAuth,false);
 assert.equal(result.migrationAllowed,false);
 assert.equal(result.productionAllowed,false);
 assert.equal(result.missingMigrationLedger,true);
});
test('ALT-08.10C.9: tables without RLS and policies are rejected',()=>{
 const snapshot={...base,relations:required.map(relname=>
  row({relkind:'r',relname,relrowsecurity:false,relforcerowsecurity:false}))};
 const result=assessOperationalReadiness(snapshot);
 assert.deepEqual(result.missingTables,[]);
 assert.deepEqual(result.unprotectedTables,[...required].sort());
 assert.equal(result.missingTenantIsolationEvidence,true);
});
test('ALT-08.10C.9: even apparent complete catalog is not authorization',()=>{
 const snapshot={...base,relations:[...required,'schema_migrations'].map(relname=>
  row({relkind:'r',relname,relrowsecurity:true,relforcerowsecurity:true})),
 policies:required.map(tablename=>row({tablename,qual:'tenant_id = 771'}))};
 const report=assessOperationalReadiness(snapshot);
 assert.deepEqual(report.missingTables,[]);
 assert.deepEqual(report.unprotectedTables,[]);
 assert.equal(report.missingMigrationLedger,false);
 assert.equal(report.missingTenantIsolationEvidence,false);
 assert.equal(report.readyForOperationalAuth,false);
 assert.equal(report.migrationAllowed,false);
 assert.equal(report.productionAllowed,false);
});
test('ALT-08.10C.9: reject inappropriate scopes and malformed catalog evidence',()=>{
 assert.throws(()=>assessOperationalReadiness({...base,schema:'public'}),/SCOPE_ONLY/);
 assert.throws(()=>assessOperationalReadiness({...base,relations:['null']}),/INVALID_CATALOG_ROW/);
});
