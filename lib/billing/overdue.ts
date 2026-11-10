// Classificação de inadimplência: fatura a vencer não é atraso.
// Aplicação usa data civil de referência da operação brasileira.
export type InvoiceDueInput = {
  status: string;
  dueAt: string | null;
};

export function brazilCivilDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const field = (kind: string) => parts.find(p => p.type === kind)?.value ?? '';
  return [field('year'), field('month'), field('day')].join('-');
}

export function isInvoiceOverdue(invoice: InvoiceDueInput, today: string): boolean {
  if (invoice.status === 'overdue') return true;
  return invoice.status === 'open' && invoice.dueAt !== null && invoice.dueAt < today;
}
