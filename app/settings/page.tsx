import Link from 'next/link';
import { Plus, Trash2, Link2, Star, Radar, UploadCloud, Antenna } from 'lucide-react';
import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { shareLinks } from '@/lib/db/schema';
import { CopyButton } from '@/components/copy-button';
import { DeleteProject } from '@/components/delete-project';
import { SubmitButton } from '@/components/submit-button';
import { getBenchmarkEntities, getCurrentProject, getProjects } from '@/lib/data';
import { PageHeader, EmptyState } from '@/components/ui';
import { getT } from '@/lib/i18n';
import type { projects as projectsTable } from '@/lib/db/schema';
import { EditableEntity } from '@/components/editable-entity';
import {
  addEntity, createProject, createImportProject, createTalkwalkerProject, createShareLink, deleteEntity,
  revokeShareLink, setOwnBrand, updateEntity, updateProject, updateImportProject,
  updateTalkwalkerProject,
} from './actions';
import { listTalkwalkerTopics } from '@/lib/connectors/talkwalker';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';

type Project = typeof projectsTable.$inferSelect;

const LANGS = [
  ['it', 'Italiano'], ['en', 'Inglês'], ['es', 'Espanhol'],
  ['fr', 'Francês'], ['de', 'Alemão'], ['pt', 'Português'],
] as const;

const COUNTRIES = [
  ['IT', 'Itália'], ['US', 'Estados Unidos'], ['GB', 'Reino Unido'], ['FR', 'França'],
  ['DE', 'Alemanha'], ['ES', 'Espanha'], ['BR', 'Brasil'], ['MX', 'México'],
  ['CA', 'Canadá'], ['AU', 'Austrália'], ['IN', 'Índia'], ['NL', 'Países Baixos'],
  ['PL', 'Polônia'], ['JP', 'Japão'],
] as const;

const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none placeholder:text-slate-600';
const btnCls = 'rounded-lg bg-sky-500/90 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400';

