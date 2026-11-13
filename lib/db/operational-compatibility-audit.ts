/**
 * ALT-08.10C.14 — static compatibility inventory only.
 * Uses TypeScript AST for pgTable declarations and frozen SQL bootstrap.
 * Never imports application modules or executes DDL; finding a match does NOT
 * certify column types, constraints, RLS correctness or deployment readiness.
 */
import ts from 'typescript';
import {createHash} from 'node:crypto';
import type {BootstrapInventory} from './bootstrap-dependencies';

export type OperationalCompatibilityReport={
 version:'alt0810c14-static-v1';
 drizzleTables:string[];
 bootstrapTables:string[];
 onlyDrizzle:string[];
 onlyBootstrap:string[];
 migrationRlsTables:string[];
 unprotectedByLegacyRls:string[];
 mismatchedRlsTargets:string[];
 permissiveMissingContextPolicies:string[];
 bootstrapStatements:number;
 analysisSha256:string;
 readyForMigration:false;
 readyForOperationalAuth:false;
 productionAuthorized:false;
 limitations:readonly string[];
};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const dedupe=(values:string[])=>[...new Set(values)].sort();
const policyTable=/\bCREATE\s+POLICY\s+[a-z_][a-z0-9_]*\s+ON\s+([a-z_][a-z0-9_]*)/gi;
const enableRls=/\bALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
const missingContext=/current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s+IS\s+NULL/gi;

export function extractDrizzleTablesAst(source:string):string[]{
 const parsed=ts.createSourceFile('lib/db/schema.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const result:string[]=[];
 for(const item of parsed.statements){
  if(!ts.isVariableStatement(item))continue;
  for(const declaration of item.declarationList.declarations){
   const initializer=declaration.initializer;
   if(!initializer||!ts.isCallExpression(initializer)||
      !ts.isIdentifier(initializer.expression)||initializer.expression.text!=='pgTable')continue;
   const arg=initializer.arguments[0];
   if(!arg||!ts.isStringLiteral(arg)||!/^([a-z_][a-z0-9_]*)$/.test(arg.text))
    throw Error('ALT0810C14_NON_LITERAL_PGTABLE');
   result.push(arg.text);
  }
 }
 if(result.length===0||new Set(result).size!==result.length)
  throw Error('ALT0810C14_MISSING_OR_DUPLICATE_PGTABLE');
 return result.sort();
}

export function buildOperationalCompatibilityReport(
 drizzleSchemaSource:string,
 bootstrapInventory:BootstrapInventory,
 rlsSqlSource:string,
):OperationalCompatibilityReport{
 if(!bootstrapInventory.entries.length||
    bootstrapInventory.readyForMigration!==false)
  throw Error('ALT0810C14_INVALID_BOOTSTRAP');
 const drizzleTables=extractDrizzleTablesAst(drizzleSchemaSource);
 const bootstrapTables=dedupe(bootstrapInventory.entries
  .filter(e=>e.kind==='create-table').map(e=>e.target));
 if(bootstrapTables.length===0)throw Error('ALT0810C14_EMPTY_BOOTSTRAP_TABLES');
 const drizzle=new Set(drizzleTables),bootstrap=new Set(bootstrapTables);
 const enable=dedupe([...rlsSqlSource.matchAll(enableRls)].map(m=>m[1]));
 const policy=dedupe([...rlsSqlSource.matchAll(policyTable)].map(m=>m[1]));
 const rls=dedupe(enable.filter(t=>policy.includes(t)));
 const rlsSet=new Set(rls);
 const permissive=dedupe([...rlsSqlSource.matchAll(missingContext)].map(()=> 'tenant_context_optional'));
 // An empty tenant setting should NOT imply full access. This is a review
 // finding, not a claim that real roles or deployed policies are vulnerable.
 const report={
  version:'alt0810c14-static-v1' as const,
  drizzleTables,bootstrapTables,
  onlyDrizzle:drizzleTables.filter(t=>!bootstrap.has(t)),
  onlyBootstrap:bootstrapTables.filter(t=>!drizzle.has(t)),
  migrationRlsTables:rls,
  unprotectedByLegacyRls:drizzleTables.filter(t=>!rlsSet.has(t)),
  mismatchedRlsTargets:dedupe([...enable,...policy].filter(t=>!drizzle.has(t))),
  permissiveMissingContextPolicies:permissive,
  bootstrapStatements:bootstrapInventory.entries.length,
  readyForMigration:false as const,
  readyForOperationalAuth:false as const,
  productionAuthorized:false as const,
  limitations:[
   'AST table names only, not column types/defaults/constraints/foreign keys',
   'RLS text inventory is not PostgreSQL policy semantics verification',
   'legacy migration order and actual deployed catalog are not checked',
   'missing tenant context may be a privilege bypass; manual review required',
   'runtime, grants, seeds and migrations are not authorized',
  ],
 };
 return {...report,
  analysisSha256:sha(JSON.stringify(report)),
 };
}
