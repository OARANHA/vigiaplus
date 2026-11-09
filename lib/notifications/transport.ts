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
};

export type SendResult = { ok: boolean; detail: string };

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
      const key = process.env.RESEND_API_KEY;
      const from = process.env.ALERT_EMAIL_FROM ?? 'VigiaPlus <avisos@vigiaplus.app>';
      if (!key) return { ok: false, detail: 'RESEND_API_KEY ausente' };
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [d.destination], subject: d.title, text }),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: r.ok, detail: `HTTP ${r.status}` };
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
