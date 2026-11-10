'use client';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, Layers3, Radar, ShieldAlert } from 'lucide-react';

export type OperationalOverview = {
  generatedAt:string;
  summary:{clients:number;projects:number;projectsWithoutRuns:number;
    projectsWithFailedRuns:number;openIncidents:number;criticalIncidents:number;
    invoicesOverdue:number;lastCollectionAt:string|null};
  clients:{id:number;name:string;status:string;projects:number;incidentsOpen:number;
    criticalIncidents:number;collection:string;lastCollectionAt:string|null;
    overdueInvoices:number}[];
  signals:{id:string;tenantId:number;tenantName:string;priority:'critica'|'atencao'|'informativa';
    kind:'incident'|'collection'|'invoice'|'coverage';title:string;explanation:string}[];
};

function ptDate(iso:string|null):string{
  if(!iso)return 'Sem execução registrada';
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?'Data indisponível':
    d.toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
}
function destination(kind:string,tenantId:number):string{
  if(kind==='invoice')return '#financeiro';
  if(kind==='collection'||kind==='coverage')return '/settings';
  return '/portal?tenant_id='+tenantId;
}
function priorityText(priority:string):string{
  return priority==='critica'?'Alta prioridade':priority==='atencao'?'Verificar':'Informativo';
}
function StatusRow({name,value,detail}:{name:string;value:string|number;detail?:string}){
  return <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3 last:border-0">
    <span className="text-sm text-slate-300">{name}</span>
    <span className="text-right"><strong className="block text-sm font-semibold tabular-nums text-slate-100">{value}</strong>
      {detail&&<small className="text-[11px] text-slate-400">{detail}</small>}</span>
  </div>;
}
export function OwnerOperationalOverview({overview,loading}:{
  overview:OperationalOverview|null;loading:boolean;
}){
  const summary=overview?.summary;
  return <section aria-labelledby="owner-operations" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="owner-operations" className="text-xl font-semibold text-slate-100">Sua operação agora</h2>
        <p className="mt-1 text-sm text-slate-400">Prioridades da carteira, derivadas de ocorrências, últimas coletas e faturas registradas.</p>
      </div>
      {overview?.generatedAt&&<time dateTime={overview.generatedAt}
        className="text-xs text-slate-400">Consulta de {ptDate(overview.generatedAt)}</time>}
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(285px,1fr)]">
      <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-300" aria-hidden="true"/>
            <h3 className="font-semibold text-slate-100">Fila de atenção</h3>
          </div>
          {overview&&<span className="text-xs tabular-nums text-slate-400">{overview.signals.length} sinais registrados</span>}
        </div>
        {!overview?<p role="status" className="py-7 text-sm text-slate-400">
          {loading?'Consultando ocorrências e coletas…':'Não foi possível consultar a operação. Use Atualizar dados.'}
        </p>:overview.signals.length===0?(
          <div className="flex gap-3 rounded-xl bg-[var(--panel-2)] p-4">
            <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={19} aria-hidden="true"/>
            <div><p className="text-sm font-medium text-slate-100">Nenhuma pendência nas categorias verificadas.</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">Isso não significa ausência de risco externo. Confira também fontes e menções recentes.</p>
            </div>
          </div>
        ):(
          <div className="divide-y divide-[var(--border)]">
            {overview.signals.map(s=><div key={s.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span aria-hidden="true" className={'mt-1 size-2 shrink-0 rounded-full '+
                (s.priority==='critica'?'bg-rose-400':s.priority==='atencao'?'bg-amber-400':'bg-sky-400')}/>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-200">{s.tenantName}
                  <span className="ml-2 font-normal text-slate-400">· {priorityText(s.priority)}</span></p>
                <p className="mt-1 text-sm font-medium text-slate-100">{s.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{s.explanation}</p>
              </div>
              <Link href={destination(s.kind,s.tenantId)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-sky-300 hover:bg-sky-400/10 focus-visible:outline-2 focus-visible:outline-sky-400">
                Examinar <ArrowUpRight size={14} aria-hidden="true"/>
              </Link>
            </div>)}
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-3 flex items-center gap-2"><Radar size={18} className="text-sky-300" aria-hidden="true"/>
          <h3 className="font-semibold text-slate-100">Cobertura da operação</h3></div>
        <StatusRow name="Projetos de monitoramento" value={summary?.projects??'—'}/>
        <StatusRow name="Sem histórico de coleta" value={summary?.projectsWithoutRuns??'—'}
          detail="Ausência de execução, não falha"/>
        <StatusRow name="Última coleta com falha" value={summary?.projectsWithFailedRuns??'—'}
          detail="Estado da última execução por projeto"/>
        <StatusRow name="Ocorrências abertas" value={summary?.openIncidents??'—'}
          detail={summary?summary.criticalIncidents+' de alta prioridade':undefined}/>
        <StatusRow name="Faturas marcadas em atraso" value={summary?.invoicesOverdue??'—'}/>
        <div className="mt-4 flex items-center gap-2 border-t border-[var(--border)] pt-4 text-xs text-slate-400">
          <Clock3 size={14} className="shrink-0" aria-hidden="true"/>
          Última tentativa registrada: {ptDate(summary?.lastCollectionAt??null)}
        </div>
      </div>
    </div>
    {overview&&overview.clients.length>0&&(
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex items-center gap-2"><Layers3 size={18} className="text-sky-300" aria-hidden="true"/>
          <h3 className="font-semibold text-slate-100">Carteira por situação</h3>
          <span className="ml-auto text-xs text-slate-400">{overview.clients.length} organizações</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[630px] text-left text-xs">
            <thead className="border-b border-[var(--border)] text-slate-400">
              <tr><th className="py-3 font-medium">Organização</th><th className="py-3 font-medium">Coleta</th>
                <th className="py-3 font-medium">Ocorrências</th><th className="py-3 font-medium">Última tentativa</th>
                <th className="py-3 text-right font-medium">Visão do cliente</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {overview.clients.map(c=><tr key={c.id} className="text-slate-200">
                <td className="py-3 pr-4 font-medium">{c.name}</td>
                <td className="py-3 pr-4">{({
                  sem_projeto:'Sem projeto automático',sem_historico:'Sem histórico',falha:'Falha registrada',
                  parcial:'Parcial',concluida:'Última execução concluída',em_andamento:'Em execução / pendente',
                } as Record<string,string>)[c.collection]??c.collection}</td>
                <td className="py-3 pr-4 tabular-nums">{c.incidentsOpen}</td>
                <td className="py-3 pr-4">{ptDate(c.lastCollectionAt)}</td>
                <td className="py-3 text-right"><Link href={'/portal?tenant_id='+c.id}
                  className="inline-flex min-h-10 items-center gap-1 text-sky-300 hover:underline">
                  Visualizar <ArrowUpRight size={13} aria-hidden="true"/></Link></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>)}
  </section>;
}
