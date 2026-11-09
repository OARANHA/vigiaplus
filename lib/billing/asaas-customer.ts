/** Resolve/inscreve cliente pagador Asaas a partir da identidade do tenant autenticado. */
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenants, subscriptions } from '@/lib/db/schema';
import { asaas } from './gateways';

export async function ensureAsaasCustomer(tenantId: number): Promise<string> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('Tenant inválido');
  const db = await getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  if (!sub) throw new Error('Assinatura do cliente não encontrada');
  if (sub.gatewayCustomerId && /^cus_[A-Za-z0-9]+$/.test(sub.gatewayCustomerId)) return sub.gatewayCustomerId;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Cliente não encontrado');
  const cpfCnpj = (tenant.cnpj ?? '').replace(/\D/g, '');
  if (![11, 14].includes(cpfCnpj.length)) {
    throw new Error('Cadastre um CPF/CNPJ válido para gerar a cobrança Pix');
  }
  const externalReference = `vigiaplus-tenant-${tenantId}`;
  // Consulta anterior ao POST evita duplicações depois de timeout/retry.
  const listed = await asaas(`/v3/customers?externalReference=${encodeURIComponent(externalReference)}`);
  const customers = Array.isArray(listed.data) ? listed.data as Record<string, unknown>[] : [];
  if (customers.length > 1) throw new Error('Cliente Asaas ambíguo: requer conciliação manual');
  let customerId: string;
  if (customers.length === 1) {
    const row = customers[0];
    if (String(row.cpfCnpj ?? '').replace(/\D/g, '') !== cpfCnpj) {
      throw new Error('Cliente Asaas encontrado com documento divergente');
    }
    customerId = String(row.id ?? '');
  } else {
    const created = await asaas('/v3/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: tenant.name,
        cpfCnpj,
        externalReference,
        notificationDisabled: true,
      }),
    });
    customerId = String(created.id ?? '');
  }
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error('Asaas não retornou um customer ID válido');
  await db.update(subscriptions).set({ gatewayCustomerId: customerId })
    .where(eq(subscriptions.tenantId, tenantId));
  return customerId;
}
