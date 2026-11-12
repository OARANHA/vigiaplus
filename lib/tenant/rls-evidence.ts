/**
 * ALT-08.4 — primeira rota candidata: evidências de cliente.
 * SQL fixo e projetado, sem identificadores ou valores SQL de origem do HTTP.
 * A autorização do contexto e o SET LOCAL ocorrem na camada RLS existente.
 */
import type { TenantSqlClient } from './rls-transaction';

export type RlsEvidenceRow = {
  id:number;
  title:string|null;
  url:string|null;
  source:string;
  publishedAt:Date|string|null;
  projectName:string;
};
export function checkedEvidenceLimit(limit:number):number {
  if(!Number.isSafeInteger(limit))throw new Error('RLS_EVIDENCE_LIMIT_INVALID');
  return Math.max(1,Math.min(25,limit));
}
export async function selectRlsEvidence(
  query:TenantSqlClient['query'],
  limit=12,
):Promise<RlsEvidenceRow[]> {
  const safeLimit=checkedEvidenceLimit(limit);
  const result=await query(
    `SELECT m.id,m.title,m.url,m.source,m.published_at AS "publishedAt",
            p.name AS "projectName"
       FROM public.mentions m
       JOIN public.projects p ON p.id=m.project_id
      ORDER BY m.published_at DESC, m.id DESC
      LIMIT $1`,
    [safeLimit],
  );
  return result.rows.map(row=>{
    const id=Number(row.id);
    if(!Number.isSafeInteger(id)||id<=0||typeof row.source!=='string'
       ||typeof row.projectName!=='string') {
      throw new Error('RLS_EVIDENCE_ROW_INVALID');
    }
    return {
      id,
      title:typeof row.title==='string'?row.title:null,
      url:typeof row.url==='string'?row.url:null,
      source:row.source,
      publishedAt:row.publishedAt instanceof Date||typeof row.publishedAt==='string'
        ?row.publishedAt:null,
      projectName:row.projectName,
    };
  });
}
export function isAlt084EvidencePilotEnabled(env:Readonly<Record<string, string | undefined>>):boolean {
  // Definido explicitamente por CI e nunca por request.
  return env.VIGIA_ALT084_EVIDENCE_MODE==='ci-read-only'
    && env.VIGIA_RLS_MODE==='ci-experimental'
    && env.CI==='true'
    && env.GITHUB_ACTIONS==='true'
    && env.NODE_ENV!=='production'
    && !env.DATABASE_URL;
}
