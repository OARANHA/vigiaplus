import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  createRadarMcpServer, mcpToken, readToken, resolveMcpTenant, tokenHash, checkRateLimit,
} from '@/lib/mcp';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';

// Endpoint MCP do VigiaPlus: streamable HTTP, sem sessão de usuário.
//
// É o único transport que o Microsoft Copilot Studio fala (SSE é deprecado
// desde agosto de 2025, stdio não é suportado) e também o que o Claude aceita
// para servidores remotos: um endpoint só, dois mundos.
//
// O escopo vem do TOKEN, não de cookie: RADAR_MCP_TOKEN continua valendo como
// fallback global da equipe interna (tenantId 0), e tokens por tenant são
// resolvidos por SHA-256 em mcp_tokens. Sem token válido o endpoint fecha.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  // As credenciais salvas no app (não só as env vars) precisam estar em cache
  // antes de ler o token e antes de as ferramentas tocarem os dados.
  await hydrateConnectorCredentials();

  const token = readToken(req.headers);
  if (!token) {
    return Response.json(
      { error: 'unauthorized', hint: 'Envie o token via Authorization: Bearer ou x-api-key.' },
      { status: 401 },
    );
  }

  // Nunca logamos `token`: só sua impressão digital sai daqui (rate limit).
  const tenant = await resolveMcpTenant(token);
  if (!tenant) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!checkRateLimit(tokenHash(token), tenant.rateLimit)) {
    return Response.json(
      {
        error: 'rate_limited',
        hint: `Limite de ${tenant.rateLimit} chamadas por minuto excedido para este token. Aguarde um instante e tente novamente.`,
      },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const server = createRadarMcpServer(tenant.tenantId);
  // JSON em vez de SSE: uma resposta completa por requisição cabe no modelo
  // serverless (sem stream aberto além da função) e é válida no protocolo.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** GET serve só para saber se o endpoint está vivo: o protocolo viaja em POST. */
export async function GET(): Promise<Response> {
  return Response.json({
    server: 'radar-mcp',
    transport: 'streamable-http',
    enabled: Boolean(mcpToken()),
    // Tokens por tenant não exigem RADAR_MCP_TOKEN; a autorização é por token.
    tenantTokens: true,
    rateLimitWindowSeconds: 60,
    endpoint: '/api/mcp',
  });
}
