/** Fatura só está vencida após a data civil, no fuso da organização. */
import { tenantCivilTime } from './tenant-time';

export function invoiceIsPastDue(
  status:string,dueAt:string|null|undefined,at:Date,timeZone='UTC',
):boolean{
  if(status!=='open'&&status!=='overdue')return false;
  if(!dueAt||!/^\d{4}-\d{2}-\d{2}$/.test(dueAt))return false;
  const date=new Date(dueAt+'T00:00:00.000Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==dueAt)return false;
  return dueAt<tenantCivilTime(at,timeZone).day;
}
