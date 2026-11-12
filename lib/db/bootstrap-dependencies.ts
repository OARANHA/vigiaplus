/**
 * ALT-08.10C.5 — conservative, read-only inventory of the 186 frozen legacy
 * bootstrap statements. Not a SQL parser or executable migration planner.
 * Rejects unfamiliar statement types and forward/unknown table references.
 */
import {createHash} from 'node:crypto';
export type InventoryEntry={
 ordinal:number;kind:'create-table'|'alter-table'|'create-index'|'data-update';
 target:string;dependsOn:string[];sha256:string;hasDataMutation:boolean
};
export type BootstrapInventory={entries:InventoryEntry[];counts:Record<InventoryEntry['kind'],number>;readyForMigration:false};
const ident='([a-z_][a-z_0-9]*)';
const rx={
 table:new RegExp('^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+'+ident+'\\s*\\(','i'),
 alter:new RegExp('^ALTER\\s+TABLE\\s+'+ident+'\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\b','i'),
 index:new RegExp('^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+'+ident+'\\s+ON\\s+'+ident+'\\s*(?:USING\\s+[a-z_][a-z_0-9]*\\s*)?\\(','i'),
 update:new RegExp('^UPDATE\\s+'+ident+'\\s+SET\\b','i'),
 references:new RegExp('\\bREFERENCES\\s+'+ident+'\\s*\\(','gi'),
};
export function inspectBootstrapDependencies(statements:readonly string[]):BootstrapInventory{
 if(statements.length===0)throw Error('ALT0810C5_EMPTY');
 const created=new Set<string>();
 const entries:InventoryEntry[]=[];
 const counts:BootstrapInventory['counts']={'create-table':0,'alter-table':0,'create-index':0,'data-update':0};
 statements.forEach((raw,i)=>{
  const sql=raw.trim();
  if(!sql || sql.includes(';') || sql.includes('\\0'))throw Error('ALT0810C5_UNSAFE_STATEMENT:'+ (i+1));
  let kind:InventoryEntry['kind'],target:string,dependsOn:string[]=[];
  let match=rx.table.exec(sql);
  if(match){
   kind='create-table';target=match[1].toLowerCase();
   const refs=[...sql.matchAll(rx.references)].map(m=>m[1].toLowerCase());
   dependsOn=[...new Set(refs)];
   if(created.has(target))throw Error('ALT0810C5_DUPLICATE_TABLE:'+target);
   for(const dep of dependsOn)if(dep!==target&&!created.has(dep))throw Error('ALT0810C5_FORWARD_REFERENCE:'+target+':'+dep);
   created.add(target);
  }else if((match=rx.alter.exec(sql))){
   kind='alter-table';target=match[1].toLowerCase();dependsOn=[target];
  }else if((match=rx.index.exec(sql))){
   kind='create-index';target=match[2].toLowerCase();dependsOn=[target];
  }else if((match=rx.update.exec(sql))){
   kind='data-update';target=match[1].toLowerCase();dependsOn=[target];
  }else throw Error('ALT0810C5_UNCLASSIFIED_SQL:'+(i+1));
  for(const dep of dependsOn)if(!created.has(dep))throw Error('ALT0810C5_TABLE_NOT_YET_CREATED:'+(i+1)+':'+dep);
  counts[kind]++;
  entries.push({ordinal:i+1,kind,target,dependsOn,sha256:createHash('sha256').update(sql).digest('hex'),hasDataMutation:kind==='data-update'});
 });
 return {entries,counts,readyForMigration:false};
}
