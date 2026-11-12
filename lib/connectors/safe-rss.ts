/**
 * Escudo para RSS informado por usuário/projeto.
 * Produção: domínios explícitos + resolução pública + HTTPS, sem redirects.
 * Impor bloqueio adicional de egress privado no firewall/infra para cobrir
 * DNS rebinding entre a validação DNS e a conexão do runtime fetch.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 1_000_000;

export function isUnsafeHost(raw: string): boolean {
  const h = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal') ||
      h.endsWith('.lan') || h.endsWith('.home.arpa') ||
      h.endsWith('.test') || h === 'metadata.google.internal') return true;
  if (isIP(h) === 4) {
    const [a, b, c] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 88 && c === 99);
  }
  if (isIP(h) === 6 || h.includes(':')) {
    if (h.startsWith('::ffff:')) return isUnsafeHost(h.slice(7));
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) ||
      h.startsWith('2001:db8');
  }
  return false;
}

export function assertRssUrl(
  raw: string,
  allowedHosts: string[] = [],
  production = process.env.NODE_ENV === 'production',
): URL {
  const url = new URL(raw);
  if ((production ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) ||
      url.username || url.password || !url.hostname || url.port) {
    throw new Error('Feed RSS: URL, protocolo, credenciais ou porta não permitidos');
  }
  if (isUnsafeHost(url.hostname)) throw new Error('Feed RSS: host local ou reservado bloqueado');
  if (production && !allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) {
    throw new Error('Feed RSS não está na allowlist RSS_ALLOWED_HOSTS');
  }
  return url;
}

export async function assertRssDnsPublic(url: URL, resolve: (host: string) => Promise<string[]> = async (host) => {
  const addresses = await lookup(host, { all: true });
  return addresses.map((item) => item.address);
}): Promise<void> {
  const addresses = await resolve(url.hostname);
  if (!addresses.length || addresses.some(isUnsafeHost)) {
    throw new Error('Feed RSS: destino DNS privado/reservado ou sem resolução');
  }
}

export async function fetchSafeRssText(rawUrl: string): Promise<string> {
  const production = process.env.NODE_ENV === 'production';
  const allow = (process.env.RSS_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const url = assertRssUrl(rawUrl, allow, production);
  // Em dev, manter os testes de conector com mocks; em produção, DNS obrigatório.
  if (production) await assertRssDnsPublic(url);
  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'VigiaPlus-RSS/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} no feed RSS`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error('Feed RSS excede 1 MB');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('Feed RSS excede 1 MB');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
