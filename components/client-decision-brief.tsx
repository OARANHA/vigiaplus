'use client';
import { ArrowUpRight, CalendarClock, FileSearch, ShieldAlert } from 'lucide-react';

type Incident={id:number;title:string;status:string;severity:string;owner?:string};
type Evidence={id:number;title:string|null;url:string|null;source:string;projectName:string;publishedAt:string|null};
export type ClientBrief={
  open_incidents?:number;
  incidents?:Incident[];
  reputations?:{score:number|null;headline:string}[];
  work_evidence?:{mentions_collected?:number;comments_analyzed?:number;sources_monitored?:number;
    updated_at?:string|null};
  collection?:{status:string;lastAttemptAt:string;finishedAt:string|null;newCount:number}|null;
};
function formatDate(raw:string|null|undefined):string{
  if(!raw)return 'Sem registro';
  const d=new Date(raw);
  return Number.isNaN(d.getTime())?'Data indisponível':
    d.toLocaleString('pt-BR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function collectionLabel(status:string):string{
  const names:Record<string,string>={success:'Concluída',partial:'Parcial',failed:'Com falha',
    running:'Em andamento',pending:'Pendente'};
  return names[status]??'Estado não identificado';
}
export function ClientDecisionBrief({data,evidence,evidenceError,onCrises,onEvidence}:{
  data:ClientBrief;evidence:Evidence[]|null;evidenceError:string;
  onCrises:()=>void;onEvidence:()=>void;
}){
  const incidents=data.incidents??[];
  const highest=incidents.find(i=>['high','critical'].includes(i.severity.toLowerCase()));
  const next=highest??incidents[0];
  const featured=evidence?.[0]??null;
  const analyzed=data.work_evidence?.comments_analyzed??0;
  const collected=data.work_evidence?.mentions_collected??0;
  const coverage=collected>0?Math.min(100,Math.round(analyzed/collected*100)):null;
  return (
    <section aria-labelledby="briefing-heading" className="cp-decision-brief">
      <div className="cp-decision-main">
        <h2 id="briefing-heading">O que merece sua atenção</h2>
        {next?(
          <>
            <div className="cp-decision-badge"><ShieldAlert size={15} aria-hidden="true"/>
              {highest?'Ocorrência de alta prioridade':'Ocorrência em acompanhamento'}</div>
            <h3>{next.title}</h3>
            <p>Ocorrência registrada no sistema. Responsável: {next.owner||'não definido'}.
              Confira o contexto antes de decidir qualquer resposta pública.</p>
            <button type="button" onClick={onCrises} className="cp-decision-action">
              Examinar ocorrência <ArrowUpRight size={16} aria-hidden="true"/>
            </button>
          </>
        ):featured?(
          <>
            <div className="cp-decision-badge"><FileSearch size={15} aria-hidden="true"/> Última evidência cadastrada</div>
            <h3>{featured.title||'Publicação sem título'}</h3>
            <p>{featured.source} · {featured.projectName} · {formatDate(featured.publishedAt)}.
              Veja a fonte original e avalie se precisa de acompanhamento.</p>
            {featured.url?(
              <a href={featured.url} target="_blank" rel="noopener noreferrer" className="cp-decision-action">
                Ler na fonte original <ArrowUpRight size={16} aria-hidden="true"/>
              </a>
            ):(
              <button type="button" className="cp-decision-action" onClick={onEvidence}>
                Ver publicações <ArrowUpRight size={16} aria-hidden="true"/>
              </button>
            )}
          </>
        ):(
          <>
            <div className="cp-decision-badge"><FileSearch size={15} aria-hidden="true"/> Evidências indisponíveis</div>
            <h3>{evidenceError?'Não foi possível carregar as publicações':'Ainda não há publicações para examinar'}</h3>
            <p>{evidenceError?'O panorama permanece visível. A consulta de publicações pode ser repetida.':
              'Configure fontes e aguarde as primeiras coletas. A ausência de resultados não confirma ausência de repercussão.'}</p>
            <button type="button" onClick={onEvidence} className="cp-decision-action">
              Consultar evidências <ArrowUpRight size={16} aria-hidden="true"/>
            </button>
          </>
        )}
      </div>
      <div className="cp-decision-context">
        <h3>Base desta leitura</h3>
        <p>Indicadores calculados com registros do cliente, não com previsões.</p>
        <div className="cp-decision-line"><span>Janela de análise</span><strong>14 dias</strong></div>
        <div className="cp-decision-line"><span>Menções coletadas</span><strong>{collected.toLocaleString('pt-BR')}</strong></div>
        <div className="cp-decision-line"><span>Menções analisadas</span><strong>{analyzed.toLocaleString('pt-BR')}</strong></div>
        {coverage!==null&&<div className="cp-decision-line"><span>Cobertura da análise</span>
          <strong>{coverage}%</strong></div>}
        <div className="cp-decision-line"><span>Última tentativa de coleta</span>
          <strong>{data.collection?collectionLabel(data.collection.status):'Sem histórico'}</strong></div>
        <p className="cp-decision-timestamp"><CalendarClock size={14} aria-hidden="true"/>
          {formatDate(data.collection?.lastAttemptAt)}</p>
        {data.reputations?.every(r=>r.score===null)&&
          <p className="cp-decision-caveat">Pontuação de reputação indisponível até existir cálculo auditável por alvo.</p>}
      </div>
    </section>
  );
}
