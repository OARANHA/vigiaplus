import test from 'node:test';
import assert from 'node:assert/strict';
import {auditDefaultsAndForeignKeys} from '../lib/db/operational-default-fk-audit';

const expected=[
 {table:'parents',column:'id',hasDefault:true},
 {table:'children',column:'id',hasDefault:false},
 {table:'children',column:'parent_id',hasDefault:false}
];
const observed=[{table:'parents',column:'id',expression:"nextval('parents_id_seq'::regclass)"}];
const fk={
 table:'children',name:'children_parent_id_fkey',referencedTable:'parents',
 columns:['parent_id'],referencedColumns:['id'],onUpdate:'a',onDelete:'c',validated:true
};
const tables=['parents','children'];

test('ALT-08.10C.17: exact default evidence and FK topology remains NO-GO',()=>{
 const r=auditDefaultsAndForeignKeys(expected,observed,[fk],tables);
 assert.deepEqual(r.missingDefaults,[]);
 assert.deepEqual(r.brokenReferences,[]);
 assert.deepEqual(r.unvalidatedForeignKeys,[]);
 assert.deepEqual(r.unknownActions,[]);
 assert.equal(r.foreignKeyCount,1);
 assert.equal(r.foreignKeyDetails[0].onDelete,'c');
 assert.match(r.evidenceSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.schemaCertified,false);
 assert.equal(r.migrationAuthorized,false);
 assert.equal(r.productionAuthorized,false);
 assert.deepEqual(r,auditDefaultsAndForeignKeys(expected,observed,[fk],tables));
});
test('ALT-08.10C.17: missing defaults, wrong FK target and unvalidated constraint reported',()=>{
 const r=auditDefaultsAndForeignKeys(expected,[],[
  {...fk,referencedTable:'other',validated:false,onDelete:'z'}
 ],tables);
 assert.deepEqual(r.missingDefaults,['parents.id']);
 assert.deepEqual(r.brokenReferences,['children.children_parent_id_fkey']);
 assert.deepEqual(r.unvalidatedForeignKeys,['children.children_parent_id_fkey']);
 assert.deepEqual(r.unknownActions,['children.children_parent_id_fkey']);
});
test('ALT-08.10C.17: extra and unmodeled defaults are differentiated',()=>{
 const r=auditDefaultsAndForeignKeys(expected,[
  ...observed,
  {table:'children',column:'id',expression:'42'},
  {table:'parents',column:'orphan',expression:'99'}
 ],[],tables);
 assert.deepEqual(r.unexpectedDefaults,['children.id']);
 assert.deepEqual(r.unmodeledDefaults,['parents.orphan']);
});
test('ALT-08.10C.17: duplicate inputs and invalid identifiers rejected',()=>{
 assert.throws(()=>auditDefaultsAndForeignKeys([],observed,[fk],tables),/EMPTY_CONTRACT/);
 assert.throws(()=>auditDefaultsAndForeignKeys([...expected,expected[0]],observed,[fk],tables),/DUPLICATE_EXPECTATION/);
 assert.throws(()=>auditDefaultsAndForeignKeys(expected,[...observed,observed[0]],[fk],tables),/DUPLICATE_DEFAULT/);
 assert.throws(()=>auditDefaultsAndForeignKeys(expected,observed,[fk,fk],tables),/DUPLICATE_FK/);
 assert.throws(()=>auditDefaultsAndForeignKeys(expected,observed,[fk],['parents','parents']),/DUPLICATE_TABLE/);
 assert.throws(()=>auditDefaultsAndForeignKeys([{table:'public.users',column:'id',hasDefault:true}],observed,[],tables),/BAD_IDENTIFIER/);
});
