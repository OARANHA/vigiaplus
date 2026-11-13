/** ALT-08.10C.16: read-only structural audit of PostgreSQL16 bootstrap.
 * A report of evidence, never an operational migration authorization.
 */
import {createHash} from 'node:crypto';

export type StructuralCatalogRow={
 table:string;name:string;kind:'index'|'constraint'|'default';
 detail:string;constraintType?:string;
};
export type StructuralAuditReport={
 version:'alt0810c16-static-pg16-v1';expectedNamedIndexes:number;
 missingNamedIndexes:string[];unexpectedIndexNames:string[];
 defaultCount:number;primaryKeyCount:number;foreignKeyCount:number;
 uniqueConstraintCount:number;checkConstraintCount:number;
 expectedForeignKeyReferences:number;
 missingForeignKeys:number;
 evidenceSha256:string;
 schemaCertified:false;migrationAuthorized:false;productionAuthorized:false;
};
const indexStatement=/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)\b/i;
const fkPattern=/\bREFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi;
const key=(r:{table:string;name:string})=>r.table+'.'+r.name;
export function auditBootstrapStructure(
 statements:readonly string[],rows:readonly StructuralCatalogRow[]):StructuralAuditReport{
 if(!statements.length||!rows.length)throw Error('ALT0810C16_EMPTY_EVIDENCE');
 const expected=new Set<string>();
 let references=0;
 for(const sql of statements){
  const matched=indexStatement.exec(sql.trim());
  if(matched){
   const k=matched[2]+'.'+matched[1];
   if(expected.has(k))throw Error('ALT0810C16_DUPLICATE_INDEX:'+k);
   expected.add(k);
  }
  references+=[...sql.matchAll(fkPattern)].length;
 }
 const seen=new Set<string>();
 for(const row of rows){
  if(!/^[a-z_][a-z0-9_]*$/.test(row.table)||!row.name||!row.detail||
    !['index','constraint','default'].includes(row.kind))throw Error('ALT0810C16_BAD_ROW');
  const k=row.kind+':'+key(row);
  if(seen.has(k))throw Error('ALT0810C16_DUPLICATE_ROW:'+k);
  seen.add(k);
 }
 const indexes=rows.filter(r=>r.kind==='index');
 const actual=new Set(indexes.map(key));
 const constraints=rows.filter(r=>r.kind==='constraint');
 const count=(type:string)=>constraints.filter(r=>r.constraintType===type).length;
 const missingNamedIndexes=[...expected].filter(k=>!actual.has(k)).sort();
 const report={
  version:'alt0810c16-static-pg16-v1' as const,
  expectedNamedIndexes:expected.size,
  missingNamedIndexes,
  unexpectedIndexNames:[...actual].filter(k=>!expected.has(k)).sort(),
  defaultCount:rows.filter(r=>r.kind==='default').length,
  primaryKeyCount:count('p'),foreignKeyCount:count('f'),
  uniqueConstraintCount:count('u'),checkConstraintCount:count('c'),
  expectedForeignKeyReferences:references,
  missingForeignKeys:Math.max(0,references-count('f')),
  schemaCertified:false as const,migrationAuthorized:false as const,
  productionAuthorized:false as const
 };
 return {...report,evidenceSha256:createHash('sha256').update(JSON.stringify(report)).digest('hex')};
}
