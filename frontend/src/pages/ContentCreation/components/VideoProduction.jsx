import { useCallback, useEffect, useRef, useState } from "react";
import { videoRenders, renderMediaUrl } from "../../../services/videoRenderService";
const activeRender = job => ["QUEUED", "PREPARING", "RENDERING", "FINALIZING"].includes(job.status);
const statusLabels = { QUEUED: "Na fila", PREPARING: "Preparando arquivos", RENDERING: "Renderizando cenas", FINALIZING: "Finalizando MP4", COMPLETED: "Concluído", FAILED: "Falhou", CANCELLED: "Cancelado" };
const button = "rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-50";
function time(value) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toFixed(2).padStart(5, "0")}`; }
export function VideoProductionView({ project, preview, jobs, error, busy, loading, onGenerate, onCancel, onRefresh, audioDraftDirty = false }) {
  const active = jobs.find(activeRender), config = preview?.timeline?.config;
  return <section aria-label="Montagem do vídeo" className="space-y-4 rounded-2xl border border-border bg-card p-5">
    <h2 className="text-xl font-semibold">Montagem do vídeo</h2>
    <p className="text-sm text-muted-foreground">Confira a sequência de imagens e narrações selecionadas. Cada renderização preserva uma versão completa do vídeo.</p>
    {config && <p className="text-sm">Vídeo 16:9 · {config.width} × {config.height} · {config.fps} FPS · MP4 H.264/AAC · {config.motion ? "Movimento suave" : "Imagens estáticas"} · Transição por corte</p>}
    {loading && <p role="status">Carregando timeline e renderizações…</p>}
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {preview?.issues?.length > 0 && <div className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200"><p>Não é possível gerar o vídeo. Revise as cenas pendentes:</p><ul className="mt-2 list-disc pl-5">{preview.issues.map((issue, i) => <li key={i}>{issue.order ? `Cena ${issue.order}: ` : ""}{issue.message}</li>)}</ul></div>}
    {preview?.timeline && <details open><summary className="cursor-pointer font-medium">Timeline · Duração total: {time(preview.timeline.totalDurationSeconds)}</summary><ol className="mt-3 space-y-2">{project.scenes.slice().sort((a, b) => a.order - b.order).map(scene => {
      const item = preview.timeline.scenes.find(s => s.sceneId === scene.id);
      const issues = preview.issues.filter(i => i.sceneId === scene.id);
      return <li key={scene.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>Cena {scene.order}</strong><span>{item ? `${time(item.startSeconds)} → ${time(item.endSeconds)} · ${item.durationSeconds.toFixed(2)} s` : "Assets pendentes"}</span></div>{item && <><p className="mt-1 text-xs text-muted-foreground">Imagem selecionada ✓ · Narração selecionada ✓ · Áudio: {item.audioDurationSeconds.toFixed(2)} s</p><img src={renderMediaUrl(`/content-projects/${project.id}/assets/${item.imageAssetId}/file`)} alt={`Imagem da timeline da cena ${scene.order}`} className="mt-2 aspect-video w-32 rounded object-contain" /><audio aria-label={`Narração da timeline da cena ${scene.order}`} controls preload="none" src={renderMediaUrl(`/content-projects/${project.id}/assets/${item.audioAssetId}/file`)} className="mt-2 w-full" /></>}{issues.map((issue, i) => <p key={i} className="mt-1 text-xs text-amber-200">{issue.message}</p>)}</li>;
    })}</ol></details>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!preview?.ready || Boolean(busy) || Boolean(active) || loading || audioDraftDirty} onClick={onGenerate}>{active ? "Vídeo em processamento…" : jobs.some(j => j.status === "COMPLETED") ? "Gerar nova versão do vídeo" : "Gerar vídeo"}</button><button className={button} disabled={Boolean(busy)} onClick={onRefresh}>Atualizar timeline</button></div>
    {audioDraftDirty && <p className="text-sm text-amber-200">Salve a mixagem antes de gerar o vídeo.</p>}
    {preview?.timeline?.audioMix && <p className="text-sm text-muted-foreground">Mixagem salva: {preview.timeline.audioMix.music ? `Música ${preview.timeline.audioMix.music.originalName} · ${Math.round(preview.timeline.audioMix.settings.musicVolume * 100)}%${preview.timeline.audioMix.settings.duckingEnabled ? " · Ducking ativo" : ""}` : "Sem música"} · {preview.timeline.audioMix.effects.length} efeitos ativos.</p>}
    {active && <div role="status" className="rounded-lg border border-sky-400/30 p-4"><p>{statusLabels[active.status]} · {active.progress}%</p><progress aria-label="Progresso da renderização" value={active.progress} max="100" className="mt-2 w-full accent-sky-400" /><p className="mt-2 text-xs text-muted-foreground">Você pode fechar a página e acompanhar ao reabrir o projeto.</p><button className={`${button} mt-3`} disabled={Boolean(busy) || active.cancelRequested} onClick={() => onCancel(active.id)}>{active.cancelRequested ? "Cancelamento solicitado…" : "Cancelar renderização"}</button></div>}
    {jobs.length > 0 && <div className="space-y-4"><h3 className="font-semibold">Histórico de renderizações</h3>{jobs.map(job => <article key={job.id} className="space-y-2 rounded-lg border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{new Date(job.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {statusLabels[job.status]}</p><p className="text-xs text-muted-foreground">{time(job.snapshot.totalDurationSeconds)} · {job.snapshot.config.width} × {job.snapshot.config.height}</p></div>{job.snapshot.audioMix && <p className="text-xs text-muted-foreground">{job.snapshot.audioMix.music ? `Música: ${job.snapshot.audioMix.music.originalName}` : "Sem música"} · {job.snapshot.audioMix.effects.length} efeitos.</p>}{job.status === "COMPLETED" && <><video aria-label="Vídeo gerado" controls preload="metadata" src={renderMediaUrl(job.videoUrl)} className="aspect-video w-full rounded-lg bg-black" /><a href={renderMediaUrl(job.downloadUrl)} className={`${button} inline-block`}>Baixar MP4</a></>}{job.error && <p role="alert" className="text-sm text-red-200">{job.error}</p>}</article>)}</div>}
  </section>;
}
export function VideoProduction({ project, audioDraftDirty = false }) {
  const [preview, setPreview] = useState(null), [jobs, setJobs] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => { const [timeline, history] = await Promise.all([videoRenders.timeline(project.id), videoRenders.list(project.id)]); return { timeline, history }; }, [project.id]);
  useEffect(() => {
    let active = true, timeout;
    const poll = async () => {
      try { const { timeline, history } = await refresh(); if (active) { setPreview(timeline); setJobs(history.jobs); setError(""); } }
      catch (e) { if (active) setError(e.message); }
      finally { if (active) { setLoading(false); timeout = setTimeout(poll, 2000); } }
    };
    void poll(); return () => { active = false; clearTimeout(timeout); };
  }, [project.id, project.revision, refresh]);
  async function run(work) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError("");
    try { await work(); const { timeline, history } = await refresh(); setPreview(timeline); setJobs(history.jobs); }
    catch (e) { setError(e.message); if (e.issues?.length) setPreview(current => ({ ...current, ready: false, issues: e.issues })); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <VideoProductionView audioDraftDirty={audioDraftDirty} project={project} preview={preview} jobs={jobs} error={error} busy={busy} loading={loading}
    onGenerate={() => void run(() => videoRenders.create(project))} onCancel={id => void run(() => videoRenders.cancel(project.id, id))} onRefresh={() => void run(async () => {})} />;
}
