/**
 * ALT-08.10C.18: compare *ordered* Drizzle FK tuples with actual pg_constraint.
 * Reports all gaps without allowing them to authorize migration. Pure function.
 */
import {createHash} from 'node:crypto';
export type FkTuple={table:string;columns:string[];referencedTable:string;referencedColumns:string[];onDelete:string;onUpdate:string};
const actions:Record<string,string>={a:'no action',r:'restrict',c:'cascade',n:'set null',d:'set default'};
function normalizeAction(action:string):string{
 const v=action.trim().toLowerCase().replace(/\s+/g,' ');
 return actions[v]??v;
}
function canonical(fk:FkTuple):string{
 if(!fk.table||!fk.referencedTable||fk.columns.length===0||
    fk.columns.length!==fk.referencedColumns.length||
    fk.columns.some(x=>!x)||fk.referencedColumns.some(x=>!x))
  throw Error('ALT0810C18_INVALID_FK');
 return JSON.stringify([fk.table,fk.columns,fk.referencedTable,fk.referencedColumns,
  normalizeAction(fk.onDelete),normalizeAction(fk.onUpdate)]);
}
export function auditOrmForeignKeys(expected:readonly FkTuple[],actual:readonly FkTuple[]){
 const e=new Map<string,number>(),a=new Map<string,number>();
 for(const x of expected){const k=canonical(x);e.set(k,(e.get(k)??0)+1)}
 for(const x of actual){const k=canonical(x);a.set(k,(a.get(k)??0)+1)}
 const missingOrmFks=[...a].flatMap(([k,n])=>Array(Math.max(0,n-(e.get(k)??0))).fill(k) as string[]).sort();
 const missingDbFks=[...e].flatMap(([k,n])=>Array(Math.max(0,n-(a.get(k)??0))).fill(k) as string[]).sort();
 const evidence={expectedCount:expected.length,actualCount:actual.length,missingOrmFks,missingDbFks};
 return {...evidence,sha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  fkContractCertified:false as const,migrationAuthorized:false as const,
  productionAuthorized:false as const};
}
