import test from 'node:test';
import assert from 'node:assert/strict';
import {auditOrmForeignKeys,type FkTuple} from '../lib/db/operational-fk-contract-audit';
const f:FkTuple={table:'memberships',columns:['tenant_id'],referencedTable:'tenants',
 referencedColumns:['id'],onDelete:'cascade',onUpdate:'no action'};
test('ALT-08.10C.18: ordered FK and action matches PostgreSQL codes',()=>{
 const result=auditOrmForeignKeys([f],[{...f,onDelete:'c',onUpdate:'a'}]);
 assert.deepEqual(result.missingOrmFks,[]);
 assert.deepEqual(result.missingDbFks,[]);
 assert.equal(result.fkContractCertified,false);
 assert.equal(result.productionAuthorized,false);
 assert.match(result.sha256,/^[a-f0-9]{64}$/);
});
test('ALT-08.10C.18: reordered FK columns and different actions do not match',()=>{
 const composite:FkTuple={...f,columns:['tenant_id','user_id'],referencedColumns:['id','id']};
 const r=auditOrmForeignKeys([composite],[{...composite,columns:['user_id','tenant_id'],onDelete:'r'}]);
 assert.equal(r.missingDbFks.length,1);
 assert.equal(r.missingOrmFks.length,1);
 assert.equal(r.migrationAuthorized,false);
});
test('ALT-08.10C.18: extra or missing FKs and invalid tuples fail closed',()=>{
 assert.equal(auditOrmForeignKeys([], [f]).missingOrmFks.length,1);
 assert.equal(auditOrmForeignKeys([f], []).missingDbFks.length,1);
 assert.throws(()=>auditOrmForeignKeys([{...f,columns:[]}],[]),/INVALID_FK/);
 assert.throws(()=>auditOrmForeignKeys([{...f,referencedColumns:[]}],[]),/INVALID_FK/);
});
