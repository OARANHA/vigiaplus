/**
 * ALT-08.10C.17 — pure default and FK structural inventory.
 * Catalog evidence is advisory. Does not authorize operational migrations.
 */
import {createHash} from 'node:crypto';

export type DefaultExpectation={table:string;column:string;hasDefault:boolean};
export type DefaultCatalog={table:string;column:string;expression:string};
export type ForeignKeyCatalog={
 table:string;name:string;referencedTable:string;
 columns:string[];referencedColumns:string[];
 onUpdate:string;onDelete:string;validated:boolean;
};
const ident=/^[a-z_][a-z0-9_]*$/;
const recordKey=(r:{table:string;column:string})=>r.table+'.'+r.column;
function checkName(value:string){
 if(!ident.test(value))throw Error('ALT0810C17_BAD_IDENTIFIER');
}
export function auditDefaultsAndForeignKeys(
 expectations:readonly DefaultExpectation[],
 observedDefaults:readonly DefaultCatalog[],
 foreignKeys:readonly ForeignKeyCatalog[],
 existingTables:readonly string[],
){
 if(!expectations.length||!existingTables.length)throw Error('ALT0810C17_EMPTY_CONTRACT');
 const tables=new Set(existingTables);
 for(const table of existingTables)checkName(table);
 if(tables.size!==existingTables.length)throw Error('ALT0810C17_DUPLICATE_TABLE');
 const expected=new Map<string,DefaultExpectation>();
 for(const x of expectations){
  checkName(x.table);checkName(x.column);
  if(typeof x.hasDefault!=='boolean'||!tables.has(x.table))throw Error('ALT0810C17_INVALID_EXPECTATION');
  const key=recordKey(x);
  if(expected.has(key))throw Error('ALT0810C17_DUPLICATE_EXPECTATION');
  expected.set(key,x);
 }
 const defaults=new Map<string,DefaultCatalog>();
 for(const x of observedDefaults){
  checkName(x.table);checkName(x.column);
  if(!tables.has(x.table)||!x.expression.trim())throw Error('ALT0810C17_INVALID_DEFAULT');
  const key=recordKey(x);
  if(defaults.has(key))throw Error('ALT0810C17_DUPLICATE_DEFAULT');
  defaults.set(key,x);
 }
 const missingDefaults=[...expected].filter(([k,v])=>v.hasDefault&&!defaults.has(k)).map(([k])=>k).sort();
 const unexpectedDefaults=[...defaults].filter(([k])=>expected.has(k)&&!expected.get(k)?.hasDefault).map(([k])=>k).sort();
 const unmodeledDefaults=[...defaults].filter(([k])=>!expected.has(k)).map(([k])=>k).sort();
 const fkNames=new Set<string>();
 const brokenReferences:string[]=[];
 const unvalidatedForeignKeys:string[]=[];
 const unknownActions:string[]=[];
 const allowedActions=new Set(['a','r','c','n','d']);
 for(const fk of foreignKeys){
  checkName(fk.table);checkName(fk.name);checkName(fk.referencedTable);
  const key=fk.table+'.'+fk.name;
  if(fkNames.has(key))throw Error('ALT0810C17_DUPLICATE_FK');
  fkNames.add(key);
  if(!tables.has(fk.table)||!tables.has(fk.referencedTable)||
     fk.columns.length===0||fk.columns.length!==fk.referencedColumns.length||
     fk.columns.some(c=>!ident.test(c))||fk.referencedColumns.some(c=>!ident.test(c)))
   brokenReferences.push(key);
  if(fk.validated!==true)unvalidatedForeignKeys.push(key);
  if(!allowedActions.has(fk.onDelete)||!allowedActions.has(fk.onUpdate))unknownActions.push(key);
 }
 const payload={version:'alt0810c17-pg16-catalog-v1',
  expectationCount:expectations.length,observedDefaults:defaults.size,foreignKeyCount:foreignKeys.length,
  missingDefaults,unexpectedDefaults,unmodeledDefaults,
  brokenReferences:brokenReferences.sort(),unvalidatedForeignKeys:unvalidatedForeignKeys.sort(),
  unknownActions:unknownActions.sort(),
  // Preserve the actual FK topology and actions for review, never just counts.
  foreignKeyDetails:[...foreignKeys].sort((a,b)=>(a.table+'.'+a.name).localeCompare(b.table+'.'+b.name,'en')),
 };
 return {...payload,
  evidenceSha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  schemaCertified:false as const,migrationAuthorized:false as const,
  productionAuthorized:false as const};
}
