/**
 * ALT-07 — Hora civil por organização (IANA), sem depender do fuso da VPS.
 * Intl usa as regras IANA do runtime, inclusive transições de horário de verão.
 * Nunca somar "3 horas" ou converter datas de cobrança por offset fixo.
 */
export const DEFAULT_TENANT_TIME_ZONE = 'America/Sao_Paulo';

const formatters = new Map<string, Intl.DateTimeFormat>();

export function validTenantTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 64 ||
      !/^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(value))return false;
  try { new Intl.DateTimeFormat('en-US', {timeZone:value});return true; }
  catch {return false;}
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  if (!validTenantTimeZone(timeZone)) throw new RangeError('Fuso IANA inválido');
  let f = formatters.get(timeZone);
  if(!f){
    f=new Intl.DateTimeFormat('en-US-u-nu-latn',{
      timeZone,year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23',
    });
    formatters.set(timeZone,f);
  }
  return f;
}

export function tenantCivilTime(at:Date,timeZone:string=DEFAULT_TENANT_TIME_ZONE):{
  day:string;minutes:number;hour:number;minute:number;
}{
  if(Number.isNaN(at.getTime()))throw new RangeError('Instante inválido');
  const obj:Record<string,string>={};
  for(const part of formatter(timeZone).formatToParts(at)){
    if(part.type!=='literal')obj[part.type]=part.value;
  }
  const hour=Number(obj.hour);
  const minute=Number(obj.minute);
  return {day:`${obj.year}-${obj.month}-${obj.day}`,
    minutes:hour*60+minute,hour,minute};
}

export function minuteFromHHmm(value:string|null|undefined):number|null{
  if(typeof value!=='string')return null;
  const match=/^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  return match?Number(match[1])*60+Number(match[2]):null;
}

/**
 * Configuração de janela civil: sempre dois extremos HH:mm, ou ambos null.
 * Recusar intervalos sem instantes de liberação (por exemplo 00:00–23:59),
 * pois eles manteriam todos os alertas represados indefinidamente.
 */
export function validateQuietWindow(from:unknown,until:unknown):{
  start:string|null;end:string|null;
}{
  if(from===null && until===null)return {start:null,end:null};
  const start=minuteFromHHmm(typeof from==='string'?from:null);
  const end=minuteFromHHmm(typeof until==='string'?until:null);
  if(start===null||end===null||start===end||(start===0&&end===1439))
    throw new RangeError('Silêncio exige dois horários HH:mm e uma janela com liberação');
  return {start:from as string,end:until as string};
}

export function inQuietHours(
  from:string|null,until:string|null,at:Date,timeZone:string,
):boolean{
  const start=minuteFromHHmm(from),end=minuteFromHHmm(until);
  if(start===null||end===null)return false;
  const now=tenantCivilTime(at,timeZone).minutes;
  return start<=end?now>=start&&now<=end:now>=start||now<=end;
}

/**
 * Retorna o primeiro minuto permitido após silêncio, respeitando DST e
 * horários repetidos/inexistentes. Busca por avanço de 1 minuto para não
 * "criar" horário local durante mudança do relógio.
 * Nunca posterga mais de 48h; falha fechado se não achar janela permitida.
 */
export function nextQuietEnd(
  from:string|null,until:string|null,at:Date,timeZone:string,
):Date|null{
  if(!inQuietHours(from,until,at,timeZone))return null;
  let t=Math.ceil((at.getTime()+1)/60_000)*60_000;
  for(let i=0;i<48*60;i++,t+=60_000){
    const candidate=new Date(t);
    if(!inQuietHours(from,until,candidate,timeZone))return candidate;
  }
  // Configuração legada de silêncio integral (00:00–23:59) não tem
  // instante liberado: manter a notificação na fila e deixar o claim SQL
  // bloquear até que o proprietário corrija a política.
  return null;
}
