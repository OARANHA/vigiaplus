/** Vencimento por data civil do cliente, não pelo relógio UTC da VPS. */
import { tenantCivilTime } from './tenant-time';

export function invoiceIsPastDue(
  status:string,dueAt:string|null|undefined,at:Date,timeZone='UTC',
):boolean {
  if(status!=='open' && status!=='overdue')return false;
  if(!dueAt || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt))return false;
  const parsed=new Date(dueAt+'T00:00:00.000Z');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==dueAt)return false;
  if(Number.isNaN(at.getTime()))return false;
  return dueAt < tenantCivilTime(at,timeZone).day;
}
