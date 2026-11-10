'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ExternalLink,ShieldCheck} from 'lucide-react';
import {VigiaDashboardShell,VigiaCoverageGauge,VigiaStatTile,type DashboardTab} from '@/components/vpx-dashboard-shell';
import {ClientDecisionBrief} from '@/components/client-decision-brief';

type Tenant={id:number;name:string;plan?:string};
type Incident={id:number;title:string;status:string;severity:string;owner?:string};
type Reputation={id:number;name:string;kind:string;score:number|null;headline:string};
type Evidence={id:number;title:string|null;source:string;projectName:string;url:string|null;publishedAt:string|null};
type Summary={
 greeting?:string;error?:string;incidents?:Incident[];reputations?:Reputation[];
 open_incidents?:number;
 work_evidence?:{mentions_collected?:number;comments_analyzed?:number;sources_monitored?:number;
  subjects_tracked?:number;window_days?:number;updated_at?:string|null};
 collection?:{status:string;lastAttemptAt:string;finishedAt:string|null;newCount:number}|null;
};
type Plan={error?:string;plan?:{label?:string;priceBrl?:number|null}|null;
 subscription_status?:string;included?:string[];
 invoices?:{id:number;amount:number;status:string}[];
 avisos?:{channels?:{channel:string;destination:string;active:boolean}[]}};
type Tab='panorama'|'crises'|'relatorios'|'conta';
const TABS:DashboardTab[]=[
 {id:'panorama',label:'Visão geral'},{id:'relatorios',label:'Publicações'},
 {id:'crises',label:'Crises e alertas'},{id:'conta',label:'Meu plano'},
];

