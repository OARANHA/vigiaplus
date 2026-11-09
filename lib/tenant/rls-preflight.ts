/**
 * Critérios de prontidão RLS a partir do catálogo PostgreSQL.
 * Isto NÃO demonstra segurança sozinho: devem existir testes de acesso cruzado
 * e validação de permissões com a role de execução real.
 */
export const TENANT_RLS_TABLES = [
  'tenants', 'memberships', 'tenant_features', 'reputation_targets',
  'incidents', 'incident_actions', 'projects', 'subscriptions', 'invoices',
  'payment_events', 'notification_channels', 'alert_rules',
  'notification_deliveries', 'llm_usage', 'mcp_tokens', 'invitations', 'audit_events',
] as const;

export type RlsRoleInfo = { role: string; superuser: boolean; bypassRls: boolean };
export type RlsTableInfo = { name: string; owner: string; rlsEnabled: boolean; forceRls: boolean };
export type RlsPolicyInfo = { table: string; qualification: string | null; withCheck: string | null };
export type RlsPreflightInput = {
  role: RlsRoleInfo;
  tables: RlsTableInfo[];
  policies: RlsPolicyInfo[];
  connectionDriver: 'neon-http' | 'transactional';
};

export function assessRlsReadiness(input: RlsPreflightInput): string[] {
  const errors: string[] = [];
  if (input.connectionDriver !== 'transactional') {
    errors.push('Driver HTTP sem transações interativas; SET LOCAL não pode proteger múltiplas queries');
  }
  if (input.role.superuser || input.role.bypassRls) {
    errors.push('A role da aplicação possui SUPERUSER ou BYPASSRLS');
  }
  for (const name of TENANT_RLS_TABLES) {
    const table = input.tables.find((row) => row.name === name);
    if (!table) { errors.push(`Tabela ${name} ausente`); continue; }
    if (!table.rlsEnabled) errors.push(`RLS desativado na tabela ${name}`);
    if (table.owner === input.role.role && !table.forceRls) {
      errors.push(`Role da aplicação é dona de ${name} sem FORCE ROW LEVEL SECURITY`);
    }
    const policies = input.policies.filter((p) => p.table === name);
    if (policies.length === 0) errors.push(`Sem política RLS em ${name}`);
    for (const policy of policies) {
      const expressions = [policy.qualification, policy.withCheck].filter(Boolean).join(' ');
      if (/current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s+IS\s+NULL/i.test(expressions) ||
          /current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*=\s*''/i.test(expressions) ||
          /^\s*\(?\s*true\s*\)?\s*$/i.test(policy.qualification ?? '') ||
          /^\s*(?:true|\(true\))\s*$/i.test(policy.withCheck ?? '')) {
        errors.push(`Política permissiva com escopo ausente em ${name}`);
      }
    }
  }
  return errors;
}
