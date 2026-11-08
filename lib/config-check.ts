// Politica dei SEGRETI di produzione (correzione P0 dell'audit).
// SESSION_SECRET deve esistere, essere INDIPENDENTE da APP_PASSWORD e avere
// una lunghezza/entropia minima. La validazione gira all'avvio
// (instrumentation.ts) e dentro sessionSecret(): in produzione non c'è più
// nessun fallback silenzioso.

export const SESSION_SECRET_MIN_LENGTH = 32;

/** Valori notori/pubblici che non possono MAI firmare una sessione. */
const KNOWN_WEAK_SECRETS = new Set([
  'sr-dev-secret-change-me', // fallback di sviluppo
  'changeme',
  'secret',
  'session-secret',
  'session_secret',
  'production',
]);

export type SecretViolation =
  | 'missing'
  | 'too-short'
  | 'known-weak'
  | 'low-entropy'
  | 'same-as-app-password';

export function sessionSecretViolations(
  secret: string | undefined,
  appPassword: string | undefined,
): SecretViolation[] {
  const violations: SecretViolation[] = [];
  if (!secret) {
    return ['missing'];
  }
  if (secret.length < SESSION_SECRET_MIN_LENGTH) {
    violations.push('too-short');
  }
  if (KNOWN_WEAK_SECRETS.has(secret) || KNOWN_WEAK_SECRETS.has(secret.toLowerCase())) {
    violations.push('known-weak');
  }
  // Entropia minima pratica: un segreto di 32+ caratteri tutti uguali o con
  // meno di 4 caratteri distinti non è un segreto, è un pattern.
  const distinct = new Set(secret).size;
  if (distinct < 4) {
    violations.push('low-entropy');
  }
  // Indipendenza da APP_PASSWORD: la password di login conosce già troppe
  // vie per uscire dall'ufficio (post-it, browser, log). Il segreto che
  // firma OGNI sessione deve vivere per conto suo.
  if (appPassword && secret === appPassword) {
    violations.push('same-as-app-password');
  }
  return violations;
}

const HINT = 'Generate one with: openssl rand -hex 32';

export function secretViolationMessage(violations: SecretViolation[]): string {
  const parts: string[] = [];
  if (violations.includes('missing')) {
    parts.push(`SESSION_SECRET is required in production (independent of APP_PASSWORD). ${HINT}.`);
    return parts.join(' ');
  }
  if (violations.includes('too-short')) {
    parts.push(`SESSION_SECRET must be at least ${SESSION_SECRET_MIN_LENGTH} characters. ${HINT}.`);
  }
  if (violations.includes('known-weak')) {
    parts.push('SESSION_SECRET is a publicly known value; set a real secret.');
  }
  if (violations.includes('low-entropy')) {
    parts.push('SESSION_SECRET has too little variety (fewer than 4 distinct characters).');
  }
  if (violations.includes('same-as-app-password')) {
    parts.push('SESSION_SECRET must not equal APP_PASSWORD: the login password and the session-signing secret must be independent.');
  }
  return `Invalid SESSION_SECRET: ${parts.join(' ')}`;
}

/**
 * Validazione della configurazione ALL'AVVIO dell'applicazione (chiamata da
 * instrumentation.ts). In produzione, fuori dalla demo pubblica e fuori
 * dalla fase di build, un SESSION_SECRET assente o debole FERMA il boot:
 * meglio un deploy che non parte di un deploy che firma sessioni con un
 * segreto di cotenna.
 */
export function validateStartupConfig(): { ok: true } | { ok: false; message: string } {
  if (process.env.NODE_ENV !== 'production') return { ok: true };
  if (process.env.DEMO_MODE === '1') {
    // Demo pubblica: nessun login, nessun cookie di sessione firmato — il
    // segreto non serve. Eccezione deliberata e documentata (read-only).
    return { ok: true };
  }
  const violations = sessionSecretViolations(
    process.env.SESSION_SECRET,
    process.env.APP_PASSWORD,
  );
  if (violations.length > 0) {
    return { ok: false, message: secretViolationMessage(violations) };
  }
  return { ok: true };
}
