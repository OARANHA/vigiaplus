/**
 * ALT-08.10C.2 — inventário verificável das migrações SEM ABRIR O BANCO.
 * Uso: node --import tsx scripts/schema-manifest-check.ts
 * Não confundir com `migrate:check` legado que inicializa getDb().
 */
import {readdirSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyLegacyMigrationManifest,type LegacyMigrationManifest} from '../lib/db/migration-manifest';

function main():void{
 const root=join(dirname(fileURLToPath(import.meta.url)),'..');
 const migrations=join(root,'migrations');
 const manifest=JSON.parse(readFileSync(join(migrations,'manifest.json'),'utf8')) as LegacyMigrationManifest;
 const names=readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort();
 const files:Record<string,Buffer>={};
 for(const name of names)files[name]=readFileSync(join(migrations,name));
 const result=verifyLegacyMigrationManifest(manifest,files);
 // Arquivo e digest são públicos e não envolvem PII, URL, credencial ou conexão.
 console.log('ALT0810C OFFLINE MIGRATION MANIFEST VERIFIED: '+JSON.stringify(result));
 console.log('ALT0810C NO DB CONNECTION, NO BOOTSTRAP, NO MIGRATION VERIFIED');
}
main();
