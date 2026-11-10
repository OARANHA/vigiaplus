'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, BookOpen, Bot, Building2, CreditCard, FileText,
  Layers, LockKeyhole, Palette, RadioTower, Receipt, Settings,
  Shield, SlidersHorizontal, Users,
} from 'lucide-react';
import { VigiaDashboardShell } from '@/components/vpx-dashboard-shell';

type Section = 'clientes'|'planos'|'recursos'|'contratos'|'financeiro'|'fontes'|
  'coleta'|'crises'|'relatorios'|'ia'|'acessos'|'privacidade'|'marca'|'sistema';
const GROUPS = [
  { label: 'GESTÃO COMERCIAL', items: [
    { id: 'clientes', label: 'Clientes', icon: Building2 },
    { id: 'planos', label: 'Planos e preços', icon: Layers },
    { id: 'recursos', label: 'Permissões por cliente', icon: SlidersHorizontal },
    { id: 'contratos', label: 'Contratos', icon: FileText },
    { id: 'financeiro', label: 'Faturamento e Pix', icon: CreditCard },
  ] },
  { label: 'OPERAÇÃO', items: [
    { id: 'fontes', label: 'Fontes e conectores', icon: RadioTower },
    { id: 'coleta', label: 'Coleta e filas', icon: Activity },
    { id: 'crises', label: 'Alertas e crises', icon: AlertTriangle },
    { id: 'relatorios', label: 'Relatórios', icon: Receipt },
  ] },
  { label: 'INTELIGÊNCIA', items: [
    { id: 'ia', label: 'Modelos de IA', icon: Bot },
  ] },
  { label: 'PLATAFORMA', items: [
    { id: 'acessos', label: 'Usuários e segurança', icon: Users },
    { id: 'privacidade', label: 'LGPD e retenção', icon: Shield },
    { id: 'marca', label: 'Marca e comunicação', icon: Palette },
    { id: 'sistema', label: 'Sistema e integrações', icon: Settings },
  ] },
] as const;
const HEADINGS: Record<Section, { title: string; detail: string }> = {
  clientes: {title: 'Clientes e organizações',detail: 'Cadastre uma organização e acompanhe sua situação, sem criar acesso ou cobrança automaticamente.'},
  planos: {title: 'Catálogo de planos',detail: 'Crie planos e escolha as capacidades. Planos já vinculados a contratos não podem ser alterados retroativamente.'},
  recursos: {title: 'Permissões por cliente',detail: 'Consulte direitos efetivos e registre liberações ou bloqueios com motivo e prazo.'},
  contratos: {title: 'Contratos manuais',detail: 'Atribuição explícita de plano. Esta ação não cobra nem confirma pagamentos.'},
  financeiro: {title: 'Faturamento',detail: 'Receita contratual, custos de IA e configuração dos gateways, sem presumir recebimentos.'},
  fontes: {title: 'Fontes e conectores',detail: 'Configuração dos conectores existentes e visibilidade das pendências de integrações por cliente.'},
  coleta: {title: 'Coleta e fila',detail: 'Acompanhamento e operação; agendamento por cliente exige homologação específica.'},
  crises: {title: 'Alertas e crises',detail: 'Ocorrências reais, regras e fluxos de acompanhamento.'},
  relatorios: {title: 'Relatórios',detail: 'Produção e exportação dos relatórios disponíveis.'},
  ia: {title: 'Modelos e custos de IA',detail: 'Provedores compatíveis e controle de disponibilidade, custo e credenciais.'},
  acessos: {title: 'Usuários e segurança',detail: 'Equipe, permissões e controles de acesso.'},
  privacidade: {title: 'Privacidade e retenção',detail: 'Políticas de dados, retenção, solicitações e trilha de auditoria.'},
  marca: {title: 'Marca e comunicação',detail: 'Identidade visual e canais de avisos, separados por cliente.'},
  sistema: {title: 'Sistema e integrações',detail: 'Conectividade, monitoramento e configuração da plataforma.'},
};
type Feature = { key: string; label: string; group: string; enabled?: boolean; reason?: string; source?: string; plan?: string };
type Plan = { key: string; label: string; priceBrl: number|null; aiQuotaBrl: number;
  mentionsLimit: number; retentionMonths: number; features: string[]; inUse: boolean };
