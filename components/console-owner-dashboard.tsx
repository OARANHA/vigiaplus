'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ExternalLink,ShieldCheck} from 'lucide-react';
import {VigiaDashboardShell,VigiaCoverageGauge,VigiaStatTile,type DashboardTab} from '@/components/vpx-dashboard-shell';
import type {OperationalOverview} from '@/components/owner-operational-overview';
import {CONSOLE_GROUPS} from '@/lib/admin-navigation';

type Tenant={id:number;name:string;plan:string;status:string;domain:string|null};
type Provider={id:string|number;name:string;model:string;baseUrl:string;scope:string};
type Billing={resumo?:{mrr?:number;faturasEmAberto?:number;custoIa?:number;clientesAtivos?:number};
 gateways?:{stripe?:{configured?:boolean;webhook?:boolean};pix?:{configured?:boolean;webhook?:boolean}}};
type AiStatus={available:boolean;active?:{name:string;source:string;model?:string}|null};
type Tab='inicio'|'clientes'|'operacao'|'financeiro'|'config';
const TABS:DashboardTab[]=[
 {id:'inicio',label:'Visão geral'},{id:'clientes',label:'Clientes'},
 {id:'operacao',label:'Operação'},{id:'financeiro',label:'Faturamento'},
 {id:'config',label:'Configurações'},
];
async function apiJson<T>(url:string):Promise<T>{
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok)throw Error('HTTP '+response.status);
 return response.json() as Promise<T>;
}
function num(n:number|null|undefined):string{
 return typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR'):'—';
}
function money(n:number|undefined):string{
 return typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';
}
function date(iso:string|null|undefined):string{
 if(!iso)return 'Sem registro';
 const d=new Date(iso);
 return Number.isNaN(d.getTime())?'Data indisponível':
  d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
}
function collectionPT(status:string):string{
 const values:Record<string,string>={falha:'Falha registrada',parcial:'Parcial',
  sem_projeto:'Sem projeto',sem_historico:'Sem histórico',concluida:'Concluída',
  em_andamento:'Em andamento'};
 return values[status]??'Não identificado';
}

