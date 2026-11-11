/**
 * Uma fatura só é um fato de cobrança vencida depois da data de vencimento.
 * Comparação civil em UTC até existir timezone do tenant (ALT-07).
 */
export function invoiceIsPastDue(
  status: string, dueAt: string | null | undefined, at: Date,
): boolean {
  if (status !== 'open' && status !== 'overdue') return false;
  if (!dueAt || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return false;
  const parsed = new Date(dueAt + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueAt) return false;
  if (Number.isNaN(at.getTime())) return false;
  return dueAt < at.toISOString().slice(0, 10);
}
