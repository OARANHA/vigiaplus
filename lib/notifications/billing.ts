/** Fatura só é vencida depois da data civil no fuso da organização. */
import { civilDueDate, tenantCivilClock } from './tenant-clock';

export function invoiceIsPastDue(
  status: string, dueAt: string | null | undefined, at: Date,
  timeZone='UTC',
): boolean {
  if(status!=='open'&&status!=='overdue')return false;
  if(!dueAt||!civilDueDate(dueAt)||Number.isNaN(at.getTime()))return false;
  return dueAt<tenantCivilClock(at,timeZone).day;
}