export const metadata = { title: 'Projetos' };

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const sp = await searchParams;
  const [allProjects, current] = await Promise.all([getProjects(), getCurrentProject()]);
  if (allProjects.length === 0) return <EmptyState message="Nenhum projeto cadastrado." />;

  const isNew = sp.p === 'new';
  const newType = sp.type; // 'listening' | 'import' | 'talkwalker' | undefined (chooser)
  const selected = isNew
    ? null
    : allProjects.find((p) => p.id === Number(sp.p)) ?? current ?? allProjects[0];
  const entities = selected ? await getBenchmarkEntities(selected.id) : [];

  // I topic si leggono da Talkwalker solo quando servono davvero: chiamata
  // gratuita ma con rate limit stretto (20/min), e un errore qui non deve
  // impedire di aprire le impostazioni — si mostra il motivo e si va avanti.
  let twTopics: { id: string; label: string }[] = [];
  let twTopicsError: string | null = null;
  if (selected?.mode === 'talkwalker' && selected.talkwalkerProject) {
    try {
      await hydrateConnectorCredentials();
      twTopics = await listTalkwalkerTopics(selected.talkwalkerProject);
    } catch (e) {
      twTopicsError = (e as Error).message;
    }
  }
  const db = await getDb();
  const activeShares = selected
    ? await db.select().from(shareLinks)
      .where(and(eq(shareLinks.projectId, selected.id), gte(shareLinks.expiresAt, new Date())))
    : [];
  const shareBase = process.env.APP_URL ?? '';

  return (
    <>
      <PageHeader
        title={t('page.settings.title', 'Projetos')}
        subtitle="Cada projeto tem suas próprias fontes, consultas, idiomas, regiões e entidades monitoradas."
      />

      {/* Project tabs */}
      <div className="mb-0 flex flex-wrap items-end gap-1 border-b border-[var(--border)]">
        {allProjects.map((p) => {
          const active = !isNew && selected?.id === p.id;
          return (
            <Link
              key={p.id}
              href={`/settings?p=${p.id}`}
              className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm transition ${
                active
                  ? 'border-[var(--border)] bg-[var(--panel)] font-medium text-sky-300'
                  : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {p.name}
            </Link>
          );
        })}
        <Link
          href="/settings?p=new"
          className={`flex items-center gap-1.5 rounded-t-lg border border-b-0 px-4 py-2 text-sm transition ${
            isNew
              ? 'border-[var(--border)] bg-[var(--panel)] font-medium text-sky-300'
              : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
          }`}
        >
          <Plus className="size-4" /> Novo projeto
        </Link>
      </div>

      <div className="mx-auto max-w-3xl">
        <div>
          {/* key legata al progetto: forza il remount dei campi (defaultValue) quando
              si cambia scheda, altrimenti gli input non controllati restano coi valori vecchi. */}
          <section key={isNew ? `new-${newType ?? 'choose'}` : selected?.id ?? 'none'} className="panel rounded-t-none border-t-0 px-5 py-5">
            {isNew ? (
              !newType ? (
                /* Passo 0: che tipo di progetto? */
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-slate-300">Qual tipo de projeto deseja criar?</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Link href="/settings?p=new&type=listening"
                      className="group flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.02] px-4 py-4 transition hover:border-sky-500/50 hover:bg-sky-500/[0.05]">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Radar className="size-4 text-sky-400" /> Monitoramento</span>
                      <span className="text-xs leading-snug text-slate-400">O VigiaPlus coleta menções na web, em notícias, redes e RSS. Você define os termos e as fontes.</span>
                    </Link>
                    <Link href="/settings?p=new&type=import"
                      className="group flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.02] px-4 py-4 transition hover:border-sky-500/50 hover:bg-sky-500/[0.05]">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-100"><UploadCloud className="size-4 text-sky-400" /> Importar arquivo</span>
                      <span className="text-xs leading-snug text-slate-400">Importe planilhas Excel ou CSV, como pesquisas e relatórios exportados, sem coleta automática na web.</span>
                    </Link>
                    <Link href="/settings?p=new&type=talkwalker"
                      className="group flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.02] px-4 py-4 transition hover:border-teal-500/50 hover:bg-teal-500/[0.05]">
                      <span className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Antenna className="size-4 text-teal-400" /> Talkwalker</span>
                      <span className="text-xs leading-snug text-slate-400">Consulte menções de sua conta corporativa Talkwalker pela API oficial. Consome créditos do contrato Talkwalker.</span>
                    </Link>
                  </div>
                </div>
              ) : newType === 'talkwalker' ? (
                <form action={createTalkwalkerProject} className="flex flex-col gap-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300"><Antenna className="size-4 text-teal-400" /> Novo projeto Talkwalker</h2>
                  <p className="text-xs leading-relaxed text-slate-400">
                    A busca já está configurada no Talkwalker. Informe o projeto corporativo para importar menções, etiquetas e correções.
                  </p>
                  <TalkwalkerFields project={null} topics={[]} topicsError={null} />
                  <TalkwalkerNotice />
                  <p className="text-xs text-slate-500">Depois de criar, você poderá selecionar os tópicos específicos desse projeto Talkwalker.</p>
                  <div className="mt-2 flex items-center gap-3 border-t border-[var(--border)] pt-4">
                    <SubmitButton className={btnCls} pendingLabel="Criando projeto…">Criar e configurar consultas →</SubmitButton>
                    <Link href="/settings?p=new" className="text-xs text-slate-500 hover:text-slate-300">← Voltar</Link>
                  </div>
                </form>
              ) : newType === 'import' ? (
                <form action={createImportProject} className="flex flex-col gap-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300"><UploadCloud className="size-4 text-sky-400" /> Novo projeto de importação</h2>
                  <label className="text-xs text-slate-400">
                    Nome do projeto
                    <input name="name" className={`${inputCls} mt-1`} placeholder="Ex.: pesquisas do segundo trimestre" required />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" name="shared" className="accent-sky-500" />
                    Compartilhar este projeto com a equipe (demais membros somente leitura)
                  </label>
                  <p className="text-xs text-slate-500">Depois, envie o arquivo Excel/CSV e associe as colunas aos campos do VigiaPlus.</p>
                  <div className="mt-2 flex items-center gap-3 border-t border-[var(--border)] pt-4">
                    <SubmitButton className={btnCls} pendingLabel="Criando…">Criar e enviar arquivo</SubmitButton>
                    <Link href="/settings?p=new" className="text-xs text-slate-500 hover:text-slate-300">← Voltar</Link>
                  </div>
                </form>
              ) : (
                <form action={createProject} className="flex flex-col gap-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300"><Radar className="size-4 text-sky-400" /> Novo projeto de monitoramento</h2>
                  <ProjectFields project={null} />
                  <div className="mt-2 flex items-center gap-3 border-t border-[var(--border)] pt-4">
                    <SubmitButton className={btnCls} pendingLabel="Criando projeto…">Criar e configurar consultas →</SubmitButton>
                    <Link href="/settings?p=new" className="text-xs text-slate-500 hover:text-slate-300">← Voltar</Link>
                  </div>
                </form>
              )
            ) : selected && (
              <>
                {selected.mode === 'talkwalker' ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-teal-500/25 bg-teal-500/[0.05] px-4 py-3">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-teal-200"><Antenna className="size-4" /> Projeto Talkwalker</span>
                      <span className="text-xs text-slate-400">— menções obtidas apenas pela API corporativa do Talkwalker.</span>
                    </div>
                    <form action={updateTalkwalkerProject} className="flex flex-col gap-4">
                      <input type="hidden" name="id" value={selected.id} />
                      <TalkwalkerFields project={selected} topics={twTopics} topicsError={twTopicsError} />
                      <TalkwalkerNotice />
                      <div className="mt-2 border-t border-[var(--border)] pt-4">
                        <SubmitButton className={btnCls} pendingLabel="Salvando…">Salvar alterações</SubmitButton>
                      </div>
                    </form>
                  </>
                ) : selected.mode === 'upload' ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.05] px-4 py-3">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-sky-200"><UploadCloud className="size-4" /> Projeto de importação</span>
                      <span className="text-xs text-slate-400">— dados obtidos apenas dos arquivos enviados, sem coleta web.</span>
                      <Link href={`/import?project=${selected.id}`}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400">
                        <UploadCloud className="size-3.5" /> Importar arquivo
                      </Link>
                    </div>
                    <form action={updateImportProject} className="flex flex-col gap-4">
                      <input type="hidden" name="id" value={selected.id} />
                      <label className="text-xs text-slate-400">
                        Nome do projeto
                        <input name="name" defaultValue={selected.name} className={`${inputCls} mt-1`} required />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-300">
                        <input type="checkbox" name="shared" defaultChecked={selected.visibility === 'shared'} className="accent-sky-500" />
                        Compartilhar este projeto com a equipe (demais membros somente leitura)
                      </label>
                      <div className="mt-2 border-t border-[var(--border)] pt-4">
                        <SubmitButton className={btnCls} pendingLabel="Salvando…">Salvar alterações</SubmitButton>
                      </div>
                    </form>
                  </>
                ) : (
                  <form action={updateProject} className="flex flex-col gap-4">
                    <input type="hidden" name="id" value={selected.id} />
                    <ProjectFields project={selected} />
                    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
                      <SubmitButton className={btnCls} pendingLabel="Salvando…">Salvar alterações</SubmitButton>
                    </div>
                  </form>
                )}

                <hr className="my-5 border-[var(--border)]" />

                <h3 className="mb-1 text-sm font-semibold text-slate-300">Entidades para comparação</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Marcas e concorrentes para comparar: menções que contêm os termos cadastrados são atribuídas à entidade.
                  Ao salvar o plano de consulta, a entidade monitorada e os concorrentes são atualizados; as demais permanecem.
                  Marque uma entidade com a estrela <Star className="inline size-3 -translate-y-px text-amber-400" /> para defini-la como <span className="text-amber-300">sua marca</span> —
                  isso habilita o índice de saúde da marca, comparando-a ao mercado e aos concorrentes.
                </p>
                <div className="flex flex-col gap-2">
                  {entities.map((e) => (
                    <EditableEntity
                      key={e.id} entity={e} projectId={selected.id} inputCls={inputCls}
                      updateEntity={updateEntity} setOwnBrand={setOwnBrand} deleteEntity={deleteEntity}
                    />
                  ))}
                  {entities.length === 0 && (
                    <p className="text-xs text-slate-600">Nenhuma entidade cadastrada. Adicione uma para habilitar comparações.</p>
                  )}
                </div>
                <form action={addEntity} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="projectId" value={selected.id} />
                  <input name="name" placeholder="Nome da entidade" className={inputCls} required />
                  <input name="keywords" placeholder="Termos associados (opcional)" className={inputCls} />
                  <SubmitButton pendingLabel="Adicionando…"
                    className="shrink-0 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
                    Add
                  </SubmitButton>
                </form>

                <hr className="my-5 border-[var(--border)]" />

                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-300">
                  <Link2 className="size-4 text-sky-400" /> Compartilhamento
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Crie um link de leitura para compartilhar o relatório sem enviar a senha. O acesso expira automaticamente.
                </p>
                <div className="flex flex-col gap-2">
                  {activeShares.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs">
                      <code className="truncate text-sky-300">{shareBase ? `${shareBase}/share/${s.token}` : `/share/${s.token}`}</code>
                      <span className="text-slate-500">expira em {s.expiresAt.toLocaleDateString('pt-BR')}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <CopyButton text={shareBase ? `${shareBase}/share/${s.token}` : `/share/${s.token}`} />
                        <form action={revokeShareLink}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="rounded-md px-2 py-1 text-red-400/80 hover:bg-red-500/10">Revogar</button>
                        </form>
                      </span>
                    </div>
                  ))}
                  {activeShares.length === 0 && (
                    <p className="text-xs text-slate-600">Nenhum link ativo.</p>
                  )}
                </div>
                <form action={createShareLink} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="projectId" value={selected.id} />
                  <select name="days" defaultValue="7"
                    className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-2 text-sm outline-none">
                    <option value="1">1 dia</option>
                    <option value="7">7 dias</option>
                    <option value="30">30 dias</option>
                  </select>
                  <SubmitButton pendingLabel="Criando link…"
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
                    Create shareable link
                  </SubmitButton>
                </form>

                {allProjects.length > 1 && (
                  <div className="mt-6 border-t border-red-500/20 pt-4">
                    <DeleteProject id={selected.id} name={selected.name} />
                  </div>
                )}
              </>
            )}
          </section>
          <p className="mt-2 px-1 text-[11px] text-slate-600">
            Atenção: cada projeto ativo consome a cota das APIs a cada atualização. Ajuste os limites conforme seu orçamento.
            O status das fontes e o orçamento estão em <span className="text-slate-400">Configurações → Fontes e orçamento</span>.
          </p>
        </div>
      </div>
    </>
  );
}

