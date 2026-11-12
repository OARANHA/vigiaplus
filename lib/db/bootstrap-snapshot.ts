/**
 * ALT-08.10C.3: extract static DDL from legacy bootstrap via TypeScript AST.
 * Pure function; never imports/evaluates lib/db/index.ts or connects to a DB.
 */
import ts from 'typescript';
import {gitBlobSha1} from './migration-manifest';

export type BootstrapSnapshotManifest={
 version:number;status:string;source:string;sourceConstant:string;
 statementCount:number;output:string;outputGitBlobSha1:string;
 includesDataUpdate:boolean;bootstrapSeparated:boolean;
 operationalSchemaCertified:boolean;migrationRunnerActivated:boolean;
};

export function extractStaticBootstrapDdl(source:string):string[]{
 const file=ts.createSourceFile('lib/db/index.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 if(file.parseDiagnostics.length)throw Error('BOOTSTRAP_SOURCE_PARSE_INVALID');
 const candidates:ts.VariableDeclaration[]=[];
 for(const statement of file.statements){
  if(!ts.isVariableStatement(statement))continue;
  for(const decl of statement.declarationList.declarations){
   if(ts.isIdentifier(decl.name)&&decl.name.text==='DDL')candidates.push(decl);
  }
 }
 if(candidates.length!==1||!candidates[0].initializer||
    !ts.isArrayLiteralExpression(candidates[0].initializer))
  throw Error('BOOTSTRAP_DDL_ARRAY_MISSING_OR_AMBIGUOUS');
 const elements=candidates[0].initializer.elements;
 if(elements.length===0)throw Error('BOOTSTRAP_DDL_EMPTY');
 return elements.map((node,i)=>{
  if(!ts.isNoSubstitutionTemplateLiteral(node) || node.text.trim().length===0 ||
    node.text.includes(';') || node.text.includes('\0'))
   throw Error(`BOOTSTRAP_DDL_DYNAMIC_OR_UNSAFE:${i}`);
  return node.text;
 });
}
export function renderBootstrapSnapshot(statements:readonly string[]):string{
 if(!statements.length)throw Error('BOOTSTRAP_SNAPSHOT_EMPTY');
 const intro=[
 '-- VIGIAPLUS ALT-08.10C.3: FROZEN legacy bootstrap snapshot; DO NOT DEPLOY.',
 '-- Source: lib/db/index.ts const DDL, extracted in original statement order.',
 '-- This snapshot is NOT automatically run by scripts/migrate.ts.',
 '-- Includes legacy data UPDATE; requires full snapshot + rollback review.',
 '-- Schema operational readiness: NO-GO.',
 '',
 ''
 ].join('\n');
 return intro+statements.map((statement,i)=>
  `-- bootstrap statement ${String(i+1).padStart(3,'0')}/${statements.length}\n${statement.trim()};`
 ).join('\n\n')+'\n';
}
export function verifyBootstrapSnapshot(source:string,snapshot:string,manifest:BootstrapSnapshotManifest):number{
 const stmts=extractStaticBootstrapDdl(source);
 if(manifest.version!==1||
    manifest.status!=='snapshot-only-no-migration-authorization'||
    manifest.source!=='lib/db/index.ts'||manifest.sourceConstant!=='DDL'||
    manifest.output!=='schema/operational-bootstrap/00001_legacy_snapshot.sql'||
    !Number.isSafeInteger(manifest.statementCount)||
    manifest.statementCount!==stmts.length||
    manifest.bootstrapSeparated!==false||manifest.operationalSchemaCertified!==false||
    manifest.migrationRunnerActivated!==false||
    manifest.includesDataUpdate!==stmts.some(s=>/^\s*UPDATE\b/i.test(s))||
    renderBootstrapSnapshot(stmts)!==snapshot||
    gitBlobSha1(snapshot)!==manifest.outputGitBlobSha1){
  throw Error('BOOTSTRAP_SNAPSHOT_DRIFT_OR_UNSAFE_MANIFEST');
 }
 return stmts.length;
}
