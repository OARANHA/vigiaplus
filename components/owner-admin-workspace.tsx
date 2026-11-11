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
  'coleta'|'crises'|'relatorios'|'ia'|'acessos'|'privacidade'|'auditoria'|'consumo'|'integridade'|'marca'|'sistema';
const GROUPS = [
  { label: 'GESTÃO COMERCIAL', items: [
    { id: 'clientes', label: 'Clientes', icon: Building2 },
    { id: 'planos', label: 'Planos e preços', icon: Layers },
    { id: 'recursos', label: 'Permissões por cliente', icon: SlidersHorizontal },
    { id: 'contratos', label: 'Contratos', icon: FileText },
    { id: 'financeiro', label: 'Faturamento e Pix', icon: CreditCard },
    { id: 'consumo', label: 'Consumo e cotas', icon: Activity },
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
    { id: 'auditoria', label: 'Trilha de auditoria', icon: BookOpen },
    { id: 'integridade', label: 'Integridade comercial', icon: Shield },
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
  consumo: {title: 'Consumo e limites por cliente',detail: 'Medições reais de menções coletadas e chamadas de IA nos últimos 30 dias. Cotas ainda não são bloqueadas automaticamente.'},
  fontes: {title: 'Fontes e conectores',detail: 'Configuração dos conectores existentes e visibilidade das pendências de integrações por cliente.'},
  coleta: {title: 'Coleta e fila',detail: 'Acompanhamento e operação; agendamento por cliente exige homologação específica.'},
  crises: {title: 'Alertas e crises',detail: 'Ocorrências reais, regras e fluxos de acompanhamento.'},
  relatorios: {title: 'Relatórios',detail: 'Produção e exportação dos relatórios disponíveis.'},
  ia: {title: 'Modelos e custos de IA',detail: 'Provedores compatíveis e controle de disponibilidade, custo e credenciais.'},
  acessos: {title: 'Usuários e segurança',detail: 'Equipe, permissões e controles de acesso.'},
  privacidade: {title: 'Privacidade e retenção',detail: 'Políticas de dados, retenção e solicitações de titulares.'},
  auditoria: {title: 'Trilha de auditoria',detail: 'Registros recentes de mudanças, com data, operador, organização e justificativa. Dados sensíveis são omitidos.'},
  integridade: {title: 'Integridade dos contratos',detail: 'Diagnóstico de índices e duplicidades que podem impedir alterações seguras de planos e permissões.'},
  marca: {title: 'Marca e comunicação',detail: 'Identidade visual e canais de avisos, separados por cliente.'},
  sistema: {title: 'Sistema e integrações',detail: 'Conectividade, monitoramento e configuração da plataforma.'},
};
type ClientInvitation = {id:number;tenantId:number;email:string;role:string;status:string;
  createdAt:string;expiresAt:string};
type EmailDiag = {keyConfigured:boolean;senderConfigured:boolean;publicUrlHttps:boolean;
  readyForTest:boolean;providerDomainVerified:null;testRecipient:string|null;
  lastTest:{createdAt:string;status:string}|null};
type OwnerChannel = {id:number;channel:string;destination:string;verified:boolean;
  active:boolean;verifiedAt:string|null};
type OwnerDelivery = {id:number;eventRef:string|null;sourceProjectId:number|null;
  channel:string;destination:string;status:string;providerMessageId:string|null;
  attemptCount:number;nextAttemptAt:string|null;leaseExpiresAt:string|null;
  error:string|null;createdAt:string;sentAt:string|null};
const DELIVERY_LABELS:Record<string,string>={
  queued:'Na fila',processing:'Em processamento',retry:'Aguardando tentativa',
  dead_letter:'Falha definitiva',sent:'Aceito pelo transporte',
  failed:'Falha antiga',
};
function showDate(value:string|null|undefined):string {
  if(!value)return '—';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleString('pt-BR');
}
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
type Usage = { window:{start:string;end:string;days:number};quotasEnforced:boolean;clients:{
  tenantId:number;name:string;status:string;subscriptionStatus:string;planKey:string|null;
  mentions:{used:number;limit:number|null};ai:{usedBrl:number;limitBrl:number|null;calls:number};
  retentionMonths:number|null;
}[] };
type Integrity = {ready:boolean;featureIndex:boolean;subscriptionIndex:boolean;
  duplicateFeatures:{tenant_id:number;feature_key:string;total:number}[];
  duplicateSubscriptions:{tenant_id:number;total:number}[];action:string};
type Audit = {events:{id:number;actor:string|null;tenantId:number|null;action:string;
  target:string|null;reason:string|null;createdAt:string}[]};
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
  const [usage,setUsage]=useState<Usage|null>(null);
  const [audit,setAudit]=useState<Audit|null>(null);
  const [integrity,setIntegrity]=useState<Integrity|null>(null);
  const [auditTenant,setAuditTenant]=useState(0);
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
  const [invitations,setInvitations]=useState<ClientInvitation[]>([]);
  const [deliveries,setDeliveries]=useState<OwnerDelivery[]>([]);
  const [emailDiag,setEmailDiag]=useState<EmailDiag|null>(null);
  const [channels,setChannels]=useState<OwnerChannel[]>([]);
  const [newAlertEmail,setNewAlertEmail]=useState('');
  const [deliveryReason,setDeliveryReason]=useState('');
  const [deliveriesLoading,setDeliveriesLoading]=useState(false);
  const [inviteEmail,setInviteEmail]=useState('');
  const [inviteRole,setInviteRole]=useState<'client_admin'|'client_viewer'>('client_admin');
  const [inviteReason,setInviteReason]=useState('');
  const [inviteLink,setInviteLink]=useState('');
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
    if(section!=='integridade')return;
    setIntegrity(null);
    void api<Integrity>('/api/console/commercial-integrity').then(setIntegrity)
      .catch(e=>setError('Integridade indisponível: '+String(e)));
  },[section]);

  useEffect(()=>{
    if(section!=='consumo'&&section!=='auditoria')return;
    if(section==='consumo') {
      setUsage(null);
      void api<Usage>('/api/console/usage').then(setUsage)
        .catch(e=>setError('Consumo indisponível: '+String(e)));
    } else {
      setAudit(null);
      void api<Audit>('/api/console/audit'+(auditTenant?'?tenant_id='+auditTenant:''))
        .then(setAudit).catch(e=>setError('Auditoria indisponível: '+String(e)));
    }
  },[section,auditTenant]);

  useEffect(()=>{
    if(section!=='acessos'||!selectedTenant)return;
    void api<{invitations:ClientInvitation[]}>('/api/console/invitations?tenant_id='+selectedTenant)
      .then(data=>setInvitations(data.invitations))
      .catch(e=>setError('Convites indisponíveis: '+String(e)));
  },[section,selectedTenant]);
  useEffect(()=>{
    if(section!=='crises')return;
    void api<EmailDiag>('/api/console/notifications/email-diagnostics')
      .then(setEmailDiag).catch(e=>setError('Diagnóstico de e-mail indisponível: '+String(e)));
  },[section]);
  useEffect(()=>{
    if(section!=='crises'||!selectedTenant)return;
    void api<{channels:OwnerChannel[]}>('/api/notifications/channels?tenant_id='+selectedTenant)
      .then(x=>setChannels(x.channels))
      .catch(e=>{setChannels([]);setError('Destinatários indisponíveis: '+String(e));});
  },[section,selectedTenant]);
  useEffect(()=>{
    if(section!=='crises'||!selectedTenant)return;
    setDeliveriesLoading(true);
    void api<{deliveries:OwnerDelivery[]}>('/api/console/notifications?tenant_id='+selectedTenant)
      .then(data=>setDeliveries(data.deliveries))
      .catch(e=>{setDeliveries([]);setError('Fila de alertas indisponível: '+String(e));})
      .finally(()=>setDeliveriesLoading(false));
  },[section,selectedTenant]);
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
  async function createInvitation(){
    if(!selectedTenant)return;
    setBusy(true);setMessage('');setError('');setInviteLink('');
    try{
      const result=await api<{inviteUrl?:string;message:string}>('/api/console/invitations',json({
        tenantId:selectedTenant,email:inviteEmail,role:inviteRole,reason:inviteReason,
      }));
      setInviteEmail('');setInviteReason('');
      setInviteLink(result.inviteUrl??'');
      setMessage(result.message);
      const updated=await api<{invitations:ClientInvitation[]}>(
        '/api/console/invitations?tenant_id='+selectedTenant);
      setInvitations(updated.invitations);
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function revokeInvitation(id:number){
    if(!selectedTenant)return;
    setBusy(true);setError('');setMessage('');setInviteLink('');
    try{
      await api('/api/console/invitations',{method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tenantId:selectedTenant,invitationId:id,
          reason:inviteReason.trim()||'Revogado pelo proprietário no painel'}),
      });
      const updated=await api<{invitations:ClientInvitation[]}>(
        '/api/console/invitations?tenant_id='+selectedTenant);
      setInvitations(updated.invitations);setMessage('Convite revogado sem alterar outras contas.');
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  async function refreshChannels(){
    if(!selectedTenant)return;
    const updated=await api<{channels:OwnerChannel[]}>(
      '/api/notifications/channels?tenant_id='+selectedTenant);
    setChannels(updated.channels);
  }
  async function createAlertEmail(){
    if(!selectedTenant||!newAlertEmail.trim())return;
    setBusy(true);setError('');setMessage('');
    try{
      await api('/api/notifications/channels?tenant_id='+selectedTenant,
        json({channel:'email',destination:newAlertEmail.trim()}));
      setNewAlertEmail('');
      await refreshChannels();
      setMessage('Destinatário adicionado sem permissão para receber alertas. Solicite sua confirmação.');
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function requestEmailProof(channelId:number){
    if(!selectedTenant)return;
    setBusy(true);setError('');setMessage('');
    try{
      const response=await api<{message:string}>(
        '/api/notifications/channels/verify/request?tenant_id='+selectedTenant,
        json({channelId}));
      setMessage(response.message);
      await refreshChannels();
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function runEmailDiagnostic(){
    setBusy(true);setError('');setMessage('');
    try{
      const result=await api<{message:string}>('/api/console/notifications/email-diagnostics',
        json({confirm:'ENVIAR_TESTE_PARA_MINHA_CONTA'}));
      setMessage(result.message);
      setEmailDiag(await api<EmailDiag>('/api/console/notifications/email-diagnostics'));
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  }
  async function refreshDeliveries(){
    if(!selectedTenant)return;
    setDeliveriesLoading(true);setError('');
    try{
      const data=await api<{deliveries:OwnerDelivery[]}>(
        '/api/console/notifications?tenant_id='+selectedTenant);
      setDeliveries(data.deliveries);
    }catch(e){setError('Fila de alertas indisponível: '+String(e));}
    finally{setDeliveriesLoading(false);}
  }
  async function requeueDelivery(deliveryId:number){
    if(!selectedTenant||deliveryReason.trim().length<5)return;
    setBusy(true);setError('');setMessage('');
    try{
      await api('/api/console/notifications',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tenantId:selectedTenant,deliveryId,reason:deliveryReason}),
      });
      setDeliveryReason('');
      setMessage('Entrega devolvida à fila com auditoria. O próximo worker tentará o envio.');
      await refreshDeliveries();
    }catch(e){setError('Reprocessamento não autorizado ou indisponível: '+String(e));}
    finally{setBusy(false);}
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
        {section==='consumo'&&<>
          <SubPanel title="Uso nos últimos 30 dias">
            <p className="vpx-owner-muted">Janela móvel de 30 dias: menções pelo horário de coleta e consumo de IA registrado. Não são estimativas.</p>
            <div className="vpx-alert">Monitoramento informativo: o bloqueio automático de cotas ainda não está implementado em todas as APIs e coletores.</div>
            {usage===null?<p className="vpx-owner-muted">Consultando medições…</p>:
              <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
                <thead><tr><th>Organização</th><th>Plano</th><th>Menções / limite</th><th>IA / teto</th><th>Chamadas IA</th></tr></thead>
                <tbody>{usage.clients.map(c=><tr key={c.tenantId}>
                  <td className="vpx-maincell">{c.name}<small className="vpx-owner-sub">{c.status}</small></td>
                  <td>{c.planKey??c.subscriptionStatus}</td>
                  <td>{c.mentions.used.toLocaleString('pt-BR')} / {c.mentions.limit?.toLocaleString('pt-BR')??'—'}</td>
                  <td>{currency(c.ai.usedBrl)} / {currency(c.ai.limitBrl)}</td>
                  <td>{c.ai.calls.toLocaleString('pt-BR')}</td>
                </tr>)}</tbody>
              </table></div>}
          </SubPanel>
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
        {section==='crises'&&<>
          <SubPanel title="Resend — estado do envio de e-mails">
            <p className="vpx-owner-muted">O diagnóstico não mostra credenciais e não afirma domínio verificado. O teste só pode ser enviado ao e-mail da conta do proprietário, mediante clique.</p>
            <p>{emailDiag?.readyForTest?'Configurado para teste (entrega não verificada)':'Não configurado para testes externos'}</p>
            <p className="vpx-owner-muted">Chave: {emailDiag?.keyConfigured?'presente':'ausente'} · Remetente: {emailDiag?.senderConfigured?'informado':'ausente'} · URL pública HTTPS: {emailDiag?.publicUrlHttps?'configurada':'ausente'}</p>
            <p>Destinatário permitido: {emailDiag?.testRecipient??'conta não identificada'}</p>
            {emailDiag?.lastTest&&<p>Último teste: {showDate(emailDiag.lastTest.createdAt)} · {emailDiag.lastTest.status==='accepted_by_provider'?'Aceito pelo provedor, entrega não confirmada':'Falha / não comprovado'}</p>}
            <button type="button" className="vpx-owner-button" disabled={busy||!emailDiag?.readyForTest||!emailDiag.testRecipient}
              onClick={()=>{void runEmailDiagnostic();}}>Enviar teste somente para minha conta</button>
          </SubPanel>
          <SubPanel title="Destinatários de alertas por organização">
            <p className="vpx-owner-muted">Novos e-mails começam bloqueados. Um link temporário é enviado ao destinatário, que precisa confirmar sua posse. Canais antigos sem prova ficam bloqueados.</p>
            <div className="vpx-owner-formgrid">
              <label>E-mail de destino
                <input type="email" value={newAlertEmail} maxLength={254}
                  onChange={e=>setNewAlertEmail(e.target.value)} placeholder="responsavel@cliente.com.br"/>
              </label>
            </div>
            <button type="button" className="vpx-owner-button" disabled={busy||!selectedTenant||!newAlertEmail.includes('@')}
              onClick={()=>{void createAlertEmail();}}>Adicionar e-mail bloqueado</button>
            <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
              <thead><tr><th>Canal</th><th>Destino</th><th>Prova de posse</th><th>Ação</th></tr></thead>
              <tbody>{channels.map(ch=><tr key={ch.id}>
                <td>{ch.channel}</td><td>{ch.destination}</td>
                <td>{ch.verified?'Verificado':'Não comprovado'}{!ch.active?' · inativo':''}</td>
                <td>{ch.channel==='email'&&!ch.verified
                  ?<button type="button" disabled={busy||!emailDiag?.readyForTest}
                     onClick={()=>{void requestEmailProof(ch.id);}}>Enviar link de confirmação</button>:'—'}</td>
              </tr>)}
              {channels.length===0&&<tr><td colSpan={4}>Nenhum destinatário cadastrado ou acesso indisponível.</td></tr>}
              </tbody></table></div>
          </SubPanel>
          <SubPanel title="Fila de notificações por cliente">
            <p className="vpx-owner-muted">Envios com HTTP 2xx aparecem como aceitos pelo transporte, não entregues. Retries dependem da próxima execução do worker. Nenhuma atualização automática é feita nesta tela.</p>
            <div className="vpx-owner-formgrid">
              <label>Organização
                <select value={selectedTenant??''} onChange={e=>setSelectedTenant(Number(e.target.value))}>
                  {clients.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label>Justificativa de reprocessamento
                <input value={deliveryReason} maxLength={300}
                  onChange={e=>setDeliveryReason(e.target.value)}
                  placeholder="Ex.: falha do provedor resolvida"/>
              </label>
            </div>
            <button type="button" className="vpx-owner-button"
              disabled={!selectedTenant||deliveriesLoading} onClick={()=>{void refreshDeliveries();}}>
              {deliveriesLoading?'Consultando…':'Atualizar fila'}
            </button>
            <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
              <thead><tr><th>Origem</th><th>Destino</th><th>Estado</th><th>Tentativas</th><th>Próximo evento</th><th>Ação</th></tr></thead>
              <tbody>
                {deliveries.map(d=><tr key={d.id}>
                  <td>{d.eventRef??'Registro anterior'}
                    {d.sourceProjectId&&<p className="vpx-owner-muted">Projeto #{d.sourceProjectId}</p>}</td>
                  <td>{d.channel}: {d.destination}</td>
                  <td>{DELIVERY_LABELS[d.status]??d.status}
                    {d.providerMessageId&&<p className="vpx-owner-muted">ID provedor: {d.providerMessageId}</p>}
                    {d.error&&<p className="vpx-owner-muted">{d.error}</p>}</td>
                  <td>{d.attemptCount}/5</td>
                  <td>{d.status==='retry'?showDate(d.nextAttemptAt):
                    d.status==='processing'?showDate(d.leaseExpiresAt):
                    d.status==='sent'?showDate(d.sentAt):showDate(d.createdAt)}</td>
                  <td>{d.status==='dead_letter'
                    ?<button type="button" disabled={busy||deliveryReason.trim().length<5}
                      onClick={()=>{void requeueDelivery(d.id);}}>Reprocessar</button>:'—'}</td>
                </tr>)}
                {!deliveriesLoading&&deliveries.length===0&&<tr><td colSpan={6}>Sem entregas registradas para a organização.</td></tr>}
              </tbody>
            </table></div>
          </SubPanel>
          <SubPanel title="Gestão de crises"><Destinations items={[
            {label:'Alertas e ocorrências',href:'/alerts',description:'Alertas e menções registrados na aplicação.'},
            {label:'Regras por contrato e escalonamento',description:'Simulação, confirmação real da entrega e escalonamento ainda dependem de homologação.',pending:true},
          ]}/></SubPanel>
        </>}
        {section==='relatorios'&&<SubPanel title="Relatórios e entregas"><Destinations items={[
          {label:'Relatórios disponíveis',href:'/report',description:'Geração e consulta dos relatórios existentes.'},
          {label:'Periodicidade e entrega automática',description:'Gestão da entrega por plano e cliente ainda pendente.',pending:true},
        ]}/></SubPanel>}
        {section==='acessos'&&<>
          <SubPanel title="Convites de acesso por cliente">
            <p className="vpx-owner-muted">A conta só é criada após o aceite. Um convite tem 48 horas, é de uso único e não libera dados de um contrato inativo.</p>
            <div className="vpx-owner-formgrid">
              <label>Organização
                <select value={selectedTenant??''} onChange={e=>{
                    setSelectedTenant(Number(e.target.value));setInviteLink('');}}>
                  {clients.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select></label>
              <label>E-mail do convidado
                <input type="email" value={inviteEmail} autoComplete="off"
                  onChange={e=>setInviteEmail(e.target.value)} placeholder="pessoa@empresa.com.br"/></label>
              <label>Perfil inicial
                <select value={inviteRole} onChange={e=>setInviteRole(e.target.value as typeof inviteRole)}>
                  <option value="client_admin">Administrador do cliente</option>
                  <option value="client_viewer">Somente leitura</option>
                </select></label>
              <label>Justificativa
                <input value={inviteReason} maxLength={300}
                  onChange={e=>setInviteReason(e.target.value)}
                  placeholder="Primeiro acesso contratado"/></label>
            </div>
            <button type="button" className="vpx-owner-button" disabled={busy||!selectedTenant||!inviteEmail.includes('@')||inviteReason.trim().length<5}
              onClick={()=>{void createInvitation();}}>Gerar convite de uso único</button>
            {inviteLink&&<div className="vpx-alert" role="status">
              <p>Link de ativação (desenvolvimento local, apenas uma exibição; sem envio automático):</p>
              <input value={inviteLink} readOnly aria-label="Link temporário de convite"/>
              <button type="button" onClick={()=>{void navigator.clipboard.writeText(inviteLink);}}>Copiar link</button>
            </div>}
          </SubPanel>
          <SubPanel title="Convites registrados">
            <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
              <thead><tr><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Vencimento</th><th>Ação</th></tr></thead>
              <tbody>{invitations.map(i=><tr key={i.id}>
                <td>{i.email}</td><td>{i.role==='client_admin'?'Administrador':'Leitura'}</td>
                <td>{i.status}</td><td>{new Date(i.expiresAt).toLocaleString('pt-BR')}</td>
                <td>{i.status==='pendente'?<button type="button" disabled={busy}
                  onClick={()=>{void revokeInvitation(i.id);}}>Revogar</button>:'—'}</td>
              </tr>)}
              {!invitations.length&&<tr><td colSpan={5}>Nenhum convite registrado para o cliente selecionado.</td></tr>}
              </tbody></table></div>
          </SubPanel>
          <SubPanel title="Acesso e segurança"><Destinations items={[
            {label:'Equipe interna',href:'/impostazioni/team',description:'Gestão da equipe de análise, separada dos convites dos clientes.'},
            {label:'Minha conta',href:'/impostazioni/account',description:'Alterar sua senha e consultar seu perfil.'},
            {label:'Convite para usuário já cadastrado',description:'Vinculação multi-organização exige validação autenticada e ainda não está liberada.',pending:true},
            {label:'MFA e sessões de segurança',description:'Autenticação multifator e gestão de dispositivos ainda pendentes.',pending:true},
          ]}/></SubPanel>
        </>}
        {section==='privacidade'&&<SubPanel title="Governança de dados"><Destinations items={[
          {label:'Políticas de retenção por cliente',description:'Expurgo e exportação seguros ainda não homologados.',pending:true},
          {label:'Solicitações de titulares e expurgo',description:'Fluxos de solicitações, auditoria de exclusão e evidências ainda pendentes.',pending:true},
        ]}/></SubPanel>}
        {section==='auditoria'&&<>
          <SubPanel title="Eventos de auditoria">
            <div className="vpx-owner-formgrid">
              <label>Filtrar organização<select value={auditTenant} onChange={e=>setAuditTenant(Number(e.target.value))}>
                <option value={0}>Todas as organizações</option>
                {clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
              </select></label>
            </div>
            <p className="vpx-owner-muted">Até 50 registros mais recentes. Endereços IP e metadados não são expostos nesta consulta.</p>
            {audit===null?<p className="vpx-owner-muted">Consultando eventos…</p>:
              <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
                <thead><tr><th>Quando</th><th>Operador</th><th>Organização</th><th>Ação</th><th>Motivo</th></tr></thead><tbody>
                  {audit.events.map(e=><tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString('pt-BR')}</td>
                    <td>{e.actor??'Não identificado'}</td>
                    <td>{clients.find(c=>c.id===e.tenantId)?.name??(e.tenantId===null?'Plataforma':'#'+e.tenantId)}</td>
                    <td>{e.action}</td><td>{e.reason??'Não informado'}</td>
                  </tr>)}
                  {audit.events.length===0&&<tr><td colSpan={5}>Nenhum evento para o filtro selecionado.</td></tr>}
                </tbody></table></div>}
          </SubPanel>
        </>}
        {section==='integridade'&&<SubPanel title="Conferência da base comercial">
          {integrity===null?<p className="vpx-owner-muted">Consultando índices e duplicidades…</p>:<>
            <div className="vpx-owner-metrics">
              <div><small>Proteção de permissões</small><strong>{integrity.featureIndex?'Ativa':'Pendente'}</strong></div>
              <div><small>Proteção de contratos</small><strong>{integrity.subscriptionIndex?'Ativa':'Pendente'}</strong></div>
              <div><small>Condição geral</small><strong>{integrity.ready?'Íntegra':'Revisar'}</strong></div>
            </div>
            <p className="vpx-owner-muted">Duplicidades em recursos: {integrity.duplicateFeatures.length}. 
              Contratos simultâneos: {integrity.duplicateSubscriptions.length}.</p>
            {(integrity.duplicateFeatures.length>0||integrity.duplicateSubscriptions.length>0)&&
              <div className="vpx-alert">Escritas comerciais protegidas. Nenhum dado será removido automaticamente.</div>}
            <div className="vpx-owner-table-scroll"><table className="vpx-data-table">
              <thead><tr><th>Organização</th><th>Recurso</th><th>Ocorrências</th></tr></thead><tbody>
                {integrity.duplicateFeatures.map(f=><tr key={f.tenant_id+':'+f.feature_key}>
                  <td>{clients.find(c=>c.id===f.tenant_id)?.name??'#'+f.tenant_id}</td>
                  <td>{f.feature_key}</td><td>{f.total}</td>
                </tr>)}
                {integrity.duplicateSubscriptions.map(f=><tr key={'subscription:'+f.tenant_id}>
                  <td>{clients.find(c=>c.id===f.tenant_id)?.name??'#'+f.tenant_id}</td>
                  <td>Assinaturas em conflito</td><td>{f.total}</td>
                </tr>)}
                {integrity.ready&&<tr><td colSpan={3}>Não foram detectadas duplicidades nos critérios verificados.</td></tr>}
              </tbody>
            </table></div>
          </>}
          <p className="vpx-owner-muted">Reconciliação de registros exige aprovação explícita. Esta tela é somente leitura.</p>
        </SubPanel>}
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
