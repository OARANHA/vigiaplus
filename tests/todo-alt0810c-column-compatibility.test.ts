import test from 'node:test';
import assert from 'node:assert/strict';
import {compareColumnContract} from '../lib/db/operational-column-compatibility';

const orm=[
 {table:'tenants',column:'id',sqlType:'serial',notNull:true},
 {table:'tenants',column:'name',sqlType:'text',notNull:true},
 {table:'tenants',column:'plan_key',sqlType:'text',notNull:false}
];
const db=[
 {table:'tenants',column:'id',sqlType:'integer',notNull:true},
 {table:'tenants',column:'name',sqlType:'text',notNull:false},
 {table:'tenants',column:'extra',sqlType:'text',notNull:false}
];
test('ALT-08.10C.15: detect missing columns, nullability and extra catalog columns',()=>{
 const r=compareColumnContract(orm,db);
 assert.deepEqual(r.counts,{
  expectedColumns:3,actualColumns:3,missingDb:1,missingOrm:1,
  typeMismatch:0,nullabilityMismatch:1
 });
 assert.match(r.evidenceSha256,/^[a-f0-9]{64}$/);
 assert.equal(r.schemaCertified,false);
 assert.equal(r.migrationAuthorized,false);
 assert.equal(r.productionAuthorized,false);
 assert.deepEqual(r,compareColumnContract(orm,db));
});
test('ALT-08.10C.15: type drift is flagged and malformed contracts fail closed',()=>{
 const r=compareColumnContract(
  [{table:'projects',column:'id',sqlType:'integer',notNull:true}],
  [{table:'projects',column:'id',sqlType:'text',notNull:true}]);
 assert.equal(r.counts.typeMismatch,1);
 assert.throws(()=>compareColumnContract([],db),/EMPTY_INPUT/);
 assert.throws(()=>compareColumnContract(orm,[...db,db[0]]),/DUPLICATE_DB/);
 assert.throws(()=>compareColumnContract([...orm,orm[0]],db),/DUPLICATE_ORM/);
});