async function getJson<T>(url:string):Promise<T>{
 const res=await fetch(url,{cache:'no-store'});
 const data=await res.json();
 if(!res.ok||data.error){
  if(res.status===401)throw Error('Sua sessão expirou. Entre novamente.');
  if(res.status===403)throw Error('Este perfil não tem acesso às informações.');
  throw Error('Falha na consulta. Atualize e tente novamente.');
 }
 return data as T;
}
function number(value:number|undefined|null):string{
 return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('pt-BR'):'—';
}
function dateBR(value:string|null|undefined,short=false):string{
 if(!value)return 'Sem registro';
 const d=new Date(value);if(Number.isNaN(d.getTime()))return 'Data indisponível';
 return d.toLocaleDateString('pt-BR',short?{day:'2-digit',month:'short'}:{day:'2-digit',month:'short',year:'numeric'});
}
function statusPT(value:string|null|undefined):string{
 const known:Record<string,string>={success:'Concluída',failed:'Com falha',partial:'Parcial',
  running:'Em andamento',pending:'Pendente',monitoring:'Em acompanhamento',
  open:'Aberta',closed:'Encerrada',resolved:'Resolvida',active:'Ativo',trial:'Em avaliação',
  overdue:'Em atraso',past_due:'Em atraso',paid:'Paga',canceled:'Cancelada',
  high:'Alta',critical:'Crítica',medium:'Média',low:'Baixa'};
 return value?known[value]??'Não identificado':'Sem registro';
}
function caseTone(severity:string):'coral'|'yellow'|'lime'{
 return severity==='critical'||severity==='high'?'coral':severity==='medium'?'yellow':'lime';
}
function emptyEvidence(error:string):string{
 return error||'Nenhuma publicação coletada para este cliente. Acompanhe após a próxima coleta autorizada.';
}
export default function ClientPortal(){
 const [tab,setTab]=useState<Tab>('panorama');
 const [owner,setOwner]=useState(false);
 const [initialized,setInitialized]=useState(false);
 const [tenants,setTenants]=useState<Tenant[]>([]);
 const [tenantId,setTenantId]=useState<number|null>(null);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [evidence,setEvidence]=useState<Evidence[]|null>(null);
 const [plan,setPlan]=useState<Plan|null>(null);
 const [error,setError]=useState('');
 const [evidenceError,setEvidenceError]=useState('');
 const [planError,setPlanError]=useState('');
 const [refreshToken,setRefreshToken]=useState(0);
 const [loading,setLoading]=useState(true);

 useEffect(()=>{
  let active=true;
  (async()=>{try{
    const permissions=await getJson<{permissions?:{role?:string;system?:boolean}}>('/api/me/permissions');
    if(!active)return;
    if(permissions.permissions?.role === 'analyst'){window.location.replace('/');return;}
    if(permissions.permissions?.role === 'owner'){
      const result=await getJson<{tenants:Tenant[]}>('/api/console/tenants');
      if(!active)return;
      setOwner(true);setTenants(result.tenants??[]);
      const requested=Number(new URLSearchParams(window.location.search).get('tenant_id'));
      const allowed=result.tenants.find(t=>t.id===requested);
      setTenantId(allowed?.id??result.tenants?.[0]?.id??null);
    }
  }catch(e){if(active)setError(e instanceof Error?e.message:'Falha ao verificar permissões.');}
  finally{if(active)setInitialized(true);}
  })();
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  if(!initialized||(owner&&!tenantId)){setLoading(false);return;}
  let active=true;
  setLoading(true);setError('');setEvidenceError('');setPlanError('');
  setSummary(null);setEvidence(null);
  const query=owner&&tenantId?'?tenant_id='+tenantId:'';
  Promise.allSettled([
    getJson<Summary>('/api/app/summary'+query),
    getJson<{items:Evidence[]}>('/api/app/evidence'+query),
  ]).then(([overview,publications])=>{
    if(!active)return;
    if(overview.status==='fulfilled')setSummary(overview.value);
    else setError('Não foi possível carregar os indicadores. As publicações ainda podem ser consultadas.');
    if(publications.status==='fulfilled')setEvidence(publications.value.items);
    else setEvidenceError('As publicações estão temporariamente indisponíveis.');
  }).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[initialized,owner,tenantId,refreshToken]);
 useEffect(()=>{
  if(tab!=='conta'||!initialized||(owner&&!tenantId))return;
  let active=true;setPlanError('');setPlan(null);
  const query=owner&&tenantId?'?tenant_id='+tenantId:'';
  getJson<Plan>('/api/app/plan'+query).then(x=>{if(active)setPlan(x);})
   .catch(()=>{if(active)setPlanError('Não foi possível consultar o plano. Atualize os dados.');});
  return()=>{active=false;};
 },[tab,initialized,owner,tenantId,refreshToken]);
 async function logout(){
  await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({logout:true})}).catch(()=>{});
  window.location.replace('/login');
 }
 const selected=tenants.find(x=>x.id===tenantId);
 const incidents=summary?.incidents??[];
 const critical=incidents.filter(x=>x.severity==='critical'||x.severity==='high');
 const lastMention=evidence?.[0]??null;
 const collected=summary?.work_evidence?.mentions_collected;
 const analyzed=summary?.work_evidence?.comments_analyzed;
 const coverage=typeof collected==='number'&&collected>0&&typeof analyzed==='number'
  ?Math.min(100,Math.round(analyzed/collected*100)):null;
 const days=summary?.work_evidence?.window_days??14;
 const collection=summary?.collection;
 const ownerExtra=owner?<div className="vpx-owner-switch">
    <Link href="/console" className="vpx-inline-link">← Console</Link>
    <select className="vpx-select" aria-label="Visualizar como cliente"
     value={tenantId??''} onChange={e=>setTenantId(Number(e.target.value))}>
      {tenants.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select></div>:null;

 return <VigiaDashboardShell role="cliente" tabs={TABS} activeTab={tab}
  onTab={id=>setTab(id as Tab)} onLogout={logout}
  onRefresh={()=>setRefreshToken(v=>v+1)} extra={ownerExtra}>
  {error&&<div role="alert" className="vpx-alert">{error}</div>}
  {!initialized||loading?<div className="vpx-card vpx-placeholder" role="status">Carregando informações autorizadas…</div>:
   owner&&!tenantId?<div className="vpx-card vpx-placeholder">Nenhum cliente cadastrado para visualizar.</div>:(
    <>
     {tab==='panorama'&&<div className="vpx-workspace">
      <div className="vpx-left">
       <section>
        <div className="vpx-section-top">
         <span className="vpx-eyebrow"><ShieldCheck size={14}/> VISÃO DE REPUTAÇÃO</span>
         <button type="button" className="vpx-linkbutton" onClick={()=>setTab('relatorios')}>
          Ver publicações <ArrowUpRight size={14}/></button>
        </div>
        <h1>{owner&&selected?selected.name:'O que importa para sua reputação'}</h1>
        <p className="vpx-description">Evidências de monitoramento organizadas para decisões. Período de {days} dias; dados sem medição aparecem como indisponíveis.</p>
       </section>
       <div className="vpx-pipeline" aria-label="Etapas do acompanhamento">
        <div className="vpx-step"><small>Etapa 1</small><div className="vpx-step-row"><span className="vpx-step-number">1</span>
         <div><strong>Coleta</strong><p>{collection?statusPT(collection.status):'Sem execução registrada'}</p></div></div></div>
        <div className="vpx-step"><small>Etapa 2</small><div className="vpx-step-row"><span className="vpx-step-number">2</span>
         <div><strong>Análise</strong><p>{coverage===null?'Aguardando dados':coverage+'% das menções'}</p></div></div></div>
        <div className="vpx-step"><small>Etapa 3</small><div className="vpx-step-row"><span className="vpx-step-number">3</span>
         <div><strong>Acompanhamento</strong><p>{number(summary?.open_incidents)} ocorrências abertas</p></div></div></div>
       </div>
       <div className="vpx-counts" aria-label="Resumo de situações">
        <span className="vpx-count coral"><b>{critical.length}</b> Alta prioridade</span>
        <span className="vpx-count"><b>{number(summary?.open_incidents)}</b> Em acompanhamento</span>
        <span className="vpx-count yellow"><b>{number(collected)}</b> Menções coletadas</span>
       </div>
       <section className="vpx-card">
        <div className="vpx-section-top">
         <div><h2>Publicações recentes</h2><p className="vpx-card-sub">Fonte original e data para conferência</p></div>
         <button type="button" className="vpx-linkbutton" onClick={()=>setTab('relatorios')}>Ver todas ↗</button>
        </div>
        <div className="vpx-table-wrap">
         <table className="vpx-data-table">
          <thead><tr><th>Data</th><th>Fonte</th><th>Publicação</th><th>Acesso</th></tr></thead>
          <tbody>
           {evidence?.slice(0,4).map(m=><tr key={m.id}>
            <td>{dateBR(m.publishedAt,true)}</td><td>{m.source}</td>
            <td className="vpx-maincell"><span title={m.title??undefined}>{m.title||'Publicação sem título'}</span></td>
            <td>{m.url?<a href={m.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicação original"><ExternalLink size={14}/></a>:'—'}</td>
           </tr>)}
           {!evidence?.length&&<tr><td colSpan={4} className="vpx-placeholder">{emptyEvidence(evidenceError)}</td></tr>}
          </tbody>
         </table>
        </div>
       </section>
       <div className="vpx-left-pair">
        <section className="vpx-card">
         <h2>O que merece atenção</h2>
         <strong className="vpx-insight-emphasis">{critical[0]?'Ocorrência prioritária':incidents[0]?'Ocorrência em acompanhamento':lastMention?'Nova evidência':'Aguardando evidências'}</strong>
         <p className="vpx-insight-body">{critical[0]?.title??incidents[0]?.title??lastMention?.title??'Ainda não há ocorrências ou publicações registradas no período consultado.'}</p>
         <button type="button" className="vpx-linkbutton" onClick={()=>setTab(incidents.length?'crises':'relatorios')}>Examinar contexto ↗</button>
        </section>
        <section className="vpx-card">
         <h2>Última tentativa de coleta</h2>
         <strong className="vpx-insight-emphasis">{statusPT(collection?.status)}</strong>
         <p className="vpx-insight-body">{dateBR(collection?.lastAttemptAt)}. {collection?'Estado informado pelo coletor, não previsão.':'Nenhuma execução registrada neste cliente.'}</p>
         <p className="vpx-footnote">Não confundir ausência de menções com ausência de risco.</p>
        </section>
       </div>
      </div>
      <aside className="vpx-hero" aria-label="Panorama visual do monitoramento">
       <div className="vpx-hero-head"><small>SEU RADAR</small>
        <h2>Informação sob controle<span aria-hidden="true"> ✳</span></h2>
        <p>Uma leitura objetiva da cobertura das suas menções.</p>
       </div>
       <VigiaCoverageGauge value={coverage} label="Cobertura de análise"
        description={'Menções analisadas sobre menções coletadas nos últimos '+days+' dias. Não é nota de reputação.'}
        actionLabel="Explorar evidências" onAction={()=>setTab('relatorios')}/>
       <div className="vpx-stat-grid">
        <VigiaStatTile title="Menções coletadas" value={number(collected)} note={days+' dias'} tone="lime" onClick={()=>setTab('relatorios')}/>
        <VigiaStatTile title="Menções analisadas" value={number(analyzed)} note="Com dados" tone="yellow" onClick={()=>setTab('relatorios')}/>
        <VigiaStatTile title="Fontes com publicações" value={number(summary?.work_evidence?.sources_monitored)} note="Na janela" tone="blue" onClick={()=>setTab('relatorios')}/>
        <VigiaStatTile title="Ocorrências abertas" value={number(summary?.open_incidents)} note={critical.length?'Atenção':'Registradas'} tone={critical.length?'coral':'lime'} onClick={()=>setTab('crises')}/>
        <VigiaStatTile title="Assuntos monitorados" value={number(summary?.work_evidence?.subjects_tracked)} note="Cadastrados" tone="blue"/>
        <VigiaStatTile title="Última publicação" value={dateBR(summary?.work_evidence?.updated_at,true)} note="Registrada" tone="yellow" onClick={()=>setTab('relatorios')}/>
       </div>
      </aside>
     </div>}
     {tab==='relatorios'&&<section className="vpx-secondary">
      <div className="vpx-section-top"><div><h2>Publicações e evidências</h2><p>Dados publicados pelos projetos do cliente, com origem e período.</p></div></div>
      <div className="vpx-table-wrap"><table className="vpx-data-table"><thead><tr>
       <th>Publicação</th><th>Fonte</th><th>Data</th><th>Projeto</th><th>Acesso</th></tr></thead><tbody>
       {evidence?.map(m=><tr key={m.id}><td className="vpx-maincell"><span>{m.title||'Publicação sem título'}</span></td>
        <td>{m.source}</td><td>{dateBR(m.publishedAt)}</td><td>{m.projectName}</td>
        <td>{m.url?<a href={m.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicação"><ExternalLink size={14}/></a>:'—'}</td>
       </tr>)}
       {!evidence?.length&&<tr><td colSpan={5} className="vpx-placeholder">{emptyEvidence(evidenceError)}</td></tr>}
      </tbody></table></div>
      {summary&&<div className="vpx-secondary">
       <ClientDecisionBrief data={summary} evidence={evidence} evidenceError={evidenceError}
        onCrises={()=>setTab('crises')} onEvidence={()=>setTab('relatorios')}/>
      </div>}
     </section>}
     {tab==='crises'&&<section className="vpx-secondary">
      <h2>Crises e alertas registrados</h2><p>Ocorrências vinculadas ao cliente. Não há avaliação externa de risco sem evidência.</p>
      <div className="vpx-table-wrap"><table className="vpx-data-table"><thead><tr>
       <th>Ocorrência</th><th>Situação</th><th>Prioridade</th><th>Responsável</th></tr></thead><tbody>
       {incidents.map(i=><tr key={i.id}><td className="vpx-maincell"><span>{i.title}</span></td>
        <td>{statusPT(i.status)}</td><td><span className={'vpx-status-dot '+(caseTone(i.severity)==='coral'?'coral':'yellow')}/>{statusPT(i.severity)}</td>
        <td>{i.owner||'Não atribuído'}</td></tr>)}
       {!incidents.length&&<tr><td colSpan={4} className="vpx-placeholder">Nenhuma ocorrência registrada para este cliente.</td></tr>}
      </tbody></table></div>
     </section>}
     {tab==='conta'&&<section className="vpx-secondary">
      <h2>Meu plano e faturamento</h2>
      <p>Informações contratuais, sem cobranças ou pagamentos simulados.</p>
      {planError&&<div className="vpx-alert" role="alert">{planError}</div>}
      {!plan&&!planError?<div className="vpx-placeholder" role="status">Consultando contrato…</div>:plan&&<div className="vpx-left-pair">
       <div className="vpx-card"><h2>Plano contratado</h2>
        <strong className="vpx-insight-emphasis">{plan.plan?.label??'Não informado'}</strong>
        <p className="vpx-insight-body">Situação: {statusPT(plan.subscription_status)}</p>
        <p className="vpx-insight-body">Mensalidade: {plan.plan?.priceBrl==null?'Não informada':plan.plan.priceBrl.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p>
       </div>
       <div className="vpx-card"><h2>Faturas registradas</h2>
        {plan.invoices?.length?plan.invoices.map(i=><p key={i.id} className="vpx-insight-body">
         {Number(i.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · {statusPT(i.status)}
        </p>):<p className="vpx-insight-body">Nenhuma fatura registrada.</p>}
       </div>
      </div>}
     </section>}
    </>
   )}
  </VigiaDashboardShell>;
}
