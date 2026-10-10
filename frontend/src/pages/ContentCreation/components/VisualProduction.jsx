import { NarrationProduction } from "./NarrationProduction";
import { useCallback, useEffect, useRef, useState } from "react";
import { contentAssets, assetImageUrl } from "../../../services/contentAssetService";
import { emptyVisualState, missingVisualCount, requiredReferencesMissing, sceneVisual } from "../../../utils/contentVisualState";
import { calculateSceneTimestamps, formatStudioDuration } from "../../../utils/contentStudioTime";

const button = "rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-50";
export function VisualProductionView({ project, state, busy, error, loading, onGenerate, onUpload, onSelect, onMissing, onRefresh, onBack }) {
  const timestamps = calculateSceneTimestamps(project.scenes);
  const missing = missingVisualCount(state, project.scenes);
  const required = requiredReferencesMissing(state);
  const approved = project.status === "SCENES_APPROVED" && !project.scenesStale && !project.scriptStale;
  return <section className="space-y-5">
    <div><p className="text-xs uppercase tracking-widest text-sky-300">Produção</p><h2 className="mt-1 text-xl font-semibold">Imagens das cenas</h2><p className="mt-2 text-sm text-muted-foreground">Gere imagens ou use seus arquivos. Cada nova geração preserva as variações anteriores.</p></div>
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-3"><p role="status" className="font-medium">{state.readyCount} / {project.scenes.length} prontas{state.busyCount > 0 ? ` · ${state.busyCount} em processamento` : ""}</p><button className={button} disabled={!approved || Boolean(busy) || loading || !missing} onClick={onMissing}>Gerar imagens faltantes ({missing})</button></div>
      <progress aria-label="Progresso das imagens" max={project.scenes.length || 1} value={state.readyCount} className="mt-4 h-3 w-full accent-sky-400" />
      <p className="mt-2 text-xs text-muted-foreground">Geração somente por ação explícita. Formato 16:9. Música, montagem e renderização: Em breve.</p>
    </div>
    {!approved && <p className="rounded-xl border border-amber-400/30 p-3 text-amber-200">Aprove as cenas atuais para gerar ou selecionar imagens. Os assets anteriores continuam disponíveis.</p>}
    {required.length > 0 && <p className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">{required.length} imagem(ns) obrigatória(s) ainda sem uso em uma cena. Selecione-as nas variações.</p>}
    {loading && <p role="status">Carregando imagens…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-400/30 p-3 text-red-200">{error} <button onClick={onRefresh} disabled={Boolean(busy)} className="underline">Tentar atualizar</button></div>}
    {project.scenes.map((scene, index) => {
      const v = sceneVisual(state,scene);
      const available = state.assets.filter(a => a.status === "READY" && (a.sceneId === scene.id || a.sceneId === null || !project.scenes.some(s => s.id === a.sceneId)));
      return <article key={scene.id} className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex justify-between gap-3"><h3 className="font-semibold">Cena {scene.order}</h3><span className="text-xs text-muted-foreground">{formatStudioDuration(timestamps[index].startSeconds)} → {formatStudioDuration(timestamps[index].endSeconds)}</span></div>
        {v.selected ? <img src={assetImageUrl(v.selected)} alt={`Imagem selecionada da cena ${scene.order}`} className="aspect-video max-h-96 w-full rounded-xl bg-theme object-contain" /> : <div className="grid aspect-video max-h-64 place-items-center rounded-xl border border-border bg-theme text-sm text-muted-foreground">{v.pending ? "Gerando imagem…" : "Cena sem imagem selecionada"}</div>}
        {v.outdated && <div className="rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">Imagem selecionada para uma versão anterior da cena. <button className="underline" disabled={Boolean(busy) || !approved} onClick={() => onSelect(scene.id,v.selected.id)}>Manter esta imagem</button> ou gere uma nova.</div>}
        <p className="whitespace-pre-wrap text-sm"><strong>Narração:</strong> {scene.narration}</p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground"><strong>Descrição visual:</strong> {scene.visualDescription}</p>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground"><strong>Prompt da cena:</strong> {scene.imagePrompt}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={!approved || Boolean(busy) || loading || v.pending} onClick={() => onGenerate(scene.id)}>{v.pending ? "Gerando imagem…" : v.assets.some(a => a.source === "AI_GENERATED") || v.selected ? "Gerar novamente" : "Gerar imagem"}</button>
          <label className={`${button} cursor-pointer`}><span>Usar minha imagem</span><input aria-label={`Usar minha imagem na cena ${scene.order}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={!approved || Boolean(busy) || loading} className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(scene.id,file); e.target.value = ""; }} /></label>
        </div>
        {v.pending && <p role="status" className="text-sm text-sky-200">Imagem em processamento. Você pode sair e reabrir o projeto.</p>}
        {v.failed && <div role="alert" className="rounded-lg border border-red-400/30 p-3 text-sm text-red-200">{v.failed.error} <button disabled={!approved || Boolean(busy) || v.pending} onClick={() => onGenerate(scene.id)} className="underline">Tentar novamente</button></div>}
        {available.length > 0 && <div><h4 className="mb-2 text-sm font-medium">Variações e imagens do projeto</h4><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{available.map(asset => <div key={asset.id} className={`rounded-lg border p-2 ${v.selected?.id === asset.id ? "border-sky-400 bg-sky-400/10" : "border-border"}`}>
          <img src={assetImageUrl(asset)} alt={`Variação ${asset.source === "USER_UPLOAD" ? "enviada" : "gerada"}`} className="aspect-video w-full rounded object-contain" />
          <p className="mt-1 text-xs text-muted-foreground">{asset.source === "USER_UPLOAD" ? "Enviada" : "Gerada"}{asset.sceneId === null ? ` · ${asset.usage}` : ""}{asset.sceneId && asset.sceneId !== scene.id ? " · Cena anterior" : ""}</p>
          <button className="mt-2 w-full text-xs text-sky-200 disabled:opacity-50" aria-pressed={v.selected?.id === asset.id} disabled={!approved || Boolean(busy)} onClick={() => onSelect(scene.id,asset.id)}>{v.selected?.id === asset.id ? "Selecionada" : "Usar esta imagem"}</button>
        </div>)}</div></div>}
      </article>;
    })}
    <p className="text-xs text-muted-foreground">Para editar o prompt, volte às cenas, salve as alterações e aprove novamente antes de gerar. Referências enviadas ficam disponíveis para seleção; geração baseada nelas será implementada posteriormente.</p>
    <button className={button} onClick={onBack} disabled={Boolean(busy)}>Voltar às cenas</button>
  </section>;
}
export function VisualProduction({ project, onBack, onProjectChange }) {
  const [state,setState] = useState(emptyVisualState), [busy,setBusy] = useState(""), [error,setError] = useState(""), [loading,setLoading] = useState(true);
  const inFlight = useRef(false);
  const currentId = useRef(project.id);
  const refresh = useCallback(async () => {
    const result = await contentAssets.list(project.id);
    if (currentId.current === project.id) setState(result);
  }, [project.id]);
  useEffect(() => {
    currentId.current = project.id;
    let active = true;
    contentAssets.list(project.id).then(r => { if (active) { setState(r); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; currentId.current = null; };
  }, [project.id,project.revision]);
  useEffect(() => {
    if (!state.busyCount) return;
    let active = true, timeout;
    const poll = async () => {
      try { const result = await contentAssets.list(project.id); if (active) { setState(result); setError(""); } }
      catch (e) { if (active) setError(e.message); }
      if (active) timeout = setTimeout(poll,2000);
    };
    timeout = setTimeout(poll,1000);
    return () => { active = false; clearTimeout(timeout); };
  }, [project.id,state.busyCount]);
  async function run(label,work) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError("");
    try { const result = await work(); if (result?.assets) setState(result); else await refresh(); }
    catch (e) { setError(e.message); }
    finally { inFlight.current = false; setBusy(""); }
  }
  return <div className="space-y-6"><NarrationProduction project={project} onProjectChange={onProjectChange} /><VisualProductionView project={project} state={state} busy={busy} error={error} loading={loading} onBack={onBack}
    onGenerate={id => void run(id,() => contentAssets.generate(project,id))}
    onUpload={(id,file) => void run(id,() => contentAssets.upload(project,id,file))}
    onSelect={(id,assetId) => void run(id,() => contentAssets.select(project,id,assetId))}
    onRefresh={() => void run("refresh",refresh)}
    onMissing={() => { const count = missingVisualCount(state,project.scenes); if (count && window.confirm(`Gerar imagens para ${count} cenas? Esta ação utiliza o provider de imagens e pode consumir créditos.`)) void run("batch",() => contentAssets.missing(project)); }} /></div>;
}
