import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, PlayCircleIcon } from "@heroicons/react/24/outline";
import { listContentGenerations } from "../../services/contentGenerationService";
import { calculateSceneTimestamps, formatStudioDuration } from "../../utils/contentStudioTime";

const PAGE_SIZE = 50;

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function getReference(run) {
  const trend = run.trendSnapshot?.trend;
  const referenceVideo = run.trendSnapshot?.referenceVideo;
  const firstVideo = referenceVideo ?? trend?.items?.[0];
  return {
    title: referenceVideo?.title || trend?.topic || firstVideo?.title || "Trend sem título",
    referenceVideo,
    videos: referenceVideo ? [referenceVideo] : trend?.items ?? [],
  };
}

function groupByReference(runs) {
  const groups = new Map();
  runs.forEach((run) => {
    const videoId = run.trendSnapshot?.referenceVideo?.externalId;
    const key = videoId
      ? `${run.regionCode}:video:${videoId}`
      : `${run.regionCode}:trend:${run.trendId}`;
    const existing = groups.get(key);
    if (existing) existing.runs.push(run);
    else groups.set(key, { key, ...getReference(run), regionCode: run.regionCode, trendId: run.trendId, runs: [run] });
  });
  return [...groups.values()];
}

function SavedScript({ script }) {
  return <div className="space-y-4">
    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Roteiro</p><h4 className="mt-1 text-base font-semibold text-white">{script.title}</h4></div>
    {script.researchRequired && <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">Pesquisa adicional recomendada: {script.researchNotes.join(" ")}</div>}
    <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gancho</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{script.hook}</p></section>
    <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Introdução</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{script.introduction}</p></section>
    {script.sections.map((section, index) => <section key={`${index}-${section.title}`} className="border-l-2 border-sky-400/40 pl-3"><h5 className="text-sm font-medium text-white">{section.title}</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{section.narration}</p></section>)}
    <section><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conclusão</h5><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{script.conclusion}</p></section>
    <p className="text-xs text-muted-foreground">Duração estimada: {formatStudioDuration(script.estimatedDurationSeconds)}</p>
  </div>;
}

function SavedScenes({ videoPlan }) {
  const timestamps = calculateSceneTimestamps(videoPlan.scenes);
  const duration = videoPlan.scenes.reduce((total, scene) => total + scene.estimatedDurationSeconds, 0);
  return <div className="space-y-3">
    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Cenas</p><p className="mt-1 text-xs text-muted-foreground">{videoPlan.scenes.length} cenas · {formatStudioDuration(duration)}</p></div>
    {videoPlan.scenes.map((scene, index) => <article key={scene.order} className="rounded-xl border border-border p-3">
      <div className="flex justify-between gap-3"><h5 className="text-sm font-medium text-white">Cena {String(scene.order).padStart(2, "0")}</h5><span className="text-xs tabular-nums text-muted-foreground">{formatStudioDuration(timestamps[index].startSeconds)} — {formatStudioDuration(timestamps[index].endSeconds)}</span></div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-slate-200">{scene.narration}</p>
      <p className="mt-2 text-xs text-muted-foreground"><strong className="font-medium text-slate-300">Visual:</strong> {scene.visualDescription}</p>
      <p className="mt-2 break-words text-xs text-muted-foreground"><strong className="font-medium text-slate-300">Prompt:</strong> {scene.imagePrompt}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">{scene.estimatedDurationSeconds}s</p>
    </article>)}
  </div>;
}

export function ContentLibrary({ onNavigate }) {
  const [regionCode, setRegionCode] = useState("");
  const [query, setQuery] = useState("");
  const [runs, setRuns] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loadedRegion, setLoadedRegion] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listContentGenerations({ regionCode: regionCode || undefined, limit: PAGE_SIZE, offset: 0 })
      .then((result) => {
        if (!active) return;
        setRuns(result.items);
        setTotal(result.total);
        setSelected(null);
        setError("");
        setLoadedRegion(regionCode);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || "Não foi possível carregar a biblioteca.");
        setLoadedRegion(regionCode);
      });
    return () => { active = false; };
  }, [regionCode]);

  const loading = loadedRegion !== regionCode;

  const filteredRuns = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return runs;
    return runs.filter((run) => {
      const reference = getReference(run);
      const words = [reference.title, ...reference.videos.flatMap((video) => [video.title, video.author]), ...run.ideas.map((idea) => idea.title)];
      return words.some((word) => word?.toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [query, runs]);
  const groups = useMemo(() => groupByReference(filteredRuns), [filteredRuns]);

  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const result = await listContentGenerations({ regionCode: regionCode || undefined, limit: PAGE_SIZE, offset: runs.length });
      setRuns((current) => [...current, ...result.items]);
      setTotal(result.total);
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar mais conteúdos.");
    } finally {
      setLoadingMore(false);
    }
  }

  const selectedRun = selected ? runs.find((run) => run.generationId === selected.generationId) : null;
  const selectedIdea = selectedRun?.ideas.find((idea) => idea.ideaId === selected?.ideaId);
  const selectedScript = selectedRun && selectedRun.selectedIdea?.ideaId === selected?.ideaId ? selectedRun.script : null;
  const selectedPlan = selectedRun && selectedRun.selectedIdea?.ideaId === selected?.ideaId ? selectedRun.videoPlan : null;

  function openWorkspace(run) {
    const trend = run.trendSnapshot?.trend;
    const referenceVideo = run.trendSnapshot?.referenceVideo;
    onNavigate("content-creation", {
      source: "saved-content",
      generationId: run.generationId,
      trendId: run.trendId,
      regionCode: run.regionCode,
      videoId: referenceVideo?.externalId || trend?.items?.[0]?.externalId || "",
      referenceTitle: referenceVideo?.title || trend?.topic || trend?.items?.[0]?.title || "Trend salva",
      category: trend?.categories?.join(", ") ?? "",
      channel: referenceVideo?.author || trend?.items?.[0]?.author || "",
      tags: trend?.keywords ?? [],
    });
  }

  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 text-xs uppercase tracking-[0.2em] text-sky-300">YouTube / Conteúdos</p><h1 className="text-2xl font-semibold md:text-3xl">Ideias, roteiros e cenas</h1><p className="mt-2 text-sm text-muted-foreground">Gerações salvas, agrupadas pela trend de referência.</p></div>
        <label className="text-xs text-muted-foreground">Região
          <select value={regionCode} onChange={(event) => setRegionCode(event.target.value)} className="ml-2 h-10 rounded-xl border border-border bg-card px-3 text-sm text-white outline-none focus:border-sky-400">
            <option value="">Todas</option><option value="BR">Brasil</option><option value="US">Estados Unidos</option><option value="CA">Canadá</option><option value="MX">México</option><option value="AR">Argentina</option><option value="CO">Colômbia</option><option value="GB">Reino Unido</option><option value="DE">Alemanha</option><option value="FR">França</option><option value="PT">Portugal</option><option value="ES">Espanha</option><option value="IT">Itália</option><option value="IN">Índia</option><option value="JP">Japão</option><option value="KR">Coreia do Sul</option><option value="AU">Austrália</option>
          </select>
        </label>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <label className="relative block"><span className="sr-only">Buscar ideias e vídeos</span><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar trend, vídeo ou ideia" className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-white outline-none placeholder:text-muted-foreground focus:border-sky-400" /></label>
        <p className="self-center text-xs text-muted-foreground">{filteredRuns.length} gerações carregadas · {total} no total</p>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      {loading && <p role="status" className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Carregando conteúdos salvos…</p>}
      {!loading && runs.length === 0 && !error && <section className="rounded-2xl border border-border bg-card p-6"><p className="font-medium text-white">Ainda não há ideias salvas.</p><p className="mt-1 text-sm text-muted-foreground">Gere ideias no Estúdio de Criação para encontrá-las aqui.</p></section>}
      {!loading && runs.length > 0 && groups.length === 0 && <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Nenhum conteúdo corresponde à busca.</p>}

      {!loading && groups.length > 0 && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <div className="space-y-4">
          {groups.map((group) => <section key={group.key} className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div className="flex min-w-0 gap-3"><PlayCircleIcon className="mt-0.5 size-5 shrink-0 text-red-400" /><div className="min-w-0"><p className="text-[11px] uppercase tracking-wider text-sky-300">{group.regionCode} · {group.videos.length} vídeos relacionados</p><h2 className="mt-1 break-words font-semibold text-white">{group.title}</h2></div></div>
              <button type="button" onClick={() => openWorkspace(group.runs[0])} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs text-sky-200 hover:bg-sky-400/5">Abrir Estúdio</button>
            </div>
            {group.videos.slice(0, 3).map((video) => <p key={video.externalId} className="mt-2 truncate text-xs text-muted-foreground">{video.title}<span className="ml-2 text-slate-500">{video.author}</span></p>)}
            <div className="mt-4 space-y-4">
              {group.runs.map((run) => <div key={run.generationId} className="border-t border-border/70 pt-3 first:border-0 first:pt-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">Criado {formatDate(run.createdAt)} · atualizado {formatDate(run.updatedAt)}</p>{run.productionApproved && <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-300">Cenas aprovadas</span>}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {run.ideas.map((idea) => {
                    const active = selected?.generationId === run.generationId && selected?.ideaId === idea.ideaId;
                    const hasScript = run.selectedIdea?.ideaId === idea.ideaId && Boolean(run.script);
                    const hasScenes = hasScript && Boolean(run.videoPlan?.scenes?.length);
                    return <button key={idea.ideaId} type="button" onClick={() => setSelected({ generationId: run.generationId, ideaId: idea.ideaId })} aria-pressed={active}
                      className={`rounded-xl border p-3 text-left transition ${active ? "border-sky-400/70 bg-sky-400/5 ring-1 ring-sky-400/20" : "border-border hover:border-sky-400/40"}`}>
                      <p className="line-clamp-2 text-sm font-medium text-white">{idea.title}</p><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{idea.hook}</p>
                      <div className="mt-3 flex gap-2 text-[10px]"><span className={hasScript ? "text-emerald-300" : "text-slate-500"}>{hasScript ? "Roteiro salvo" : "Sem roteiro"}</span><span className={hasScenes ? "text-emerald-300" : "text-slate-500"}>{hasScenes ? `${run.videoPlan.scenes.length} cenas` : "Sem cenas"}</span></div>
                    </button>;
                  })}
                </div>
              </div>)}
            </div>
          </section>)}
          {runs.length < total && <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground hover:text-white disabled:opacity-50">{loadingMore ? "Carregando…" : "Carregar mais"}</button>}
        </div>

        <aside className="rounded-2xl border border-border bg-card p-4 md:p-5 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          {!selectedIdea && <div className="py-8 text-center"><p className="font-medium text-white">Selecione uma ideia</p><p className="mt-1 text-sm text-muted-foreground">O roteiro e as cenas salvos aparecerão aqui.</p></div>}
          {selectedIdea && selectedRun && <div className="space-y-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wider text-sky-300">Ideia selecionada</p><h2 className="mt-1 text-lg font-semibold text-white">{selectedIdea.title}</h2></div><button type="button" onClick={() => openWorkspace(selectedRun)} className="shrink-0 rounded-lg gradient-primary px-3 py-2 text-xs font-medium text-white">Continuar no Estúdio</button></div>
            <section className="space-y-3 border-b border-border pb-4 text-sm"><div><h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gancho</h3><p className="mt-1 leading-5 text-slate-200">{selectedIdea.hook}</p></div><div><h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Abordagem</h3><p className="mt-1 leading-5 text-slate-200">{selectedIdea.angle}</p></div><div><h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resumo</h3><p className="mt-1 leading-5 text-muted-foreground">{selectedIdea.summary}</p></div>{selectedIdea.targetAudience && <p className="text-xs text-muted-foreground">Público: {selectedIdea.targetAudience}</p>}</section>
            {!selectedScript && <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Ainda não há roteiro salvo para esta ideia.</p>}
            {selectedScript && <SavedScript script={selectedScript} />}
            {!selectedPlan && selectedScript && <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">Ainda não há cenas salvas para esta ideia.</p>}
            {selectedPlan && <SavedScenes videoPlan={selectedPlan} />}
          </div>}
        </aside>
      </div>}
    </div>
  );
}
