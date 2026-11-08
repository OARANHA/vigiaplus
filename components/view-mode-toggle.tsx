'use client';
import { useState, useEffect } from 'react';

// Toggle de modo de visualizacao (ADR-03):
// - Densidade: basico (menos info, mais legivel) vs avancado (mais detalhes)
// - Vocabulario: leigo (termos do dia a dia) vs tecnico (jargao de especialista)
// NENHUM dos dois afeta permissoes. Sao puramente cosméticos.
export function ViewModeToggle({ compact = false }: { compact?: boolean }) {
  const [density, setDensity] = useState<'basico' | 'avancado'>('basico');
  const [vocabulary, setVocabulary] = useState<'leigo' | 'tecnico'>('leigo');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/me/preferences')
      .then((r) => r.json())
      .then((d) => {
        if (d.density) setDensity(d.density);
        if (d.vocabulary) setVocabulary(d.vocabulary);
      })
      .catch(() => {});
  }, []);

  async function update(patch: Partial<{ density: string; vocabulary: string }>) {
    setLoading(true);
    try {
      await fetch('/api/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // Recarregar para refletir a mudanca em todo o SSR
      window.location.reload();
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => update({ density: density === 'basico' ? 'avancado' : 'basico' })}
          disabled={loading}
          className="rounded-md border px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
          title="Alternar densidade"
        >
          {density === 'basico' ? 'Simples' : 'Avancado'}
        </button>
        <button
          onClick={() => update({ vocabulary: vocabulary === 'leigo' ? 'tecnico' : 'leigo' })}
          disabled={loading}
          className="rounded-md border px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
          title="Alternar vocabulario"
        >
          {vocabulary === 'leigo' ? 'Leigo' : 'Tecnico'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Densidade</p>
        <div className="flex gap-1">
          {(['basico', 'avancado'] as const).map((d) => (
            <button
              key={d}
              onClick={() => update({ density: d })}
              disabled={loading || density === d}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                density === d
                  ? 'bg-blue-600 text-white'
                  : 'border text-gray-600 hover:bg-gray-100'
              }`}
            >
              {d === 'basico' ? 'Basico (menos info, mais legivel)' : 'Avancado (mais detalhes)'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">Vocabulario</p>
        <div className="flex gap-1">
          {(['leigo', 'tecnico'] as const).map((v) => (
            <button
              key={v}
              onClick={() => update({ vocabulary: v })}
              disabled={loading || vocabulary === v}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                vocabulary === v
                  ? 'bg-blue-600 text-white'
                  : 'border text-gray-600 hover:bg-gray-100'
              }`}
            >
              {v === 'leigo' ? 'Leigo (linguagem do dia a dia)' : 'Tecnico (jargao de especialista)'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
