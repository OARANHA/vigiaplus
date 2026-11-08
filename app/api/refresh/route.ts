import { NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';
import { requireProject } from '@/lib/api-guard';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Aggiornamento on-demand dal pulsante "Refresh now": aggiornamento COMPLETO
// (ingestion + analisi + alert + storie + ratings + narrazioni + timeline + daily brief)
// ma SOLO del progetto che stai guardando — vedi il commento su runPipeline:
// aggiornarli tutti in sequenza a ogni click supera il limite di durata della
// funzione e il progetto in questione non veniva mai raggiunto. Tutti i
// progetti restano coperti dal cron notturno.
// Il digest Telegram resta escluso (solo cron) per non notificare a ogni click.
//
// Correzione P0 dell'audit: prima di questa fix, un utente senza progetti
// accessibili produceva projectId=undefined e runPipeline({full:true}) girava
// su TUTTI i progetti (incluso un cookie revogato: firma valida → nessun
// progetto → esecuzione globale). Ora requireProject({write:true}) verifica
// demo (403), autenticazione con versione della sessione sul DB (401) ed
// esistenza di un progetto accessibile (404): la pipeline riceve SEMPRE un
// projectId esplicito. L'assenza di progetto non diventa MAI un'operazione
// globale.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    const result = await runPipeline({ full: true, projectId: guard.project.id });
    return NextResponse.json(result);
  } catch (e) {
    console.error('Refresh fallito:', e);
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
