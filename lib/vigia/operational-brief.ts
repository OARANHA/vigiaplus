/** Síntese operacional por registros existentes; ausência de coleta não é falha. */
export type Snapshot = {
  tenants: { id:number; name:string; status:string }[];
  projects: { id:number; tenantId:number; name:string; mode:string }[];
  runs: { id:number; projectId:number; status:string; startedAt:Date; newCount:number }[];
  incidents: { id:number; tenantId:number; title:string; status:string; severity:string }[];
  invoices: { id:number; tenantId:number; status:string }[];
};
export type OperationalSignal = {
  id:string; tenantId:number; tenantName:string;
  priority:'critica'|'atencao'|'informativa'; kind:'incident'|'collection'|'invoice'|'coverage';
  title:string; explanation:string;
};
export type OperationalClient = {
  id:number; name:string; status:string; projects:number;
  incidentsOpen:number; criticalIncidents:number;
  collection:'sem_projeto'|'sem_historico'|'falha'|'parcial'|'concluida'|'em_andamento';
  lastCollectionAt:string|null; overdueInvoices:number;
};
const rank={critica:0,atencao:1,informativa:2};
export function buildOperationalOverview(input:Snapshot,now=new Date()){
  const latest=new Map<number,Snapshot['runs'][number]>();
  for(const r of input.runs){const prior=latest.get(r.projectId);if(!prior||r.id>prior.id)latest.set(r.projectId,r);}
  const all=input.projects.filter(p=>p.mode==='listening');
  const clients:OperationalClient[]=[];
  const signals:OperationalSignal[]=[];
  let without=0,failed=0,opened=0,critical=0,overdue=0,last:Date|null=null;
  for(const t of input.tenants){
    const projects=all.filter(p=>p.tenantId===t.id);
    const runs=projects.map(p=>latest.get(p.id)).filter((r):r is Snapshot['runs'][number]=>Boolean(r));
    const incidents=input.incidents.filter(i=>i.tenantId===t.id&&i.status!=='closed');
    const severe=incidents.filter(i=>['high','critical'].includes(i.severity.toLowerCase()));
    const bills=input.invoices.filter(i=>i.tenantId===t.id&&i.status==='overdue');
    const missing=projects.length-runs.length;
    const broken=runs.filter(r=>r.status==='failed');
    const partial=runs.filter(r=>r.status==='partial');
    const recent=runs.reduce<Snapshot['runs'][number]|null>((a,r)=>!a||r.startedAt>a.startedAt?r:a,null);
    if(recent&&(!last||recent.startedAt>last))last=recent.startedAt;
    without+=missing;failed+=broken.length;opened+=incidents.length;critical+=severe.length;overdue+=bills.length;
    const add=(priority:OperationalSignal['priority'],kind:OperationalSignal['kind'],label:string,explanation:string,id:string)=>{
      signals.push({id:id+':'+t.id,tenantId:t.id,tenantName:t.name,priority,kind,title:label,explanation});
    };
    if(severe.length)add('critica','incident',severe.length+' ocorrência(s) de alta prioridade','Gravidade alta/crítica cadastrada; verificar responsável.','incident');
    if(broken.length)add('atencao','collection',broken.length+' projeto(s) com última coleta falha','Falha registrada na execução mais recente.','collection');
    if(bills.length)add('atencao','invoice',bills.length+' fatura(s) marcada(s) em atraso','Pendência contábil registrada; não comprova cobrança.','invoice');
    if(partial.length)add('atencao','collection',partial.length+' coleta(s) parcial(is)','Parte das fontes não concluiu a última execução.','partial');
    if(missing&&projects.length)add('informativa','coverage',missing+' projeto(s) sem histórico de coleta','Ausência de execução não comprova falha.','coverage');
    const collection:OperationalClient['collection']=projects.length===0?'sem_projeto':
      runs.length===0?'sem_historico':broken.length?'falha':partial.length?'parcial':
      runs.some(r=>r.status!=='success')?'em_andamento':missing?'sem_historico':'concluida';
    clients.push({id:t.id,name:t.name,status:t.status,projects:projects.length,
      incidentsOpen:incidents.length,criticalIncidents:severe.length,collection,
      lastCollectionAt:recent?.startedAt.toISOString()??null,overdueInvoices:bills.length});
  }
  signals.sort((a,b)=>rank[a.priority]-rank[b.priority]||
    a.tenantName.localeCompare(b.tenantName,'pt-BR')||a.id.localeCompare(b.id));
  clients.sort((a,b)=>b.criticalIncidents-a.criticalIncidents||
    (a.collection==='falha'?-1:b.collection==='falha'?1:0)||a.name.localeCompare(b.name,'pt-BR'));
  return {generatedAt:now.toISOString(),summary:{
    clients:input.tenants.length,projects:all.length,projectsWithoutRuns:without,
    projectsWithFailedRuns:failed,openIncidents:opened,criticalIncidents:critical,
    invoicesOverdue:overdue,lastCollectionAt:last?.toISOString()??null,
  },clients,signals};
}
