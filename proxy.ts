import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

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
  // Public read-only demo: no auth gate at all.
  if (process.env.DEMO_MODE === '1') {
    // Server Actions also accept progressive multipart form submissions without
    // a Next-Action header. Block all page POSTs, not just API mutations.
    if (req.method === 'POST' && !pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'demo mode: read-only' }, { status: 403 });
    }
    return NextResponse.next();
  }
  if (pathname.startsWith('/landing') || pathname.startsWith('/login')
    || pathname.startsWith('/api/auth') || pathname.startsWith('/api/cron/')
    || pathname.startsWith('/share/') || pathname.startsWith('/api/mcp')) {
    return NextResponse.next();
  }
  // Verifica la firma del cookie di sessione (senza toccare il DB)
  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value) !== null) {
    return NextResponse.next();
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
