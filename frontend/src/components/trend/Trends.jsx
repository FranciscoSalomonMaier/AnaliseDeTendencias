import { useEffect, useState } from "react";
import { getAnalyzedVideos } from "../../services/youtubeService";
import { SparklesIcon } from "@heroicons/react/24/outline";

const compactNumber = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? compactNumber.format(number) : "0";
}

function formatScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "0,0";
}

function formatUpdatedAt(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(timestamp).toLocaleDateString("pt-BR");
}

function getStatus(metrics) {
  if (metrics.trendScore >= 70) {
    return { label: "Em alta", classes: "bg-emerald-500/15 text-emerald-300" };
  }
  if (metrics.trendScore >= 40) {
    return { label: "Crescendo", classes: "bg-sky-500/15 text-sky-300" };
  }
  return { label: "Estável", classes: "bg-slate-500/15 text-slate-300" };
}

export const Trends = () => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadVideos() {
      try {
        const data = await getAnalyzedVideos();
        setVideos(data);
      } catch (error) {
        console.error(error);
        setError("Não foi possível carregar as tendências.");
      } finally {
        setLoading(false);
      }
    }
    loadVideos();
  }, []);

  if (loading) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        Carregando tendências…
      </p>
    );
  }

  if (error) {
    return <p className="p-5 text-sm text-red-300">{error}</p>;
  }

  return (
    <div className="card-surface">
      <div className="inline-flex gap-2 px-5 py-3 w-full">
        <div className="grid rounded-2xl gradient-primary h-9 w-9 place-items-center">
          <SparklesIcon className="w-6 h-6 text-white text-center" />
        </div>
        <div className="flex justify-between w-full">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-white">
              Tendências do momento
            </h3>
            <div className="text-[11px] text-muted-foreground">
              {videos.length} resultados · ordenados pelo score de tendência
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Live
          </div>
        </div>
      </div>
      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="sticky top-0 z-10 bg-card border-top-2 border-bottom-2 border-muted-foreground">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-5 py-3 font-medium">#</th>
              <th className="px-5 py-3 font-medium">TENDÊNCIA</th>
              <th className="px-5 py-3 font-medium">CATEGORIA</th>
              <th className="px-5 py-3 font-medium">PLATAFORMA</th>
              <th className="px-5 py-3 font-medium">SCORE</th>
              <th className="px-5 py-3 font-medium">VIEWS</th>
              <th className="px-5 py-3 font-medium">VELOCIDADE</th>
              <th className="px-5 py-3 font-medium">STATUS</th>
              <th className="px-5 py-3 font-medium">ATUALIZADO</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video, index) => {
              const status = getStatus(video.calculatedMetrics);
              return (
                <tr
                  key={video.externalId}
                  className="border-b border-border/60 last:border-b-0 hover:bg-white/[0.025]"
                >
                  <td className="px-5 py-3">
                    {index + 1 <= 3 && (
                      <div className="grid rounded-xl gradient-primary font-bold text-white h-7 w-7 place-items-center">
                        {index + 1}
                      </div>
                    )}
                    {index + 1 > 3 && (
                      <div className="grid rounded-xl bg-card-elevated text-muted-foreground font-bold  h-7 w-7 place-items-center">
                        {index + 1}
                      </div>
                    )}
                  </td>
                  <td className="w-56 max-w-56 px-5 py-3 text-white font-semibold whitespace-normal break-words">
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-blue-300"
                    >
                      {video.title || "Sem título"}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {video.category || "Sem categoria"}
                  </td>
                  <td className="px-5 py-3">
                    <div className="inline-flex items-center gap-2 text-xs text-white">
                      {video.source}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-semibold text-violet-300">
                    {formatScore(video.calculatedMetrics.trendScore)}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {formatNumber(video.metrics.views)}
                  </td>
                  <td className="px-5 py-3 text-emerald-300">
                    +{formatNumber(video.calculatedMetrics.viewsPerHour)}/h
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${status.classes}`}
                    >
                      {status.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatUpdatedAt(video.collectedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
