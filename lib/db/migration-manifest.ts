/**
 * ALT-08.10C.2 — inventário offline de migrações legadas.
 * Nenhum acesso à rede ou PostgreSQL; não chama getDb().
 */
import {createHash} from 'node:crypto';

export type LegacyMigrationManifest = {
 schemaVersion:number;
 purpose:string;
 authoritativeOperationalSchema:boolean;
 bootstrapSeparated:boolean;
 migrations:{file:string;gitBlobSha1:string}[];
};

export function gitBlobSha1(content:Buffer|string):string{
 const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
 return createHash('sha1')
  .update(Buffer.from(`blob ${bytes.byteLength}\0`,'utf8'))
  .update(bytes).digest('hex');
}

export function verifyLegacyMigrationManifest(
 manifest:LegacyMigrationManifest,
 files:Readonly<Record<string,Buffer|string>>,
):{files:number;sha256:Readonly<Record<string,string>>}{
 if(manifest.schemaVersion!==1||
    manifest.purpose!=='legacy-sql-migration-inventory-only'||
    manifest.authoritativeOperationalSchema!==false||
    manifest.bootstrapSeparated!==false||
    !Array.isArray(manifest.migrations)||
    manifest.migrations.length===0)throw Error('ALT0810C_MANIFEST_UNSAFE_CONTRACT');
 const names=Object.keys(files).sort();
 const entries=manifest.migrations;
 if(names.length!==entries.length||
    new Set(entries.map(x=>x.file)).size!==entries.length) {
  throw Error('ALT0810C_MANIFEST_FILE_SET_MISMATCH');
 }
 const sha256:Record<string,string>={};
 for(let i=0;i<names.length;i++){
  const m=entries[i];
  if(m.file!==names[i]||
    !/^\d{5}_[a-z0-9_-]+\.sql$/.test(m.file)||
    !/^[0-9a-f]{40}$/.test(m.gitBlobSha1)) {
   throw Error('ALT0810C_MANIFEST_ENTRY_INVALID');
  }
  const raw=files[m.file];
  if(gitBlobSha1(raw)!==m.gitBlobSha1){
   throw Error(`ALT0810C_MANIFEST_CHECKSUM_MISMATCH:${m.file}`);
  }
  sha256[m.file]=createHash('sha256').update(raw).digest('hex');
 }
 return {files:names.length,sha256};
}
