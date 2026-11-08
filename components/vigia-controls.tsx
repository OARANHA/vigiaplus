'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = { projectId?: number; canWrite: boolean };

export function VigiaControls({ projectId, canWrite }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function execute() {
    if (!canWrite || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(projectId ? '/api/vigia/collect' : '/api/vigia/pilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: projectId ? JSON.stringify({ projectId }) : '{}',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha na operação');
      setMessage(projectId
        ? 'Execução #' + data.runId + ' — ' + data.status + '; ' + data.newCount + ' novas menções'
        : 'Piloto configurado: projeto #' + data.projectId);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha não identificada');
    } finally {
      setBusy(false);
    }
  }
  if (!canWrite) return <p className="text-sm text-amber-300">Visualização somente leitura.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={execute} disabled={busy}
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Executando…' : projectId ? 'Executar coleta manual' : 'Criar projeto CRF-RS'}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-slate-300">{message}</span>
    </div>
  );
}
