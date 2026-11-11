/**
 * Transportes de aviso. Nenhum segredo fica no banco: destinatarios sao
 * registrados em notification_channels, credenciais vem de ENV.
 * Tudo em pt-BR e com o "numero unico": o aviso traz o dado, a comparacao
 * e a origem — nunca so um adjetivo.
 */
export type Delivery = {
  channel: string;
  destination: string;
  title: string;
  message: string;
  /** Header Resend: chave estável por entrega para retries em até 24 h. */
  idempotencyKey?: string;
};

export type SendResult = { ok: boolean; detail: string; providerId?: string };

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<SendResult> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: r.ok, detail: `HTTP ${r.status}` };
}

export async function send(d: Delivery): Promise<SendResult> {
  const text = `*${d.title}*\n\n${d.message}\n\n— VigiaPlus`;

  switch (d.channel) {
    case 'telegram': {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return { ok: false, detail: 'TELEGRAM_BOT_TOKEN ausente' };
      return postJson(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: d.destination, text, parse_mode: 'Markdown', disable_web_page_preview: true },
      );
    }
    case 'email': {
      const key = process.env.RESEND_API_KEY?.trim();
      const from = process.env.ALERT_EMAIL_FROM?.trim();
      // Não fingir que existe um remetente verificado: nunca usar fallback.
      if (!key || !from) return { ok: false, detail: 'EMAIL_NOT_CONFIGURED' };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.destination.trim())) {
        return { ok: false, detail: 'EMAIL_DESTINATION_INVALID' };
      }
      const headers: Record<string,string> = {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      };
      if (d.idempotencyKey && d.idempotencyKey.length <= 256 &&
          /^[a-zA-Z0-9._:/-]+$/.test(d.idempotencyKey)) {
        headers['Idempotency-Key'] = d.idempotencyKey;
      }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers,
        body: JSON.stringify({ from, to: [d.destination.trim()], subject: d.title, text }),
        signal: AbortSignal.timeout(10_000),
      });
      // ID permite conciliação com webhook futuro; jamais retornar mensagem do
      // provedor (pode conter segredo, payload ou PII).
      if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
      const data: unknown = await r.json().catch(() => null);
      const id = data && typeof data === 'object' && typeof (data as {id?:unknown}).id === 'string'
        ? (data as {id:string}).id : null;
      return {
        ok: true, detail: `HTTP ${r.status}`,
        ...(id && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? { providerId: id } : {}),
      };
    }
    case 'whatsapp':
    case 'webhook':
    case 'slack': {
      if (!/^https:\/\//i.test(d.destination)) {
        return { ok: false, detail: 'destino webhook exige HTTPS' };
      }
      return postJson(d.destination, { title: d.title, message: d.message, source: 'vigiaplus' });
    }
    case 'ledger':
      // Registro interno (cobranca/auditoria): nao ha entrega externa.
      return { ok: true, detail: 'registrado no historico' };
    default:
      return { ok: false, detail: `canal desconhecido: ${d.channel}` };
  }
}