/** Project fields, shared between create and edit. */
/**
 * I campi di un progetto Talkwalker: da dove prendere i dati, non cosa cercare.
 *
 * I topic sono quelli già configurati in Talkwalker, letti dalla sua Resources
 * API: si spuntano, non si scrivono. Nessuna spunta = tutto quello che il
 * progetto raccoglie, che è il caso di chi vuole i dati prima delle domande.
 */
function TalkwalkerFields({ project, topics, topicsError }: {
  project: Project | null;
  topics: { id: string; label: string }[];
  topicsError: string | null;
}) {
  const chosen = new Set(project?.talkwalkerTopics ?? []);
  return (
    <>
      <label className="text-xs text-slate-400">
        Nome do projeto (in Radar)
        <input name="name" defaultValue={project?.name} className={`${inputCls} mt-1`}
          placeholder="Ex.: reputação institucional" required />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="shared" defaultChecked={project?.visibility === 'shared'} className="accent-sky-500" />
        Compartilhar este projeto com a equipe (demais membros somente leitura)
      </label>
      <label className="text-xs text-slate-400">
        Identificador do projeto Talkwalker
        <input name="talkwalkerProject" defaultValue={project?.talkwalkerProject ?? ''}
          className={`${inputCls} mt-1`} placeholder="e.g. kpnutesu_123456" required />
        <span className="mt-1 block text-[11px] text-slate-500">
          Consulte o responsável pela conta ou a URL do projeto no Talkwalker.
        </span>
      </label>

      {project && (
      <fieldset className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/40 px-4 py-3">
        <legend className="px-1 text-xs text-slate-400">Origem dos dados</legend>
        {topics.length > 0 ? (
          <>
            <p className="mb-2 text-[11px] text-slate-500">
              Tópicos cadastrados no projeto Talkwalker. <strong>Não marque nenhum para incluir todos os tópicos</strong> coletados; você poderá restringi-los depois.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {topics.map((t) => (
                <label key={t.id} className="flex items-center gap-1.5 text-sm text-slate-300">
                  <input type="checkbox" name="talkwalkerTopics" value={t.id}
                    defaultChecked={chosen.has(t.id)} className="accent-teal-500" />
                  <span className="truncate" title={t.label}>{t.label}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-500">
            {topicsError
              ? `Não foi possível consultar os tópicos do Talkwalker: ${topicsError}. O VigiaPlus utilizará todos os tópicos coletados pelo projeto.`
              : 'Após configurar o token, os tópicos do projeto Talkwalker aparecerão aqui. Até lá, todos serão considerados.'}
          </p>
        )}
      </fieldset>
      )}

      <label className="text-xs text-slate-400">
        <span className="text-violet-300">✨ Descrição dos tópicos</span> — opcional; orienta a análise de relevância por IA sem alterar a coleta
        <textarea name="semanticContext" defaultValue={project?.semanticContext ?? ''} rows={2}
          className={`${inputCls} mt-1 resize-y`}
          placeholder="Ex.: reputação do grupo nos segmentos de seguros e mobilidade" />
      </label>
    </>
  );
}

/** Il costo non è un dettaglio da nascondere: si spendono soldi del contratto. */
function TalkwalkerNotice() {
  return (
    <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
      Cada atualização executa uma consulta Talkwalker por grupo de até 40 termos: <strong>10 créditos por consulta, mais 1 por resultado</strong>, debitados do contrato Talkwalker. Configure o token em Configurações → Fontes.
    </p>
  );
}

function ProjectFields({ project }: { project: Project | null }) {
  return (
    <>
      <label className="text-xs text-slate-400">
        Nome do projeto
        <input name="name" defaultValue={project?.name} className={`${inputCls} mt-1`}
          placeholder="Ex.: energia renovável" required />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="shared" defaultChecked={project?.visibility === 'shared'} className="accent-sky-500" />
        Compartilhar este projeto com a equipe (demais membros somente leitura)
      </label>
      {project ? (
        // La query non si scrive più qui: ha una pagina sua, dove si
        // costruisce a parole, si prova e si modifica.
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.05] px-4 py-3">
          <div className="min-w-0 flex-1 text-xs text-slate-300">
            <p className="font-medium text-sky-200">O que este projeto monitora</p>
            <p className="mt-0.5 text-slate-400">
              {project.queryPlan
                ? `${project.queryPlan.queries.filter((q) => q.enabled).length} consultas ativas criadas a partir de: “${project.queryPlan.brief.slice(0, 140)}${project.queryPlan.brief.length > 140 ? '…' : ''}”`
                : project.keywords.length
                  ? `Consulta legada (${project.keywords.slice(0, 4).join(', ')}${project.keywords.length > 4 ? '…' : ''}). Abra o editor de consultas para reorganizá-la.`
                  : 'Nenhuma consulta criada. O projeto não coleta dados até você configurar uma.'}
            </p>
          </div>
          <Link href={`/query?project=${project.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400">
            Abrir editor de consultas
          </Link>
        </div>
      ) : (
        <label className="text-xs text-slate-400">
          <span className="text-sky-300">O que deseja monitorar?</span> — descreva em linguagem natural; o VigiaPlus criará consultas que você poderá testar e editar
          <textarea name="semanticContext" rows={3}
            className={`${inputCls} mt-1 resize-y`}
            placeholder="Ex.: empresa Acme, mobilizações de funcionários e concorrentes Alfa, Beta e Gama" />
        </label>
      )}
      <fieldset className="text-xs text-slate-400">
        Idiomas (notícias e pesquisas)
        <div className="mt-1.5 flex flex-wrap gap-3">
          {LANGS.map(([code, label]) => (
            <label key={code} className="flex items-center gap-1.5 text-sm text-slate-300">
              <input type="checkbox" name="languages" value={code}
                defaultChecked={project ? project.languages.includes(code) : code === 'pt'}
                className="accent-sky-500" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="text-xs text-slate-400">
        Regiões (para fontes de notícias; sem seleção = mundo todo)
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          {COUNTRIES.map(([code, label]) => (
            <label key={code} className="flex items-center gap-1.5 text-sm text-slate-300">
              <input type="checkbox" name="countries" value={code}
                defaultChecked={(project?.countries ?? []).includes(code)} className="accent-sky-500" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-xs text-slate-400">
        Canais Telegram monitorados (usuários separados por vírgula, ex.: @reuters)
        <input name="telegramChannels" defaultValue={(project?.telegramChannels ?? []).map((c) => `@${c}`).join(', ')}
          className={`${inputCls} mt-1`} placeholder="Ex.: @canal1, @canal2 (opcional)" />
      </label>
      <label className="text-xs text-slate-400">
        Feeds RSS/Atom (URLs separadas por vírgula ou linha) — jornais, blogs e alertas do Google…
        <textarea name="rssFeeds" defaultValue={(project?.rssFeeds ?? []).join('\n')} rows={2}
          className={`${inputCls} mt-1 resize-y`}
          placeholder="Ex.: https://exemplo.com/feed.xml (opcional, até 15)" />
      </label>
      <label className="text-xs text-slate-400">
        Tom de voz da marca — usado pelo Estúdio de Conteúdo na criação de textos
        <textarea name="brandVoice" defaultValue={project?.brandVoice ?? ''} rows={2}
          className={`${inputCls} mt-1 resize-y`}
          placeholder="Ex.: profissional, direto e sem jargões desnecessários (opcional)" />
      </label>
    </>
  );
}
