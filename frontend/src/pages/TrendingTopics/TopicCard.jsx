import { SparklesIcon } from "@heroicons/react/24/outline";
import { formatHistoryDuration, youtubePeriods } from "../../utils/youtubeHistory";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
function formatViews(value) { return compact.format(BigInt(value ?? "0")); }

export function TopicCard({ topic, index, shownPeriod, onCreate }) {
  return <article className="min-w-0 rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="mb-1 text-sm font-semibold text-sky-300">#{index + 1}</p><h2 className="break-words text-xl font-semibold">{topic.name}</h2></div>
          {!topic.hasFullPeriodData && <span title="Todos os vídeos precisam cobrir o período para que o tema tenha histórico completo." className="shrink-0 rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-200">Dados parciais</span>}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{topic.videoCount} vídeos relacionados</p>
        <p className="mt-4 text-3xl font-semibold text-emerald-300">+{formatViews(topic.viewsInPeriod)} <span className="text-sm font-normal">visualizações</span></p>
        <p className="text-xs text-muted-foreground">{topic.hasFullPeriodData ? youtubePeriods[shownPeriod] : `Crescimento observado · período solicitado: ${youtubePeriods[shownPeriod]}`}</p>
        <p className="mt-3 text-sm text-muted-foreground">Views totais: <strong className="font-medium text-white">{formatViews(topic.totalViews)}</strong></p>
        <p className="mt-1 text-xs text-muted-foreground">Histórico mínimo entre vídeos: {formatHistoryDuration(topic.actualHistorySeconds)}</p>
        <p className="mt-1 text-xs text-muted-foreground">Coleta mais antiga: {new Date(topic.capturedAt).toLocaleString("pt-BR")}</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Principais termos">{topic.keywords.slice(0, 5).map((keyword) => <span key={keyword} className="max-w-full break-words rounded-full bg-sky-400/10 px-3 py-1 text-xs text-sky-200">{keyword}</span>)}</div>
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm text-sky-200">Ver vídeos · {topic.topVideos.length} principais de {topic.videoCount}</summary>
          <ul className="mt-3 space-y-3">{topic.topVideos.map((video) => <li key={video.id}>
            <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-3 rounded-xl p-2 hover:bg-white/5">
              {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" className="h-12 w-20 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{video.title}</p><p className="break-words text-xs text-muted-foreground">{video.channelTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatViews(video.currentViews)} totais · <span className="text-emerald-300">+{formatViews(video.viewsInPeriod)} observadas</span></p>
                {!video.hasFullPeriodData && <p className="text-xs text-amber-200">Dados parciais · {formatHistoryDuration(video.actualHistorySeconds)}</p>}
              </div>
            </a>
          </li>)}</ul>
          {topic.videoCount > topic.topVideos.length && <p className="mt-2 text-xs text-muted-foreground">A prévia mostra os cinco vídeos com maior crescimento. As métricas incluem todos os {topic.videoCount} vídeos.</p>}
        </details>
        <button type="button" onClick={onCreate} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-400/30 px-3 py-2 text-xs text-sky-200 hover:bg-sky-400/10"><SparklesIcon className="size-4" /> Criar conteúdo</button>
      </article>;
}
