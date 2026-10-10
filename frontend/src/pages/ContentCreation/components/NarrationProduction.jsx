import { useCallback, useEffect, useRef, useState } from "react";
import { contentNarration, audioAssetUrl } from "../../../services/contentNarrationService";
import { emptyNarrationState, sceneNarration, missingNarrationCount, audioDurationLabel } from "../../../utils/contentNarrationState";
const button = "rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-border bg-theme p-2 text-sm";
export function NarrationProductionView({ project, state, draft, busy, loading, error, onDraft, onSave, onSample, onGenerate, onUpload, onSelect, onMissing, onRefresh }) {
  const approved = project.status === "SCENES_APPROVED" && !project.scriptStale && !project.scenesStale;
  const missing = missingNarrationCount(state, project.scenes);
  const dirty = Boolean(draft && state.settings && ["voice", "style", "speed"].some(key => draft[key] !== state.settings[key]));
  const samples = state.assets.filter(a => a.metadata?.sample);
  const sample = samples.filter(a => a.status === "READY").at(-1);
  const sampleFailure = samples.at(-1)?.status === "FAILED" ? samples.at(-1) : null;
  return <section aria-label="Produção de narração" className="space-y-4">
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-xl font-semibold">Narrações</h2>
      <p className="text-sm text-muted-foreground">As vozes geradas por IA usam o texto atual de cada cena. Novas versões preservam os áudios anteriores.</p>
      {loading && <p role="status">Carregando narrações…</p>}
      {error && <div role="alert" className="text-sm text-red-200">{error} <button className="underline" disabled={Boolean(busy)} onClick={onRefresh}>Tentar atualizar</button></div>}
      {draft && <><h3 className="font-medium">Configurações de narração</h3><div className="grid gap-3 sm:grid-cols-3">
        <label>Voz · OpenAI<select aria-label="Voz do projeto" className={input} value={draft.voice} disabled={Boolean(busy)} onChange={e => onDraft({ ...draft, voice: e.target.value })}>{state.voices.map(voice => <option key={voice} value={voice}>{voice.charAt(0).toUpperCase() + voice.slice(1)}</option>)}</select></label>
        <label>Estilo<select aria-label="Estilo da narração" className={input} value={draft.style} disabled={Boolean(busy)} onChange={e => onDraft({ ...draft, style: e.target.value })}>{state.styles.map(style => <option key={style} value={style}>{style === "DARK" ? "Dark · Misterioso" : "Narrativo"}</option>)}</select></label>
        <label>Velocidade · {draft.speed}×<input aria-label="Velocidade da narração" type="number" min="0.25" max="4" step="0.05" className={input} value={draft.speed} disabled={Boolean(busy)} onChange={e => onDraft({ ...draft, speed: Number(e.target.value) })} /></label>
      </div><div className="flex flex-wrap gap-2"><button className={button} disabled={Boolean(busy) || !dirty} onClick={onSave}>Salvar configurações</button><button className={button} disabled={Boolean(busy) || dirty || state.sampleBusy} onClick={onSample}>{state.sampleBusy ? "Gerando amostra…" : "Ouvir amostra · usa créditos"}</button></div>
      {dirty && <p className="text-sm text-amber-200">Salve as configurações antes de gerar. Alterar a voz não regenera áudios automaticamente.</p>}</>}
      {sample && <div><p className="text-sm">Amostra · {sample.voice} · {audioDurationLabel(sample.durationSeconds)} · Voz gerada por IA</p><audio key={sample.id} aria-label="Amostra de voz" controls preload="metadata" src={audioAssetUrl(sample)} className="mt-2 w-full" /></div>}
      {sampleFailure && <p role="alert" className="text-sm text-red-200">Amostra: {sampleFailure.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p role="status">{state.readyCount} / {project.scenes.length} narrações prontas{state.busyCount ? ` · ${state.busyCount} em processamento` : ""}</p><button className={button} disabled={!approved || Boolean(busy) || loading || dirty || !missing} onClick={onMissing}>Gerar narrações faltantes ({missing})</button></div>
      <progress aria-label="Progresso das narrações" value={state.readyCount} max={project.scenes.length || 1} className="h-3 w-full accent-sky-400" />
      {!approved && <p className="text-sm text-amber-200">Aprove as cenas atuais antes de gerar ou selecionar narrações.</p>}
      <p className="text-xs text-muted-foreground">Música, montagem e renderização: Em breve.</p>
    </div>
    {project.scenes.map(scene => {
      const audio = sceneNarration(state, scene);
      return <article key={scene.id} className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h3 className="font-semibold">Cena {scene.order} · Narração</h3><p className="whitespace-pre-wrap text-sm">{scene.narration}</p>
        <p className="text-xs text-muted-foreground">Duração estimada: {audioDurationLabel(scene.estimatedDurationSeconds)} · Duração real: {audioDurationLabel(audio.selected?.durationSeconds)}</p>
        {audio.selected && <div><p className="text-sm">{audio.selected.source === "USER_UPLOAD" ? "Áudio enviado" : `Voz gerada por IA · ${audio.selected.voice}`}</p><audio key={audio.selected.id} aria-label={`Narração selecionada da cena ${scene.order}`} controls preload="metadata" src={audioAssetUrl(audio.selected)} className="mt-2 w-full" /></div>}
        {audio.outdated && <div className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">{audio.textOutdated ? "O áudio selecionado corresponde a uma versão anterior do texto. " : "O áudio foi gerado com outra voz ou configuração. "}{audio.accepted ? "Mantido por você para esta versão da cena." : <button className="underline" disabled={!approved || Boolean(busy)} onClick={() => onSelect(scene.id, audio.selected.id)}>Manter áudio</button>}</div>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!approved || Boolean(busy) || loading || dirty || audio.pending || !scene.narration.trim()} onClick={() => onGenerate(scene.id)}>{audio.pending ? "Gerando narração…" : audio.selected || audio.assets.some(a => a.source === "AI_GENERATED") ? "Regenerar narração" : "Gerar narração"}</button>
          <label className={`${button} cursor-pointer`}>Enviar áudio<input aria-label={`Enviar áudio na cena ${scene.order}`} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" disabled={!approved || Boolean(busy) || loading} className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(scene.id, file); e.target.value = ""; }} /></label></div>
        <p className="text-xs text-muted-foreground">MP3 ou WAV PCM · Até 20 MB e 10 minutos. A duração é validada no servidor.</p>
        {audio.pending && <p role="status" className="text-sm text-sky-200">Narração em processamento. Você pode fechar e reabrir o projeto.</p>}
        {audio.failed && <div role="alert" className="text-sm text-red-200">{audio.failed.error} <button className="underline" disabled={!approved || Boolean(busy) || dirty || audio.pending} onClick={() => onGenerate(scene.id)}>Tentar novamente</button></div>}
        {audio.assets.some(a => a.status === "READY") && <details><summary className="cursor-pointer text-sm text-sky-200">Ver versões de áudio</summary><div className="mt-3 space-y-3">{audio.assets.filter(a => a.status === "READY").map(asset => <div key={asset.id} className="rounded-lg border border-border p-3"><p className="text-xs">{asset.source === "USER_UPLOAD" ? "Upload próprio" : `Voz gerada por IA · ${asset.voice}`} · {audioDurationLabel(asset.durationSeconds)}</p><audio aria-label={`Versão de narração ${asset.id}`} controls preload="none" src={audioAssetUrl(asset)} className="mt-2 w-full" /><button className="mt-2 text-sm text-sky-200 disabled:opacity-50" aria-pressed={audio.selected?.id === asset.id} disabled={!approved || Boolean(busy)} onClick={() => onSelect(scene.id, asset.id)}>{audio.selected?.id === asset.id ? "Selecionada" : "Usar este áudio"}</button></div>)}</div></details>}
      </article>;
    })}
  </section>;
}
export function NarrationProduction({ project, onProjectChange }) {
  const [state, setState] = useState(emptyNarrationState), [draft, setDraft] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const inFlight = useRef(false), currentId = useRef(project.id);
  const acceptState = useCallback(result => { setState(result); }, []);
  const refresh = useCallback(async () => { const result = await contentNarration.list(project.id); if (currentId.current === project.id) acceptState(result); }, [project.id, acceptState]);
  useEffect(() => {
    let active = true; currentId.current = project.id;
    contentNarration.list(project.id).then(result => { if (active) { acceptState(result); setDraft({ voice: result.settings.voice, style: result.settings.style, speed: result.settings.speed }); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; currentId.current = null; };
  }, [project.id, project.revision, acceptState]);
  useEffect(() => {
    if (!state.busyCount && !state.sampleBusy) return;
    let active = true, timeout;
    const poll = async () => { try { const result = await contentNarration.list(project.id); if (active) acceptState(result); } catch (e) { if (active) setError(e.message); } if (active) timeout = setTimeout(poll, 2000); };
    timeout = setTimeout(poll, 1000); return () => { active = false; clearTimeout(timeout); };
  }, [project.id, state.busyCount, state.sampleBusy, acceptState]);
  async function run(label, work) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError("");
    try { const result = await work(); if (currentId.current !== project.id) return; if (result?.assets) acceptState(result); else await refresh(); }
    catch (e) { if (currentId.current === project.id) setError(e.message); }
    finally { inFlight.current = false; setBusy(""); }
  }
  return <NarrationProductionView project={project} state={state} draft={draft} busy={busy} error={error} loading={loading} onDraft={setDraft}
    onSave={() => void run("settings", async () => { const saved = await contentNarration.settings(project, draft); onProjectChange(saved); })}
    onSample={() => { if (window.confirm("Gerar uma amostra com a voz salva? Esta ação consome créditos da OpenAI.")) void run("sample", () => contentNarration.sample(project)); }}
    onGenerate={id => void run(id, () => contentNarration.generate(project, id))}
    onUpload={(id, file) => void run(id, () => contentNarration.upload(project, id, file))}
    onSelect={(id, assetId) => void run(id, () => contentNarration.select(project, id, assetId))}
    onRefresh={() => void run("refresh", refresh)}
    onMissing={() => { const count = missingNarrationCount(state, project.scenes); if (count && window.confirm(`Gerar narração para ${count} cenas? Esta ação consome créditos da OpenAI.`)) void run("batch", () => contentNarration.missing(project)); }} />;
}