type Client = { id: number; name: string; slug: string; plan: string; status: string; subscription: {planKey:string;status:string}|null };
type Contract = {tenantId:number;tenantName:string;tenantStatus:string;registeredPlan:string;
  subscriptions:{id:number;planKey:string;status:string;gateway:string;vigenciaAte:string|null}[]};
type Billing = {resumo?:{mrr?:number;faturasEmAberto?:number;custoIa?:number;inadimplencia?:number};
  gateways?:{stripe?:{configured:boolean;webhook:boolean};pix?:{configured:boolean;webhook:boolean}};
  carteira?:{id:number;nome:string;status:string;plano:string;inadimplencia:number;custoIa:number}[]};
type Provider = {id:string;name:string;model:string;scope:string;baseUrl:string};
type PlanDraft = {key:string;label:string;priceBrl:number|null;aiQuotaBrl:number;
  mentionsLimit:number;retentionMonths:number;features:string[];reason:string};
const emptyDraft=():PlanDraft=>({key:'',label:'',priceBrl:0,aiQuotaBrl:0,mentionsLimit:5000,retentionMonths:1,features:[],reason:''});
function currency(value:number|null|undefined) {
  return typeof value==='number' && Number.isFinite(value) ?
    value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—';
}
async function api<T>(path:string, init?:RequestInit):Promise<T> {
  const response=await fetch(path,{cache:'no-store',...init});
  if(!response.ok){
    const body=await response.json().catch(()=>({})) as {message?:string;error?:string};
    throw Error(body.message??body.error??'Falha HTTP '+response.status);
  }
  return response.json() as Promise<T>;
}
const json=(obj:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
function SubPanel({title,children}: {title:string;children:ReactNode}) {
  return <section className="vpx-owner-card"><h2>{title}</h2>{children}</section>;
}
function Destinations({items}: {items:{label:string;href?:string;description:string;pending?:boolean}[]}) {
  return <div className="vpx-owner-links">{items.map(item=><div key={item.label} className="vpx-owner-dest">
    <div><strong>{item.label}</strong><p>{item.description}</p></div>
    {item.href ? <Link className="vpx-owner-go" href={item.href}>Abrir ↗</Link>
       : <span className="vpx-owner-pending">{item.pending?'Pendente':'Não disponível'}</span>}
  </div>)}</div>;
}

export function OwnerAdminWorkspace() {
  const [section,setSection]=useState<Section>('clientes');
  const [plans,setPlans]=useState<Plan[]>([]);
  const [catalog,setCatalog]=useState<Feature[]>([]);
  const [clients,setClients]=useState<Client[]>([]);
  const [contracts,setContracts]=useState<Contract[]>([]);
  const [billing,setBilling]=useState<Billing|null>(null);
  const [providers,setProviders]=useState<Provider[]>([]);
  const [selectedTenant,setSelectedTenant]=useState<number|null>(null);
  const [features,setFeatures]=useState<Feature[]|null>(null);
  const [draft,setDraft]=useState<PlanDraft>(emptyDraft);
  const [editing,setEditing]=useState<string|null>(null);
  const [overrideReason,setOverrideReason]=useState('');
  const [overrideExpires,setOverrideExpires]=useState('');
  const [contractPlan,setContractPlan]=useState('');
  const [contractReason,setContractReason]=useState('');
  const [manualApproval,setManualApproval]=useState(false);
  const [newClient,setNewClient]=useState({name:'',slug:'',cnpj:''});
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);

  const reload=useCallback(async()=>{
    setLoading(true);
    const [p,t,c,b,ai]=await Promise.allSettled([
      api<{plans:Plan[];catalog:Feature[]}>('/api/console/plans'),
      api<{tenants:Client[]}>('/api/console/tenants'),
      api<{contracts:Contract[]}>('/api/console/subscriptions'),
      api<Billing>('/api/console/billing'),
      api<{providers:Provider[]}>('/api/console/llm-providers'),
    ]);
    const failed:string[]=[];
    if(p.status==='fulfilled'){setPlans(p.value.plans);setCatalog(p.value.catalog);}else failed.push('planos');
    if(t.status==='fulfilled'){setClients(t.value.tenants);setSelectedTenant(old=>old??t.value.tenants[0]?.id??null);}else failed.push('clientes');
    if(c.status==='fulfilled')setContracts(c.value.contracts);else failed.push('contratos');
    if(b.status==='fulfilled')setBilling(b.value);else failed.push('faturamento');
    if(ai.status==='fulfilled')setProviders(ai.value.providers);else failed.push('IA');
    setError(failed.length?'Consultas indisponíveis: '+failed.join(', '):'');
    setLoading(false);
  },[]);
  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>{
    const valid=GROUPS.flatMap(g=>g.items.map(i=>i.id));
    const value=new URLSearchParams(window.location.search).get('section');
    if(value && valid.some(x=>x===value))setSection(value as Section);
  },[]);
  useEffect(()=>{
    if(!selectedTenant){setFeatures(null);return;}
    setFeatures(null);
    void api<{catalog:Feature[]}>('/api/console/tenants/'+selectedTenant+'/features')
      .then(d=>setFeatures(d.catalog)).catch(err=>{setFeatures([]);setError(String(err));});
  },[selectedTenant]);

  function choose(next:Section) {
    setSection(next);setMessage('');setError('');
    const url=new URL(window.location.href);url.searchParams.set('section',next);
    window.history.replaceState(null,'',url.toString());
  }
  function editPlan(plan:Plan|null) {
    setEditing(plan?.key??null);
    setDraft(plan ? {
      key:plan.key,label:plan.label,priceBrl:plan.priceBrl,
      aiQuotaBrl:plan.aiQuotaBrl,mentionsLimit:plan.mentionsLimit,
      retentionMonths:plan.retentionMonths,features:[...plan.features],reason:'',
    }:emptyDraft());
    setMessage('');setError('');
  }
  function togglePlanFeature(key:string,enabled:boolean) {
    setDraft(old=>({...old,features:enabled?[...new Set([...old.features,key])]:old.features.filter(k=>k!==key)}));
  }
  async function savePlan(){
    setBusy(true);setMessage('');setError('');
    try {
      await api('/api/console/plans',{
        method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft),
      });
      const wasEditing = !!editing;
      editPlan(null);await reload();
      setMessage(wasEditing?'Plano atualizado.':'Plano cadastrado. Para ativar em um cliente, configure o contrato manual.');
    } catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function createClient() {
    setBusy(true);setMessage('');setError('');
    try{
      await api('/api/console/tenants',json(newClient));
      setNewClient({name:'',slug:'',cnpj:''});
      await reload();setMessage('Cliente cadastrado como pendente; ainda não possui contrato nem acesso.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function changeFeature(f:Feature) {
    if(!selectedTenant)return;
    setBusy(true);setMessage('');setError('');
    try{
      await api('/api/console/tenants/'+selectedTenant+'/features',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({feature_key:f.key,enabled:!f.enabled,reason:overrideReason,
          expires_at:overrideExpires||null}),
      });
      const current=await api<{catalog:Feature[]}>('/api/console/tenants/'+selectedTenant+'/features');
      setFeatures(current.catalog);
      setMessage('Exceção registrada e estado efetivo atualizado. A assinatura continua obrigatória.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function assignPlan() {
    if(!selectedTenant)return;
    setBusy(true);setMessage('');setError('');
    try {
      await api('/api/console/subscriptions',json({
        tenantId:selectedTenant,planKey:contractPlan,reason:contractReason,manualApproval,
      }));
      setContractReason('');setManualApproval(false);
      await reload();setMessage('Contrato manual ativado. Nenhuma cobrança foi efetuada.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function logout(){
    await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({logout:true})}).catch(()=>{});
    window.location.replace('/login');
  }
  const current=clients.find(c=>c.id===selectedTenant);
  const currentContract=contracts.find(c=>c.tenantId===selectedTenant);
  return <VigiaDashboardShell role="proprietario"
    tabs={[{id:'painel',label:'Visão geral'},{id:'administracao',label:'Administração'}]}
    activeTab="administracao"
    onTab={id=>{if(id==='painel')window.location.assign('/console');}}
    onLogout={logout} onRefresh={()=>{void reload();}}
    extra={<Link href="/console" className="vpx-inline-link">← Voltar ao painel</Link>}>
    <div className="vpx-owner-layout">
      <aside className="vpx-owner-sidebar" aria-label="Menu da administração">
        <div className="vpx-owner-sidehead"><LockKeyhole size={16}/> Administração</div>
        {GROUPS.map(group=><div key={group.label} className="vpx-owner-navgroup">
          <div className="vpx-owner-navlabel">{group.label}</div>
          <nav aria-label={group.label}>{group.items.map(item=>{
            const Icon=item.icon;
            return <button key={item.id} type="button"
              className={'vpx-owner-navitem'+(section===item.id?' is-active':'')}
              aria-current={section===item.id?'page':undefined}
              onClick={()=>choose(item.id as Section)}>
              <Icon size={16}/><span>{item.label}</span>
            </button>;
          })}</nav>
        </div>)}
        <Link href="/console" className="vpx-owner-return">← Painel do proprietário</Link>
      </aside>
      <main className="vpx-owner-main">
        <header className="vpx-owner-heading">
          <div><span className="vpx-eyebrow">CONFIGURAÇÃO DA PLATAFORMA</span>
            <h1>{HEADINGS[section].title}</h1>
            <p>{HEADINGS[section].detail}</p>
          </div>
          <button type="button" className="vpx-owner-refresh" onClick={()=>{void reload();}}>Atualizar dados ↻</button>
        </header>
        {loading&&<p className="vpx-owner-note" role="status">Atualizando informações…</p>}
        {error&&<div className="vpx-alert" role="alert">{error}</div>}
        {message&&<div className="vpx-owner-success" role="status">{message}</div>}
        {section==='clientes'&&<>
          <SubPanel title="Carteira de clientes">
            <div className="vpx-owner-table-scroll"><table className="vpx-data-table"><thead><tr>
              <th>Organização</th><th>Plano</th><th>Situação</th><th>Permissões</th></tr></thead><tbody>
              {clients.map(c=><tr key={c.id}><td className="vpx-maincell">{c.name}<small className="vpx-owner-sub">{c.slug}</small></td>
                <td>{c.subscription?.planKey??c.plan+' (não contratado)'}</td>
                <td>{c.subscription?.status??c.status}</td>
                <td><button type="button" className="vpx-owner-inline" onClick={()=>{
                  setSelectedTenant(c.id);choose('recursos');
                }}>Gerenciar ↗</button></td></tr>)}
              {clients.length===0&&<tr><td colSpan={4}>Nenhuma organização cadastrada.</td></tr>}
            </tbody></table></div>
          </SubPanel>
          <SubPanel title="Novo cliente — cadastro inicial">
            <p className="vpx-owner-muted">A organização será cadastrada como pendente. Convite e contrato são etapas separadas.</p>
            <div className="vpx-owner-formgrid">
              <label>Nome da organização<input value={newClient.name} maxLength={120}
                onChange={e=>setNewClient(d=>({...d,name:e.target.value}))}/></label>
              <label>Identificador (slug)<input value={newClient.slug} placeholder="empresa-exemplo"
                onChange={e=>setNewClient(d=>({...d,slug:e.target.value}))}/></label>
              <label>CNPJ (opcional)<input value={newClient.cnpj}
                onChange={e=>setNewClient(d=>({...d,cnpj:e.target.value}))}/></label>
            </div>
            <button className="vpx-owner-primary" type="button" onClick={()=>{void createClient();}}
              disabled={busy||newClient.name.trim().length<2||newClient.slug.trim().length<3}>Cadastrar organização</button>
          </SubPanel>
        </>}
        {section==='planos'&&<>
          <div className="vpx-owner-planbar" role="list">{plans.map(p=><button key={p.key} role="listitem" type="button"
            className={'vpx-owner-plan-chip'+(editing===p.key?' is-active':'')}
            onClick={()=>editPlan(p)}><strong>{p.label}</strong><small>{currency(p.priceBrl)} · {p.inUse?'Em contrato':'Editável'}</small></button>)}
            <button type="button" className="vpx-owner-plan-chip vpx-owner-new" onClick={()=>editPlan(null)}>+ Novo plano</button>
          </div>
          <SubPanel title={editing?'Configuração do plano '+editing:'Cadastrar plano'}>
            {editing&&plans.find(p=>p.key===editing)?.inUse&&
              <div className="vpx-alert">Este plano possui contratos. A edição será bloqueada para proteger acordos anteriores. Crie outro plano.</div>}
            <div className="vpx-owner-formgrid">
              <label>Identificador<input disabled={!!editing} value={draft.key} placeholder="profissional"
                onChange={e=>setDraft(d=>({...d,key:e.target.value.toLowerCase()}))}/></label>
              <label>Nome comercial<input value={draft.label}
                onChange={e=>setDraft(d=>({...d,label:e.target.value}))}/></label>
              <label>Preço mensal em R$ (vazio = sob consulta)<input type="number" step=".01" min="0"
                value={draft.priceBrl??''} onChange={e=>setDraft(d=>({...d,priceBrl:e.target.value===''?null:Number(e.target.value)}))}/></label>
              <label>Cota financeira de IA (R$)<input type="number" min="0" step=".01" value={draft.aiQuotaBrl}
                onChange={e=>setDraft(d=>({...d,aiQuotaBrl:Number(e.target.value)}))}/></label>
              <label>Limite de menções<input type="number" min="1" step="1" value={draft.mentionsLimit}
                onChange={e=>setDraft(d=>({...d,mentionsLimit:Number(e.target.value)}))}/></label>
              <label>Retenção (meses)<input type="number" min="1" max="120" step="1" value={draft.retentionMonths}
                onChange={e=>setDraft(d=>({...d,retentionMonths:Number(e.target.value)}))}/></label>
            </div>
            <h3>Capacidades incluídas</h3>
            <div className="vpx-owner-featuregrid">{catalog.map(f=><label className="vpx-owner-feature" key={f.key}>
              <input type="checkbox" checked={draft.features.includes(f.key)}
                onChange={e=>togglePlanFeature(f.key,e.target.checked)}/>
              <span>{f.label}<small>{f.group}</small></span></label>)}</div>
            <label className="vpx-owner-reason">Motivo e registro da alteração<textarea rows={2} maxLength={300}
              value={draft.reason} onChange={e=>setDraft(d=>({...d,reason:e.target.value}))}
              placeholder="Ex.: plano criado para nova oferta comercial"/></label>
            <div className="vpx-owner-actions">
              <button type="button" className="vpx-owner-primary" disabled={busy||draft.reason.trim().length<5||!!(editing&&plans.find(p=>p.key===editing)?.inUse)}
                onClick={()=>{void savePlan();}}>{editing?'Salvar alterações':'Criar plano'}</button>
              <span>Sem publicação automática, alteração de contratos ou cobrança.</span>
            </div>
          </SubPanel>
        </>}
        {section==='recursos'&&<>
          <SubPanel title="Cliente e condições de acesso">
            <label className="vpx-owner-selectlabel">Organização
              <select value={selectedTenant??''} onChange={e=>setSelectedTenant(Number(e.target.value))}>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <p className="vpx-owner-muted">Plano: <strong>{currentContract?.subscriptions[0]?.planKey??current?.plan??'—'}</strong>
              {' · '}Assinatura: <strong>{currentContract?.subscriptions[0]?.status??'Sem contrato'}</strong>.
              Sem assinatura válida, uma liberação manual não libera acesso.</p>
            <div className="vpx-owner-formgrid">
              <label>Motivo obrigatório<input maxLength={300} value={overrideReason}
                placeholder="Ex.: módulo contratado à parte"
                onChange={e=>setOverrideReason(e.target.value)}/></label>
              <label>Expiração opcional<input type="date" value={overrideExpires} onChange={e=>setOverrideExpires(e.target.value)}/></label>
            </div>
          </SubPanel>
          <SubPanel title="Direitos efetivos">
            {features===null?<p className="vpx-owner-muted">Consultando direitos…</p>:
              <div className="vpx-owner-featurelist">{features.map(f=><div key={f.key} className="vpx-owner-feature-row">
                <div><strong>{f.label}</strong><p>{f.group} · {f.source??'Não verificado'} · {f.reason??'Sem justificativa'}</p></div>
                <button type="button" className={'vpx-owner-toggle'+(f.enabled?' enabled':'')}
                  aria-label={(f.enabled?'Desabilitar ':'Habilitar ')+f.label}
                  aria-pressed={!!f.enabled} disabled={busy||overrideReason.trim().length<5}
                  onClick={()=>{void changeFeature(f);}}><span/>{f.enabled?'Ativo':'Inativo'}</button>
              </div>)}</div>}
            <p className="vpx-owner-muted">Cada mudança exige motivo e é auditada. A interface mostra o estado efetivo, não apenas a intenção da exceção.</p>
          </SubPanel>
        </>}
        {section==='contratos'&&<>
          <SubPanel title="Atribuição manual de plano">
            <div className="vpx-owner-formgrid">
              <label>Cliente<select value={selectedTenant??''} onChange={e=>setSelectedTenant(Number(e.target.value))}>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
              <label>Plano selecionado<select value={contractPlan} onChange={e=>setContractPlan(e.target.value)}>
                <option value="">Selecione um plano</option>
                {plans.map(p=><option key={p.key} value={p.key}>{p.label} · {currency(p.priceBrl)}</option>)}
              </select></label>
              <label>Motivo e autorização<input value={contractReason}
                onChange={e=>setContractReason(e.target.value)}
                placeholder="Ex.: contrato manual assinado"/></label>
            </div>
            <label className="vpx-owner-check"><input type="checkbox" checked={manualApproval}
              onChange={e=>setManualApproval(e.target.checked)}/>
              Confirmo que esta é uma ativação manual, sem cobrança por Stripe ou Pix.</label>
            <button type="button" className="vpx-owner-primary"
              disabled={busy||!selectedTenant||!contractPlan||contractReason.trim().length<5||!manualApproval}
              onClick={()=>{void assignPlan();}}>Ativar contrato manual</button>
          </SubPanel>
          <SubPanel title="Contratos registrados"><div className="vpx-owner-table-scroll"><table className="vpx-data-table">
            <thead><tr><th>Cliente</th><th>Plano</th><th>Situação</th><th>Gateway</th></tr></thead><tbody>
              {contracts.map(c=><tr key={c.tenantId}><td>{c.tenantName}</td><td>{c.subscriptions[0]?.planKey??c.registeredPlan}</td>
                <td>{c.subscriptions[0]?.status??'Sem contrato'}</td><td>{c.subscriptions[0]?.gateway??'—'}</td></tr>)}
            </tbody></table></div></SubPanel>
        </>}
        {section==='financeiro'&&<>
          <div className="vpx-owner-metrics">
            <div><small>MRR contratual</small><strong>{currency(billing?.resumo?.mrr)}</strong></div>
            <div><small>Faturas em aberto</small><strong>{billing?.resumo?.faturasEmAberto??'—'}</strong></div>
            <div><small>Custo de IA registrado</small><strong>{currency(billing?.resumo?.custoIa)}</strong></div>
          </div>
          <SubPanel title="Gateways de pagamento">
            <Destinations items={[
              {label:'Stripe · Cartão',description:billing?.gateways?.stripe?.configured?'Chave configurada; webhook '+(billing.gateways.stripe.webhook?'configurado':'não configurado'):'Chave não configurada',pending:true},
              {label:'Asaas · Pix',description:billing?.gateways?.pix?.configured?'Chave configurada; webhook '+(billing.gateways.pix.webhook?'configurado':'não configurado'):'Chave não configurada',pending:true},
              {label:'Assinaturas automáticas',description:'Recorrência, conciliação e reembolso precisam de homologação em sandbox.',pending:true},
            ]}/>
            <p className="vpx-owner-muted">Credenciais são fornecidas por ambiente seguro; não são inseridas nem exibidas nesta tela.</p>
          </SubPanel>
          <SubPanel title="Situação financeira por cliente"><div className="vpx-owner-table-scroll"><table className="vpx-data-table">
            <thead><tr><th>Cliente</th><th>Plano</th><th>Inadimplência informada</th><th>Custo IA</th></tr></thead><tbody>
              {billing?.carteira?.map(c=><tr key={c.id}><td>{c.nome}</td><td>{c.plano}</td><td>{currency(c.inadimplencia)}</td><td>{currency(c.custoIa)}</td></tr>)}
            </tbody></table></div></SubPanel>
        </>}
        {section==='ia'&&<>
          <SubPanel title="Provedores registrados">
            <div className="vpx-owner-featurelist">{providers.map(p=><div className="vpx-owner-feature-row" key={p.id}>
              <div><strong>{p.name}</strong><p>{p.model} · {p.scope==='tenant'?'Por cliente':'Global'}</p></div>
              <span className="vpx-owner-pending">Registrado</span></div>)}
              {!providers.length&&<p>Nenhum provedor retornado.</p>}</div>
          </SubPanel>
          <SubPanel title="Configurações existentes"><Destinations items={[
            {label:'Orçamento e consumo',href:'/impostazioni/budget',description:'Configuração de orçamento da área analítica.'},
            {label:'Créditos de IA',href:'/impostazioni/credits',description:'Consumo e créditos disponíveis.'},
            {label:'Editor de modelos OpenAI-compatible',description:'Cadastro completo, fallback e cofre de chaves pela UI requerem nova etapa.',pending:true},
          ]}/></SubPanel>
        </>}
        {section==='fontes'&&<SubPanel title="Conectores e credenciais"><Destinations items={[
          {label:'Fontes de dados',href:'/impostazioni/fonti',description:'Catálogo de fontes e configuração existente.'},
          {label:'Consultas de monitoramento',href:'/query',description:'Termos, entidades e filtros de coleta.'},
          {label:'Limites e credenciais por cliente',description:'Cofre, quotas e teste individual por fonte ainda não unificados.',pending:true},
        ]}/></SubPanel>}
        {section==='coleta'&&<SubPanel title="Coleta e acompanhamento"><Destinations items={[
          {label:'Monitoramento',href:'/listening',description:'Publicações e coleta na ferramenta analítica.'},
          {label:'Operação da carteira',href:'/console?tab=operacao',description:'Fila de atenção e histórico de coleta no painel proprietário.'},
          {label:'Agendamento por cliente',description:'Integração e homologação do scheduler de 15 minutos ainda pendentes.',pending:true},
        ]}/></SubPanel>}
        {section==='crises'&&<SubPanel title="Gestão de crises"><Destinations items={[
          {label:'Alertas e ocorrências',href:'/alerts',description:'Alertas registrados na aplicação.'},
          {label:'Regras por contrato e escalonamento',description:'Limiares, destinatários e simulação de crise ainda pendentes.',pending:true},
        ]}/></SubPanel>}
        {section==='relatorios'&&<SubPanel title="Relatórios e entregas"><Destinations items={[
          {label:'Relatórios disponíveis',href:'/report',description:'Geração e consulta dos relatórios existentes.'},
          {label:'Periodicidade e entrega automática',description:'Gestão da entrega por plano e cliente ainda pendente.',pending:true},
        ]}/></SubPanel>}
        {section==='acessos'&&<SubPanel title="Acesso e segurança"><Destinations items={[
          {label:'Equipe e usuários',href:'/impostazioni/team',description:'Administração de equipe disponível na área analítica.'},
          {label:'Minha conta',href:'/impostazioni/account',description:'Preferências e credenciais do usuário atual.'},
          {label:'MFA, sessões e auditoria consolidada',description:'Controles administrativos e verificação cross-tenant pendentes.',pending:true},
        ]}/></SubPanel>}
        {section==='privacidade'&&<SubPanel title="Governança de dados"><Destinations items={[
          {label:'Políticas de retenção por cliente',description:'Expurgo e exportação seguros ainda não homologados.',pending:true},
          {label:'Solicitações LGPD e trilha de acesso',description:'Fluxos de solicitações, auditoria e evidências ainda pendentes.',pending:true},
        ]}/></SubPanel>}
        {section==='marca'&&<SubPanel title="Identidade e comunicação"><Destinations items={[
          {label:'Marca por cliente',description:'Configuração de white-label com domínio e logotipo ainda pendente.',pending:true},
          {label:'Canais e modelos de aviso',description:'Preferências de WhatsApp/e-mail por cliente requerem interface de configuração.',pending:true},
        ]}/></SubPanel>}
        {section==='sistema'&&<SubPanel title="Configurações técnicas"><Destinations items={[
          {label:'Integrações MCP',href:'/mcp',description:'Ferramentas MCP disponíveis na área analítica.'},
          {label:'Projetos',href:'/settings',description:'Projetos e preferências operacionais.'},
          {label:'Saúde, logs, backup e flags',description:'Monitor operacional e gestão de versões ainda pendentes.',pending:true},
        ]}/></SubPanel>}
        <div className="vpx-owner-footer"><BookOpen size={14}/> As funções não homologadas aparecem como pendentes, sem ações fictícias.</div>
      </main>
    </div>
  </VigiaDashboardShell>;
}
