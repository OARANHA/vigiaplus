/**
 * ALT-08.10C.15: pure schema-versus-catalog comparison.
 * Reports discrepancies; never authorizes migration or deploy.
 */
import {createHash} from 'node:crypto';
export type ColumnContract={table:string;column:string;sqlType:string;notNull:boolean};
export type ColumnCatalog={table:string;column:string;sqlType:string;notNull:boolean};
export type ColumnGap={table:string;column:string;kind:'missing-db'|'missing-orm'|'type'|'nullability';expected?:string;actual?:string};
const key=(r:{table:string;column:string})=>r.table+'.'+r.column;
const canonical=(s:string)=>s.toLowerCase().trim()
 .replace(/\bcharacter varying\b/g,'varchar')
 .replace(/\btimestamp with time zone\b/g,'timestamptz')
 .replace(/\btimestamp without time zone\b/g,'timestamp')
 .replace(/\bdouble precision\b/g,'double precision')
 .replace(/\binteger\b/g,'integer')
 .replace(/\bserial\b/g,'integer')
 .replace(/\bboolean\b/g,'boolean')
 .replace(/\bnumeric\s*\(\s*/g,'numeric(')
 .replace(/\s+/g,' ');
export function compareColumnContract(orm:readonly ColumnContract[],db:readonly ColumnCatalog[]){
 const expected=new Map<string,ColumnContract>(),actual=new Map<string,ColumnCatalog>();
 for(const r of orm){const k=key(r);if(expected.has(k))throw Error('ALT0810C15_DUPLICATE_ORM:'+k);expected.set(k,r)}
 for(const r of db){const k=key(r);if(actual.has(k))throw Error('ALT0810C15_DUPLICATE_DB:'+k);actual.set(k,r)}
 if(!expected.size||!actual.size)throw Error('ALT0810C15_EMPTY_INPUT');
 const gaps:ColumnGap[]=[];
 for(const [k,r] of expected){
  const existing=actual.get(k);
  if(!existing){gaps.push({table:r.table,column:r.column,kind:'missing-db'});continue}
  if(canonical(r.sqlType)!==canonical(existing.sqlType))
   gaps.push({table:r.table,column:r.column,kind:'type',expected:r.sqlType,actual:existing.sqlType});
  if(r.notNull!==existing.notNull)
   gaps.push({table:r.table,column:r.column,kind:'nullability',expected:String(r.notNull),actual:String(existing.notNull)});
 }
 for(const [k,r] of actual)if(!expected.has(k))
  gaps.push({table:r.table,column:r.column,kind:'missing-orm'});
 gaps.sort((a,b)=>(a.table+'.'+a.column+'.'+a.kind).localeCompare(b.table+'.'+b.column+'.'+b.kind,'en'));
 const counts={expectedColumns:expected.size,actualColumns:actual.size,
  missingDb:gaps.filter(g=>g.kind==='missing-db').length,
  missingOrm:gaps.filter(g=>g.kind==='missing-orm').length,
  typeMismatch:gaps.filter(g=>g.kind==='type').length,
  nullabilityMismatch:gaps.filter(g=>g.kind==='nullability').length};
 return {counts,gaps,
  evidenceSha256:createHash('sha256').update(JSON.stringify({counts,gaps})).digest('hex'),
  schemaCertified:false as const,migrationAuthorized:false as const,productionAuthorized:false as const};
}
