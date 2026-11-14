/**
 * ALT-08.10 — escolha de membership de cliente.
 * Nunca usar a primeira linha arbitrária do PostgreSQL quando houver
 * mais de um vínculo. Uma seleção explícita só é válida se a identidade
 * autenticada possui exatamente um vínculo correspondente.
 */
import {AppError} from './errors';

export type ClientMembership = {tenantId:number;role:string};

export function selectAuthorizedClientMembership<T extends ClientMembership>(
 memberships:readonly T[],
 requestedTenantId:number|null|undefined,
):{membership:T;spoofAttempt:string|null}{
 if(!memberships.length)throw AppError.forbidden('Usuario sem vinculo com tenant');
 const requested=requestedTenantId!=null;
 if(requested && (!Number.isSafeInteger(requestedTenantId)||requestedTenantId<=0)){
  throw AppError.badRequest('Selecao de cliente invalida');
 }
 for(const membership of memberships){
  if(!Number.isSafeInteger(membership.tenantId)||membership.tenantId<=0||
    (membership.role!=='client_admin'&&membership.role!=='client_viewer')){
   throw AppError.forbidden('Vinculo de cliente invalido');
  }
 }
 const unique=new Set(memberships.map(m=>m.tenantId));
 if(unique.size!==memberships.length){
  throw AppError.forbidden('Vinculos duplicados: conciliacao necessaria');
 }
 if(requested){
  const selected=memberships.find(m=>m.tenantId===requestedTenantId);
  if(selected)return {membership:selected,spoofAttempt:null};
  // Compatibilidade: um único vínculo sempre usa tenant autenticado
  // e registra tentativa de spoof. Múltiplos não têm fallback seguro.
  if(memberships.length===1){
   return {membership:memberships[0],spoofAttempt:String(requestedTenantId)};
  }
  throw AppError.forbidden('Cliente solicitado sem vinculo autorizado');
 }
 if(memberships.length!==1){
  throw AppError.forbidden('Selecione explicitamente um cliente autorizado');
 }
 return {membership:memberships[0],spoofAttempt:null};
}