export function ConsoleOwnerDashboard(){
 const [tab,setTab]=useState<Tab>('inicio');
 const [tenants,setTenants]=useState<Tenant[]|null>(null);
 const [providers,setProviders]=useState<Provider[]|null>(null);
 const [billing,setBilling]=useState<Billing|null>(null);
 const [ai,setAi]=useState<AiStatus|null>(null);
 const [operation,setOperation]=useState<OperationalOverview|null>(null);
 const [loading,setLoading]=useState(true);
 const [errors,setErrors]=useState<string[]>([]);
 const [updatedAt,setUpdatedAt]=useState<string|null>(null);
 const refresh=useCallback(async()=>{
   setLoading(true);
   const [t,p,b,a,o]=await Promise.allSettled([
     apiJson<{tenants:Tenant[]}>('/api/console/tenants'),
     apiJson<{providers:Provider[]}>('/api/console/llm-providers'),
     apiJson<Billing>('/api/console/billing'),
     apiJson<AiStatus>('/api/console/llm-status'),
     apiJson<OperationalOverview>('/api/console/operations'),
   ]);
   const fails:string[]=[];
   if(t.status==='fulfilled')setTenants(t.value.tenants??[]);else{setTenants(null);fails.push('Clientes');}
   if(p.status==='fulfilled')setProviders(p.value.providers??[]);else{setProviders(null);fails.push('Provedores de IA');}
   if(b.status==='fulfilled')setBilling(b.value);else{setBilling(null);fails.push('Faturamento');}
   if(a.status==='fulfilled')setAi(a.value);else{setAi(null);fails.push('Disponibilidade de IA');}
   if(o.status==='fulfilled')setOperation(o.value);else{setOperation(null);fails.push('Situação operacional');}
   setErrors(fails);setUpdatedAt(new Date().toISOString());setLoading(false);
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
   const selected=new URLSearchParams(window.location.search).get('tab');
   if(selected&&TABS.some(t=>t.id===selected))setTab(selected as Tab);
 },[]);
 async function logout(){
  await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({logout:true})}).catch(()=>{});
  window.location.replace('/login');
 }
 const summary=operation?.summary;
 const coverage=summary&&summary.projects>0
  ?Math.round((summary.projects-summary.projectsWithoutRuns)/summary.projects*100):null;
 const critical=summary?.criticalIncidents??null;
 const topSignals=operation?.signals.slice(0,3)??[];
 const gateway=(name:'stripe'|'pix')=>{
   if(!billing)return 'Não verificado';
   const conf=billing.gateways?.[name];
   if(!conf)return 'Não verificado';
   if(!conf.configured)return 'Não configurado';
   return conf.webhook?'Credenciais configuradas':'Webhook não configurado';
 };
 function navigate(href:string){
   if(href==='#clientes')setTab('clientes');
   else if(href==='#financeiro')setTab('financeiro');
   else if(href==='#ia')setTab('config');
   else window.location.assign(href);
 }
 return <VigiaDashboardShell role="proprietario" tabs={TABS} activeTab={tab}
  onTab={v=>setTab(v as Tab)} onLogout={logout} onRefresh={()=>{void refresh();}}
  extra={<span>Proprietário · {updatedAt?'Consulta '+date(updatedAt):'Consultando…'}</span>}>
  {errors.length>0&&<div role="alert" className="vpx-alert">
   Dados temporariamente indisponíveis: {errors.join(', ')}. Não foram substituídos por zero.
  </div>}
  {tab==='inicio'&&<div className="vpx-workspace">
   <div className="vpx-left">
    <section>
     <div className="vpx-section-top"><span className="vpx-eyebrow"><ShieldCheck size={14}/> CENTRAL DO PROPRIETÁRIO</span>
      <button className="vpx-linkbutton" type="button" onClick={()=>setTab('operacao')}>Abrir operação <ArrowUpRight size={14}/></button>
     </div>
     <h1>Sua operação, em um só olhar</h1>
     <p className="vpx-description">Situação da carteira, coleta e pendências. Informações registradas, organizadas para definir a próxima ação.</p>
    </section>
    <div className="vpx-pipeline" aria-label="Etapas da operação">
     <div className="vpx-step"><small>Etapa 1</small><div className="vpx-step-row"><span className="vpx-step-number">1</span>
      <div><strong>Clientes</strong><p>{num(summary?.clients)} organizações cadastradas</p></div></div></div>
     <div className="vpx-step"><small>Etapa 2</small><div className="vpx-step-row"><span className="vpx-step-number">2</span>
      <div><strong>Monitoramento</strong><p>{num(summary?.projects)} projetos de escuta</p></div></div></div>
     <div className="vpx-step"><small>Etapa 3</small><div className="vpx-step-row"><span className="vpx-step-number">3</span>
      <div><strong>Intervenção</strong><p>{num(operation?.signals.length)} sinais para verificar</p></div></div></div>
    </div>
    <div className="vpx-counts">
     <span className="vpx-count coral"><b>{num(critical)}</b> Alta prioridade</span>
     <span className="vpx-count yellow"><b>{num(summary?.projectsWithFailedRuns)}</b> Falhas de coleta</span>
     <span className="vpx-count"><b>{num(summary?.invoicesOverdue)}</b> Faturas em atraso</span>
    </div>
    <section className="vpx-card">
     <div className="vpx-section-top"><div><h2>Carteira de clientes</h2><p className="vpx-card-sub">Situação registrada por organização</p></div>
      <button type="button" className="vpx-linkbutton" onClick={()=>setTab('clientes')}>Ver carteira ↗</button></div>
     <div className="vpx-table-wrap"><table className="vpx-data-table">
      <thead><tr><th>Cliente</th><th>Coleta</th><th>Ocorrências</th><th>Visão</th></tr></thead>
      <tbody>
       {operation?.clients.slice(0,5).map(c=><tr key={c.id}>
        <td className="vpx-maincell"><span>{c.name}</span></td>
        <td>{collectionPT(c.collection)}</td><td>{c.incidentsOpen}</td>
        <td><Link href={'/portal?tenant_id='+c.id} title="Abrir visão do cliente"><ExternalLink size={14}/></Link></td>
       </tr>)}
       {!operation?.clients.length&&<tr><td colSpan={4} className="vpx-placeholder">{loading?'Consultando clientes…':operation?'Nenhum cliente cadastrado.':'Carteira indisponível.'}</td></tr>}
      </tbody></table></div>
    </section>
    <div className="vpx-left-pair">
     <section className="vpx-card"><h2>Fila de atenção</h2>
      <strong className="vpx-insight-emphasis">{operation?num(operation.signals.length)+' sinais':'—'}</strong>
      <p className="vpx-insight-body">{topSignals[0]?topSignals[0].tenantName+': '+topSignals[0].title:'Não há pendências registradas nas categorias verificadas. Isso não exclui riscos externos.'}</p>
      <button className="vpx-linkbutton" type="button" onClick={()=>setTab('operacao')}>Examinar fila ↗</button>
     </section>
     <section className="vpx-card"><h2>Última tentativa de coleta</h2>
      <strong className="vpx-insight-emphasis">{date(summary?.lastCollectionAt)}</strong>
      <p className="vpx-insight-body">{num(summary?.projectsWithoutRuns)} projetos sem histórico. A ausência de execução não comprova falha.</p>
      <button className="vpx-linkbutton" type="button" onClick={()=>setTab('operacao')}>Ver cobertura ↗</button>
     </section>
    </div>
   </div>
   <aside className="vpx-hero" aria-label="Indicadores da operação">
    <div className="vpx-hero-head"><small>VISÃO DO PROPRIETÁRIO</small>
     <h2>Olá, proprietário <span aria-hidden="true">✳</span></h2>
     <p>Veja a cobertura de execução da carteira sem dados presumidos.</p>
    </div>
    <VigiaCoverageGauge value={coverage} label="Projetos com histórico"
     description="Percentual de projetos de monitoramento com ao menos uma execução registrada. Não indica saúde da reputação."
     actionLabel="Explorar operação" onAction={()=>setTab('operacao')}/>
    <div className="vpx-stat-grid">
     <VigiaStatTile title="Clientes cadastrados" value={num(summary?.clients)} note="Carteira" tone="lime" onClick={()=>setTab('clientes')}/>
     <VigiaStatTile title="Projetos de escuta" value={num(summary?.projects)} note="Monitoramento" tone="yellow" onClick={()=>setTab('operacao')}/>
     <VigiaStatTile title="Ocorrências abertas" value={num(summary?.openIncidents)} note="Registradas" tone="blue" onClick={()=>setTab('operacao')}/>
     <VigiaStatTile title="Coletas com falha" value={num(summary?.projectsWithFailedRuns)} note="Última execução" tone="coral" onClick={()=>setTab('operacao')}/>
     <VigiaStatTile title="Faturas em atraso" value={num(summary?.invoicesOverdue)} note="Financeiro" tone="yellow" onClick={()=>setTab('financeiro')}/>
     <VigiaStatTile title="Provedores de IA" value={providers?num(providers.length):'—'} note="Registrados" tone="lime" onClick={()=>setTab('config')}/>
    </div>
   </aside>
  </div>}
  {tab==='clientes'&&<section id="clientes" className="vpx-secondary">
   <h2>Carteira de clientes</h2><p>Contratos, situação e cobertura; a consulta é limitada ao proprietário.</p>
   <div className="vpx-table-wrap"><table className="vpx-data-table"><thead><tr>
    <th>Organização</th><th>Plano</th><th>Cadastro</th><th>Coleta</th><th>Visão</th></tr></thead>
    <tbody>{tenants?.map(t=>{
      const client=operation?.clients.find(c=>c.id===t.id);
      return <tr key={t.id}><td className="vpx-maincell"><span>{t.name}</span></td><td>{t.plan}</td>
       <td>{t.status==='active'?'Ativo':t.status}</td><td>{client?collectionPT(client.collection):'Sem medição'}</td>
       <td><Link href={'/portal?tenant_id='+t.id} aria-label="Abrir visão do cliente"><ExternalLink size={15}/></Link></td></tr>;
    })}
    {!tenants?.length&&<tr><td colSpan={5} className="vpx-placeholder">{tenants?'Nenhum cliente cadastrado.':'Consulta indisponível.'}</td></tr>}
    </tbody></table></div>
  </section>}
  {tab==='operacao'&&<section className="vpx-secondary">
   <h2>Ocorrências e coleta</h2>
   <p>Fila ordenada por gravidade declarada, falha de coleta e pendência. Sem classificação inferida.</p>
   <div className="vpx-table-wrap"><table className="vpx-data-table">
    <thead><tr><th>Cliente</th><th>Prioridade</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
     {operation?.signals.map(s=><tr key={s.id}>
      <td className="vpx-maincell"><span>{s.tenantName}</span></td>
      <td><span className={'vpx-status-dot '+(s.priority==='critica'?'coral':'yellow')}/>{s.priority==='critica'?'Alta':s.priority==='atencao'?'Verificar':'Informação'}</td>
      <td>{s.title}<p className="vpx-footnote">{s.explanation}</p></td>
      <td><Link href={'/portal?tenant_id='+s.tenantId} aria-label="Visualizar cliente"><ExternalLink size={15}/></Link></td>
     </tr>)}
     {!operation?.signals.length&&<tr><td colSpan={4} className="vpx-placeholder">{operation?'Nenhum sinal registrado nas categorias consultadas.':'Operação indisponível.'}</td></tr>}
    </tbody></table></div>
  </section>}
  {tab==='financeiro'&&<section id="financeiro" className="vpx-secondary">
   <h2>Planos e faturamento</h2><p>Indicadores contratuais. Recebimento não é confirmado por cadastro de credenciais.</p>
   <div className="vpx-stat-grid">
    <VigiaStatTile title="Receita mensal contratual" value={money(billing?.resumo?.mrr)} note="MRR" tone="lime"/>
    <VigiaStatTile title="Faturas em aberto" value={num(billing?.resumo?.faturasEmAberto)} note="Registradas" tone="yellow"/>
    <VigiaStatTile title="Custo de IA registrado" value={money(billing?.resumo?.custoIa)} note="Medido" tone="blue"/>
   </div>
   <div className="vpx-left-pair" style={{marginTop:18}}>
    <div className="vpx-card"><h2>Pix / Asaas</h2><p className="vpx-insight-body">{gateway('pix')}</p></div>
    <div className="vpx-card"><h2>Stripe</h2><p className="vpx-insight-body">{gateway('stripe')}</p></div>
   </div>
  </section>}
  {tab==='config'&&<section id="ia" className="vpx-secondary">
   <h2>Ferramentas e configurações</h2><p>Atalhos reais, organizados por operação e administração.</p>
   <div className="vpx-stat-grid">{CONSOLE_GROUPS.flatMap(group=>group.links.map(item=>
    <button key={group.label+item.href} className="vpx-stat-tile" type="button" onClick={()=>navigate(item.href)}>
     <span className="vpx-tile-label">{item.label}</span><small className="vpx-muted">{item.description}</small>
     <b className="vpx-tile-arrow">↗</b>
    </button>))}</div>
   <div className="vpx-card" style={{marginTop:18}}>
    <h2>Inteligência artificial</h2>
    <p className="vpx-insight-body">Chave de IA: {ai==null?'Não verificada':ai.available?'Configurada':'Indisponível'}.</p>
    {providers?.length?providers.map(p=><p key={p.id} className="vpx-insight-body">{p.name} · {p.model} · {p.scope==='tenant'?'Cliente':'Global'}</p>):
     <p className="vpx-insight-body">Nenhum provedor consultado.</p>}
   </div>
  </section>}
 </VigiaDashboardShell>;
}
