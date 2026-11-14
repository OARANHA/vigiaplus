/**
 * ALT-08.6 — contrato de elegibilidade do piloto de pré-produção.
 * NÃO inicializa conexão, não aplica DDL e não autoriza produção.
 * Roles internas são explicitamente bloqueadas até contratos operacionais próprios.
 */
import type {TenantContext} from './context';
import {trustedRlsTenantForClient} from './rls-runtime';

export type PreproductionRole='client_admin'|'client_viewer'|'owner'|'analyst'|'worker'|'webhook';

export const ALT086_ROLE_MATRIX={
  client_admin:{read:true,write:false,reason:'tenant vindo de membership autenticado'},
  client_viewer:{read:true,write:false,reason:'tenant vindo de membership autenticado'},
  owner:{read:false,write:false,reason:'carteira e impersonação exigem contrato separado'},
  analyst:{read:false,write:false,reason:'seleção de carteira e vínculos não certificados'},
  worker:{read:false,write:false,reason:'worker exige papel operacional transacional próprio'},
  webhook:{read:false,write:false,reason:'webhook exige identidade de serviço própria'},
} as const satisfies Record<PreproductionRole,{read:boolean;write:boolean;reason:string}>;

export function requireAlt086ClientReadContext(ctx:TenantContext):number{
  if(!ctx || !Object.prototype.hasOwnProperty.call(ALT086_ROLE_MATRIX,ctx.role) ||
     !ALT086_ROLE_MATRIX[ctx.role].read){
    throw Error('ALT086_ROLE_NOT_HOMOLOGATED');
  }
  return trustedRlsTenantForClient(ctx);
}

export function assertAlt086PreproductionOnly(env:Readonly<Record<string,string|undefined>>):void{
  // Exige CI + banco efêmero local, sem qualquer URL de Neon/produção.
  if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
    env.ALT086_EPHEMERAL_POSTGRES!=='1'||
    env.PGHOST!=='127.0.0.1'||env.PGDATABASE!=='vigia_alt081_ci'||
    env.PGUSER!=='vigia_ci'||Boolean(env.DATABASE_URL)||Boolean(env.RLS_DATABASE_URL)||
    env.NODE_ENV==='production'){
    throw Error('ALT086_PREPRODUCTION_CI_ONLY');
  }
}

export const ALT086_RUNTIME_GATE=Object.freeze({
  productionAllowed:false,
  operationalDriverIntegrated:false,
  authenticatedClientReadOnly:true,
  ownerAnalystWorkerWebhookCertified:false,
  requiresStagingSnapshot:true,
  requiresOwnerApproval:true,
});
