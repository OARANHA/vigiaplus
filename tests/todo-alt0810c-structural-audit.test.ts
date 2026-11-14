import test from 'node:test';
import assert from 'node:assert/strict';
import {auditBootstrapStructure,type StructuralCatalogRow} from '../lib/db/operational-structural-audit';

const statements=[
 'CREATE TABLE IF NOT EXISTS parents (id integer PRIMARY KEY)',
 'CREATE TABLE IF NOT EXISTS children (id integer, parent_id integer REFERENCES parents(id))',
 'CREATE INDEX IF NOT EXISTS children_parent_idx ON children(parent_id)'
];
const rows:StructuralCatalogRow[]=[
 {table:'parents',name:'parents_pkey',kind:'constraint',constraintType:'p',detail:'PRIMARY KEY (id)'},
 {table:'children',name:'children_parent_id_fkey',kind:'constraint',constraintType:'f',detail:'FOREIGN KEY (parent_id) REFERENCES parents(id)'},
 {table:'children',name:'children_parent_idx',kind:'index',detail:'CREATE INDEX children_parent_idx ON children USING btree (parent_id)'},
 {table:'children',name:'id',kind:'default',detail:'0'}
];
test('ALT-08.10C.16: structural catalog verified without authorizing migration',()=>{
 const result=auditBootstrapStructure(statements,rows);
 assert.equal(result.expectedNamedIndexes,1);
 assert.deepEqual(result.missingNamedIndexes,[]);
 assert.equal(result.foreignKeyCount,1);
 assert.equal(result.expectedForeignKeyReferences,1);
 assert.equal(result.missingForeignKeys,0);
 assert.equal(result.primaryKeyCount,1);
 assert.equal(result.defaultCount,1);
 assert.equal(result.schemaCertified,false);
 assert.equal(result.migrationAuthorized,false);
 assert.equal(result.productionAuthorized,false);
 assert.deepEqual(result,auditBootstrapStructure(statements,rows));
});
test('ALT-08.10C.16: missing FK and index must be detected',()=>{
 const altered=auditBootstrapStructure(statements,rows.filter(r=>
  r.constraintType!=='f'&&r.name!=='children_parent_idx'));
 assert.deepEqual(altered.missingNamedIndexes,['children.children_parent_idx']);
 assert.equal(altered.missingForeignKeys,1);
});
test('ALT-08.10C.16: invalid and duplicate rows fail closed',()=>{
 assert.throws(()=>auditBootstrapStructure([],rows),/EMPTY_EVIDENCE/);
 assert.throws(()=>auditBootstrapStructure(statements,[]),/EMPTY_EVIDENCE/);
 assert.throws(()=>auditBootstrapStructure(statements,[...rows,rows[0]]),/DUPLICATE_ROW/);
 assert.throws(()=>auditBootstrapStructure(statements,[{...rows[0],table:'public.tenants'}]),/BAD_ROW/);
});
