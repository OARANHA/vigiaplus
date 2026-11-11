import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { isDemoSafeRequest } from '@/lib/demo-readonly';

// Protezione dell'intera app: richiede una sessione utente valida.
// Esclusi: landing, login, /api/auth, cron (protetto da CRON_SECRET), report
// condivisi e l'endpoint MCP (protetto dal suo token, non da un cookie).
// NB: la route fantasma /tour è stata TOLTA dalle esclusioni (Incremento 2):
// non esiste nessuna pagina /tour, e tenere un bypass per una route inesistente
// è superficie d'attacco regalata a chi la creasse in futuro per sbaglio.
//
// Correzione P0 dell'audit (desacoplamento firma/revoca): QUESTO file è un
// PRE-FILTRO che verifica solo la firma HMAC del cookie — qui non si può
// aprire il database (runtime del proxy senza accesso a PGlite), quindi una
// sessione già REVOCATA (firma valida, session_version superata) passa
// comunque questo filtro. L'autenticazione vera — firma + versione della
// sessione verificata sul DB — avviene DENTRO ogni rotta protetta, via
// lib/api-guard.ts (requireProject/requireUser) o getCurrentUser: nessun
// endpoint può dipendere dal solo proxy. Le pagine passano da
// getCurrentProject → getCurrentUser, che applica la stessa regola.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // A rota verdadeira é encaminhada ao shell para não exibir sidebar em login/portal.
  const nextWithPath = () => {
    const h = new Headers(req.headers);
    h.set('x-vigia-request-path', pathname);
    // Sobrescreve valores fornecidos pelo cliente; verificação interna usa esta marca.
    h.set('x-vigia-request-method', req.method);
    return NextResponse.next({ request: { headers: h } });
  };
  // Public read-only demo: no auth gate at all.
  if (process.env.DEMO_MODE === '1') {
    // Gate global, antes de qualquer API, webhook, cron ou Server Action.
    // Métodos inesperados também falham fechados: não confiar só nas rotas.
    if (!isDemoSafeRequest(req.method, pathname)) {
      return NextResponse.json({ error: 'DEMO_READ_ONLY',
        message: 'Demonstração disponível somente para leitura' }, {
        status: 403, headers: { 'Cache-Control': 'no-store' },
      });
    }
    return nextWithPath();
  }
  if (pathname.startsWith('/landing') || pathname.startsWith('/login') || pathname.startsWith('/convite') || pathname.startsWith('/recuperar') || pathname.startsWith('/redefinir') || pathname.startsWith('/confirmar-destino')
    || pathname.startsWith('/api/auth') || pathname === '/api/notifications/channels/verify/confirm' || pathname.startsWith('/api/cron/')
    || pathname.startsWith('/api/health')
    || pathname.startsWith('/share/') || pathname.startsWith('/api/mcp')) {
    return nextWithPath();
  }
  // Verifica la firma del cookie di sessione (senza toccare il DB)
  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value) !== null) {
    return nextWithPath();
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  // Home senza login → presentazione del prodotto; pagine interne → accesso.
  url.pathname = pathname === '/' ? '/landing' : '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)'],
};
