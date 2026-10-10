import { TopicCard } from "./TopicCard";
import { useEffect, useState } from "react";
import { ArrowPathIcon, FireIcon } from "@heroicons/react/24/outline";
import { getTrendingTopics } from "../../services/trendingTopicsService";
import { youtubePeriods } from "../../utils/youtubeHistory";

export function TrendingTopics({ onNavigate }) {
  const [period, setPeriod] = useState("today");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getTrendingTopics({ period, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((failure) => {
        if (!controller.signal.aborted && failure.name !== "AbortError") setError("Não foi possível carregar os temas em alta.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, reload]);

  function retry() {
    setLoading(true);
    setError("");
    setReload((value) => value + 1);
  }
  const topics = result?.topics ?? [];
  const shownPeriod = result?.period ?? period;

  return <div className="min-h-screen bg-theme p-4 text-white md:p-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold md:text-3xl"><FireIcon className="size-7 shrink-0 text-orange-400" /> Temas em Alta</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Descubra quais assuntos estão concentrando maior crescimento de audiência.</p>
      </div>
      <button type="button" onClick={retry} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground disabled:opacity-50">
        <ArrowPathIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
      </button>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Período dos temas">
      <span className="mr-2 text-sm text-muted-foreground">Período</span>
      {Object.entries(youtubePeriods).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value}
        onClick={() => { if (period !== value) { setLoading(true); setError(""); setPeriod(value); } }}
        className={`rounded-xl border px-4 py-2 text-sm ${period === value ? "border-sky-400 bg-sky-400/15 text-sky-200" : "border-border text-muted-foreground"}`}>{label}</button>)}
    </div>
    <p className="mb-4 text-xs text-muted-foreground">Brasil · Vídeos acompanhados pelo projeto · Coleta horária · Hoje considera o horário de Brasília.</p>
    <div role="status" aria-live="polite" className="mb-4 text-sm text-muted-foreground">
      {loading ? `Carregando temas: ${youtubePeriods[period]}…` : !error && `Ranking exibido: ${youtubePeriods[shownPeriod]} · ${topics.length} temas`}
      {(loading || error) && result && <p className="mt-1 text-xs">Mantendo o último resultado: {youtubePeriods[shownPeriod]}.</p>}
    </div>
    {error && <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-400/30 p-4 text-sm text-red-300">
      <span>{error}</span><button type="button" onClick={retry} className="rounded-lg border border-red-300/30 px-3 py-2">Tentar novamente</button>
    </div>}
    {!loading && !error && topics.length === 0 && <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Nenhum tema identificado para este período.</p>}
    {topics.some((topic) => !topic.hasFullPeriodData) && <p className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">
      Dados parciais: o crescimento considera somente o histórico observado de cada vídeo. Períodos maiores que o histórico podem mostrar o mesmo ranking; temas com coberturas diferentes não são diretamente comparáveis.
    </p>}
    <div aria-busy={loading} className="grid min-w-0 gap-4 xl:grid-cols-2">
      {topics.map((topic, index) => <TopicCard key={topic.id} topic={topic} index={index} shownPeriod={shownPeriod} onCreate={() => onNavigate("content-creation", { source: "topic", topicId: topic.id, title: topic.name })} />)}
    </div>
  </div>;
}
