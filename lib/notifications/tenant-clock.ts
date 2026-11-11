/** Relógio civil por organização. Nenhuma dependência de TZ do sistema. */
export const DEFAULT_TENANT_TIME_ZONE = 'America/Sao_Paulo';

const formatters = new Map<string,Intl.DateTimeFormat>();
export function validTimeZone(value:unknown):value is string {
  if(typeof value!=='string'||value.length<2||value.length>80||
      !/^[A-Za-z0-9_+\-/]+$/.test(value))return false;
  try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(new Date(0));return true;}
  catch{return false;}
}
function formatter(timeZone:string):Intl.DateTimeFormat {
  let f=formatters.get(timeZone);
  if(!f){
    if(!validTimeZone(timeZone))throw new RangeError('Fuso horário IANA inválido');
    f=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',
      day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    formatters.set(timeZone,f);
  }
  return f;
}
export function tenantCivilClock(at:Date,timeZone:string):{
  day:string;minuteOfDay:number;hour:number;
}{
  if(Number.isNaN(at.getTime()))throw new RangeError('Instante inválido');
  const parts=formatter(timeZone).formatToParts(at);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const hour=Number(values.hour),minute=Number(values.minute);
  return {day:`${values.year}-${values.month}-${values.day}`,
    minuteOfDay:hour*60+minute,hour};
}
export function parseQuietMinute(value:string|null):number|null {
  if(value===null)return null;
  const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m?Number(m[1])*60+Number(m[2]):null;
}
export function isQuietAt(
  at:Date,timeZone:string,from:string|null,to:string|null,
):boolean{
  const start=parseQuietMinute(from),end=parseQuietMinute(to);
  if(start===null||end===null||start===end)return false;
  const minute=tenantCivilClock(at,timeZone).minuteOfDay;
  return start<end
    ?minute>=start&&minute<=end
    :minute>=start||minute<=end;
}

/**
 * Primeiro instante permitido após silêncio, incluindo fuso com DST.
 * Varre intervalos de 15 min e refina a primeira transição com precisão de
 * minuto. Respeita horário civil que não existe/repetido no DST.
 * Não agenda infinitamente: janelas inválidas são rejeitadas pela API.
 */
export function nextQuietEnd(
  at:Date,timeZone:string,from:string|null,to:string|null,
):Date|null{
  if(!isQuietAt(at,timeZone,from,to))return null;
  const origin=Math.floor(at.getTime()/60000)*60000;
  const max=origin+48*60*60000;
  for(let probe=origin+15*60000;probe<=max;probe+=15*60000){
    if(isQuietAt(new Date(probe),timeZone,from,to))continue;
    for(let t=probe-14*60000;t<=probe;t+=60000){
      if(t>=origin&&!isQuietAt(new Date(t),timeZone,from,to))return new Date(t);
    }
    return new Date(probe);
  }
  throw new Error('Fim da janela de silêncio não encontrado em 48 horas');
}
export function civilDueDate(dueAt:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dueAt))return false;
  const date=new Date(dueAt+'T00:00:00.000Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===dueAt;
}
