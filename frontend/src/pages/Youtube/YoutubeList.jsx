import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlassIcon, PlayCircleIcon, ArrowPathIcon, DocumentPlusIcon } from "@heroicons/react/24/outline";
import { getAnalyzedVideos, getGroupedYoutubeTrends, getPopularVideos } from "../../services/youtubeService";
import { describeRankingHistory, formatHistoryDuration, youtubePeriods } from "../../utils/youtubeHistory";
import { AiAnalysisPanel } from "../../components/trend/AiAnalysisPanel";

const compactNumber = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatViews(value) {
  const number = Number(value);
  return Number.isFinite(number) ? compactNumber.format(number) : "0";
}

function getTrendStatus(trendScore) {
  if (!Number.isFinite(Number(trendScore))) return null;
  if (trendScore >= 70) return { label: "Em alta", classes: "bg-emerald-500/15 text-emerald-300" };
  if (trendScore >= 40) return { label: "Crescendo", classes: "bg-sky-500/15 text-sky-300" };
  return { label: "Estável", classes: "bg-slate-500/15 text-slate-300" };
}

export function YoutubeList({ onNavigate }) {
  const [period, setPeriod] = useState("today");
  const [loadedPeriod, setLoadedPeriod] = useState("today");
  const [reload, setReload] = useState(0);
  const [videos, setVideos] = useState([]);
  const [analyzedVideos, setAnalyzedVideos] = useState([]);
  const [topicClusters, setTopicClusters] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Todas");
  const [regionCode, setRegionCode] = useState("BR");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function loadVideos() { setReload((value) => value + 1); }

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) { setLoading(true); setError(""); }
    });
    getPopularVideos(regionCode, period, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setVideos(result);
        setLoadedPeriod(period);
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") setError("Não foi possível carregar o ranking do YouTube.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [regionCode, period, reload]);

  useEffect(() => {
    getAnalyzedVideos(regionCode)
      .then(setAnalyzedVideos)
      .catch((loadError) => {
        console.error(loadError);
        setAnalyzedVideos([]);
      });

    getGroupedYoutubeTrends(regionCode)
      .then(setTopicClusters)
      .catch((loadError) => {
        console.error(loadError);
        setTopicClusters([]);
      });
  }, [regionCode]);

  const analyzedByVideoId = useMemo(() => new Map(
    analyzedVideos.map((video) => [video.externalId, video]),
  ), [analyzedVideos]);

  const clusterByVideoId = useMemo(() => {
    const clusters = new Map();
    topicClusters.forEach((cluster) => {
      cluster.items.forEach((item) => clusters.set(item.externalId, cluster));
    });
    return clusters;
  }, [topicClusters]);

  const categories = useMemo(() => [
    "Todas",
    ...new Set(videos.map((video) => video.categoryTitle).filter(Boolean)),
  ], [videos]);

  const filteredVideos = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    return videos.filter((video) => {
      const title = video.snippet?.title?.toLocaleLowerCase("pt-BR") ?? "";
      const channel = video.snippet?.channelTitle?.toLocaleLowerCase("pt-BR") ?? "";
      const matchesSearch = !normalizedSearch || title.includes(normalizedSearch) || channel.includes(normalizedSearch);
      const matchesCategory = category === "Todas" || video.categoryTitle === category;
      return matchesSearch && matchesCategory;
    });
  }, [category, search, videos]);

  function openCreationInNewTab(video, trendId) {
    const params = new URLSearchParams({
      page: "content-creation",
      source: "youtube-video",
      trendId,
      videoId: video.id,
      regionCode,
      referenceTitle: video.snippet?.title ?? "",
      category: video.categoryTitle ?? "",
      channel: video.snippet?.channelTitle ?? "",
    });
    (video.snippet?.tags ?? []).forEach((tag) => params.append("tag", tag));
    const url = new URL(window.location.href);
    url.search = params.toString();
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-sky-300">YouTube / Listar</p>
          <h1 className="text-2xl font-semibold md:text-3xl">Top 50 do YouTube</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Vídeos acompanhados pelo projeto, ordenados pelas visualizações ganhas no período.
          </p>
        </div>
        <button type="button" onClick={loadVideos} disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-white disabled:opacity-50">
          <ArrowPathIcon className={`size-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Período do ranking">
        <span className="mr-2 text-sm text-muted-foreground">Período</span>
        {Object.entries(youtubePeriods).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => {
              if (value === period) return;
              setLoading(true);
              setError("");
              setPeriod(value);
            }}
            className={`rounded-xl border px-4 py-2 text-sm ${period === value ? "border-sky-400 bg-sky-400/15 text-sky-200" : "border-border text-muted-foreground"}`}>{label}</button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">Coleta horária. Históricos parciais podem não ser diretamente comparáveis. Hoje considera o horário de Brasília.</p>
      <section className="mb-4 rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
          <label className="relative block">
            <span className="sr-only">Filtrar por nome</span>
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título ou canal"
              className="h-10 w-full rounded-xl border border-border bg-theme pl-9 pr-3 text-sm text-white outline-none placeholder:text-muted-foreground focus:border-sky-400" />
          </label>
          <label>
            <span className="sr-only">Filtrar por tema</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-theme px-3 text-sm text-white outline-none focus:border-sky-400">
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Região do YouTube</span>
            <select value={regionCode} onChange={(event) => {
              setRegionCode(event.target.value);
              setCategory("Todas");
            }}
              className="h-10 w-full rounded-xl border border-border bg-theme px-3 text-sm text-white outline-none focus:border-sky-400">
              <option value="BR">Brasil</option>
              <option value="US">Estados Unidos</option>
              <option value="CA">Canadá</option>
              <option value="MX">México</option>
              <option value="AR">Argentina</option>
              <option value="CO">Colômbia</option>
              <option value="GB">Reino Unido</option>
              <option value="DE">Alemanha</option>
              <option value="FR">França</option>
              <option value="PT">Portugal</option>
              <option value="ES">Espanha</option>
              <option value="IT">Itália</option>
              <option value="IN">Índia</option>
              <option value="JP">Japão</option>
              <option value="KR">Coreia do Sul</option>
              <option value="AU">Austrália</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{filteredVideos.length} de {videos.length} vídeos</p>
      </section>

      <section aria-busy={loading} className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4" role="status" aria-live="polite">
          <p className="text-sm font-medium text-sky-200">
            {loading ? `Atualizando ranking: ${youtubePeriods[period]}…` : `Ranking exibido: ${youtubePeriods[loadedPeriod]}`}
          </p>
          {!loading && !error && <p className="mt-1 text-xs text-muted-foreground">{describeRankingHistory(videos)}</p>}
          {(loading || error) && videos.length > 0 && <p className="mt-1 text-xs text-muted-foreground">A lista abaixo mantém o último resultado carregado: {youtubePeriods[loadedPeriod]}.</p>}
        </div>
        {loading && <p className="p-6 text-sm text-muted-foreground">Carregando top 50 do YouTube…</p>}
        {error && <div className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm text-red-300"><span>{error}</span><button type="button" onClick={loadVideos} className="rounded-lg border border-red-300/30 px-3 py-2">Tentar novamente</button></div>}
        {!loading && !error && filteredVideos.length === 0 && <p className="p-6 text-sm text-muted-foreground">Nenhum vídeo corresponde aos filtros.</p>}
        {filteredVideos.length > 0 && <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-border bg-white/[0.02] text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Vídeo</th><th className="px-5 py-3">Tema</th><th className="px-5 py-3">Visualizações</th><th className="px-5 py-3">Publicado</th><th className="px-5 py-3">Velocidade</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Ação</th></tr>
            </thead>
            <tbody>
              {filteredVideos.map((video) => {
                const index = videos.indexOf(video) + 1;
                const analyzedVideo = analyzedByVideoId.get(video.id);
                const cluster = clusterByVideoId.get(video.id);
                const trendStatus = getTrendStatus(analyzedVideo?.calculatedMetrics?.trendScore);
                return <tr key={video.id} className="border-b border-border/60 last:border-0 hover:bg-white/[0.025]">
                  <td className="px-5 py-4 font-semibold text-sky-300">{index}</td>
                  <td className="max-w-[420px] px-5 py-4"><a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-sky-300">
                    {video.snippet?.thumbnails?.high?.url ? <img src={video.snippet.thumbnails.high.url} alt="" className="h-12 w-20 rounded-lg object-cover" /> : <PlayCircleIcon className="size-8 shrink-0 text-red-400" />}
                    <span><strong className="block font-medium text-white">{video.snippet?.title ?? "Sem título"}</strong><small className="text-muted-foreground">{video.snippet?.channelTitle ?? "Canal desconhecido"}</small></span>
                  </a></td>
                  <td className="px-5 py-4 text-muted-foreground">{video.categoryTitle ?? "Sem categoria"}</td>
                  <td className="px-5 py-4 text-white">
                    <span className="block">{formatViews(video.currentViews)} totais</span>
                    <span className="block text-emerald-300">+{formatViews(video.viewsInPeriod)} / {({ today: "hoje", "7d": "7 dias", "30d": "30 dias", "1y": "1 ano" })[loadedPeriod]}</span>
                    {!video.hasFullPeriodData && <small className="block text-amber-200" title="Crescimento apenas no intervalo observado. Históricos diferentes não são diretamente comparáveis.">Dados parciais · {formatHistoryDuration(video.actualHistorySeconds)} de histórico</small>}
                    <small className="block text-muted-foreground">Coleta: {new Date(video.capturedAt).toLocaleString("pt-BR")}</small>
                  </td>
                  <td className="px-5 py-4 text-xs text-muted-foreground">{video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-emerald-300">
                    {analyzedVideo ? `+${formatViews(analyzedVideo.calculatedMetrics?.viewsPerHour)}/h` : "—"}
                  </td>
                  <td className="px-5 py-4">
                    {trendStatus ? <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${trendStatus.classes}`}>{trendStatus.label}</span> : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <button type="button" disabled={!cluster} onClick={() => openCreationInNewTab(video, cluster.id)}
                      aria-label={`Criar conteúdo a partir de ${video.snippet?.title ?? "vídeo"}`}
                      title={!cluster ? "Este vídeo não está associado a uma trend analisável." : undefined}
                      className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-xs font-medium text-sky-200 transition hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-40">
                      <DocumentPlusIcon className="size-4" /> Criar
                    </button>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      </section>

      <div className="mt-4"><AiAnalysisPanel regionCode={regionCode} onAnalysisClick={(analysis) => onNavigate("content-creation", analysis)} /></div>
    </div>
  );
}
