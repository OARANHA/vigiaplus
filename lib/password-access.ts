/**
 * A troca de senha temporária é obrigatória no servidor, não apenas no login.
 * A única exceção autenticada é a tela de conta (incluindo sua Server Action).
 * O endpoint /api/auth é independente deste gate para logout/revogação.
 */
export function canUseBusinessSurface(
  mustChangePassword: number | boolean,
  pathname: string | null | undefined,
): boolean {
  if (!mustChangePassword) return true;
  return pathname === '/impostazioni/account' ||
    pathname?.startsWith('/impostazioni/account/') === true;
}
