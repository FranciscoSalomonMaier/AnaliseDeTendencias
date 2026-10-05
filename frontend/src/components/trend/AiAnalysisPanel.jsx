import { useEffect, useRef, useState } from 'react';
import { getLatestAiAnalysis, generateAiAnalysis } from '../../services/aiAnalysisService';

export function AiAnalysisPanel({ onAnalysisClick, regionCode = 'BR' }) {
  const [status, setStatus] = useState('loading-latest');
  const [response, setResponse] = useState(null);
  const [message, setMessage] = useState('');
  const generating = useRef(false);

  useEffect(() => {
    let active = true;
    getLatestAiAnalysis(regionCode)
      .then((latest) => {
        if (!active) return;
        setResponse(latest);
        setStatus(latest ? 'success' : 'no-analysis');
      })
      .catch(() => {
        if (!active) return;
        setMessage('Não foi possível consultar a última análise.');
        setStatus('error');
      });
    return () => { active = false; };
  }, [regionCode]);

  async function generate(force = false) {
    if (generating.current) return;
    if (force && !window.confirm(
      'Gerar uma nova análise poderá consumir créditos da API de IA. Deseja continuar?',
    )) return;

    generating.current = true;
    setStatus('generating');
    setMessage('A análise pode levar alguns segundos.');
    try {
      const result = await generateAiAnalysis(regionCode, force);
      setResponse(result);
      setMessage(result.meta.cached
        ? 'Análise carregada do cache; nenhum novo processamento de IA foi necessário.'
        : 'Nova análise gerada com IA.');
      setStatus('success');
    } catch (error) {
      setMessage(error.message);
      setStatus('error');
    } finally {
      generating.current = false;
    }
  }

  const busy = status === 'generating';
  return (
    <section className="card-surface p-5 text-white" aria-label="Análise com IA">
      <div className="flex flex-wrap justify-between gap-3 items-center">
        <div>
          <h3 className="font-semibold">Análise de tendências com IA</h3>
          {response && <p className="text-xs text-muted-foreground">
            Gerada em {new Date(response.meta.generatedAt).toLocaleString('pt-BR')}
            {response.meta.cached ? ' · resultado armazenado' : ' · recém-gerada'}
          </p>}
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => generate(false)}
            className="rounded-xl gradient-primary px-3 py-2 text-sm disabled:opacity-50">
            {busy ? 'Gerando…' : 'Gerar análise com IA'}
          </button>
          {response && <button type="button" disabled={busy} onClick={() => generate(true)}
            className="rounded-xl border border-border px-3 py-2 text-sm disabled:opacity-50">
            Gerar nova análise
          </button>}
        </div>
      </div>

      {status === 'no-analysis' && <p className="mt-4 text-sm text-muted-foreground">
        Nenhuma análise com IA foi gerada ainda.
      </p>}
      {status === 'loading-latest' && <p className="mt-4 text-sm text-muted-foreground">Consultando última análise…</p>}
      {message && <p role={status === 'error' ? 'alert' : 'status'} className="mt-3 text-sm">
        {message}
      </p>}
      {response && <div className="mt-4 grid gap-3 md:grid-cols-2">
        {response.data.map(({ cluster, aiAnalysis }) => <button type="button" key={cluster.id}
          onClick={() => onAnalysisClick({
            source: 'ai-analysis',
            trendId: cluster.id,
            videoId: cluster.items[0]?.externalId,
            regionCode: response.meta.regionCode,
            title: aiAnalysis.refinedTopic,
            summary: aiAnalysis.summary,
            referenceTitle: cluster.topic,
            category: cluster.categories.join(', '),
            channel: [...new Set(cluster.items.map((item) => item.author))].join(', '),
            tags: cluster.keywords,
          })}
          className="rounded-xl border border-border p-4 text-left transition hover:border-violet-400/60 hover:bg-white/[0.025]">
          <h4 className="font-semibold">{aiAnalysis.refinedTopic}</h4>
          <p className="mt-2 text-sm text-muted-foreground">{aiAnalysis.summary}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {cluster.metrics.itemCount} conteúdos · relevância {cluster.relevanceScore}
          </p>
        </button>)}
      </div>}
    </section>
  );
}
