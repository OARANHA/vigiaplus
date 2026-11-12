/**
 * ALT-08.4 — RLS de leitura para projects e mentions.
 * Regras são apenas material de homologação (não são aplicadas em produção).
 * projects possui tenant_id, mentions herda seu tenant pelo project_id.
 */
export const ALT084_EVIDENCE_POLICY_NAMES=[
  'alt084_projects_read','alt084_mentions_read',
] as const;
export const ALT084_EVIDENCE_POLICY_SQL = [
  `ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.projects FORCE ROW LEVEL SECURITY`,
  `ALTER TABLE public.mentions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE public.mentions FORCE ROW LEVEL SECURITY`,
  `CREATE POLICY alt084_projects_read ON public.projects
     AS PERMISSIVE FOR SELECT
     USING (
       tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer
     )`,
  `CREATE POLICY alt084_mentions_read ON public.mentions
     AS PERMISSIVE FOR SELECT
     USING (
       EXISTS (
         SELECT 1 FROM public.projects p
         WHERE p.id = project_id
       )
     )`,
] as const;

export const ALT084_EVIDENCE_ROLLBACK_SQL = [
  'DROP POLICY IF EXISTS alt084_mentions_read ON public.mentions',
  'DROP POLICY IF EXISTS alt084_projects_read ON public.projects',
  'ALTER TABLE public.mentions NO FORCE ROW LEVEL SECURITY',
  'ALTER TABLE public.projects NO FORCE ROW LEVEL SECURITY',
  'ALTER TABLE public.mentions DISABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.projects DISABLE ROW LEVEL SECURITY',
] as const;
