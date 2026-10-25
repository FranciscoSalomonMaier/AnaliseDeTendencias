import { useCallback, useEffect, useRef, useState } from "react";
import { subtitles } from "../../../services/subtitleService";
import { renderMediaUrl } from "../../../services/videoRenderService";
const button = "rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-100 disabled:opacity-50";
const field = "w-full rounded-lg border border-border bg-theme p-2 text-sm";
const presets = { CLASSIC: "Classic", DARK_CINEMATIC: "Dark Cinematic", BOLD_SHORTS: "Bold Shorts", DYNAMIC: "Dynamic" };
const presetValues = { BOLD_SHORTS: {fontSize:52,outlineWidth:3,shadow:1,maxWords:3,maxCharacters:26,horizontalMargin:0.1,safeTop:0.08,safeBottom:0.18,verticalPosition:0.74}, CLASSIC: { fontSize: 48, outlineWidth: 2, shadow: 1, maxWords: 5 }, DARK_CINEMATIC: { fontSize: 52, outlineWidth: 1.5, shadow: 2, maxWords: 5 }, DYNAMIC: { fontSize: 60, outlineWidth: 3, shadow: 1, maxWords: 3 } };
export function SubtitlePreview({ settings, segment, currentTime = 0, imageUrl, aspectRatio = "16:9" }) {
  const words = segment?.words;
  const portrait = aspectRatio === "9:16", height = portrait ? 1920 : 1080, unit = portrait ? 10.8 : 19.2;
  return <div aria-label="Prévia das legendas" className="relative w-full overflow-hidden rounded-lg bg-black" style={{aspectRatio:aspectRatio.replace(':','/'), maxWidth:portrait?400:undefined,containerType:"inline-size",...(imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" } : {})}}>
    <div style={{ position: "absolute", width: `${100-200*(settings.horizontalMargin??(portrait?0.1:0.05))}%`, left: `${100*(settings.horizontalMargin??(portrait?0.1:0.05))}%`, top: `${Math.max((settings.safeTop??0.05) + settings.fontSize * 1.3 * settings.maxLines / height, Math.min(settings.verticalPosition, 1 - Math.max(settings.bottomMargin / height,settings.safeBottom??(portrait?0.18:0)))) * 100}%`, transform: "translateY(-100%)", textAlign: "center", fontFamily: "'Subtitle Liberation', Arial, sans-serif", fontSize: `${settings.fontSize / unit}cqw`, fontWeight: settings.preset === "CLASSIC" ? 400 : 700, color: settings.textColor, WebkitTextStroke: `${settings.outlineWidth / unit}cqw black`, paintOrder: "stroke fill", textShadow: `${settings.shadow / unit}cqw ${settings.shadow / unit}cqw #0008`, whiteSpace: "pre-wrap", overflowWrap: "break-word", lineHeight: 1.15 }}>
      {settings.preset === "DYNAMIC" && words?.length ? words.map((w, i) => <span key={i} style={{ color: currentTime >= w.startSeconds && currentTime < w.endSeconds ? settings.highlightColor : settings.textColor }}>{w.text}{i < words.length - 1 ? " " : ""}</span>) : segment?.text ?? "Uma história para acompanhar"}
    </div>
  </div>;
}
function SceneEditor({ project, scene, state, settings, busy, onGenerate, onEdit, onSelect, onDirtyChange }) {
  const info = state.scenes.find(s => s.sceneId === scene.id), versions = state.versions.filter(v => v.sceneId === scene.id), available = versions.filter(v => v.status === "READY" && v.audioAssetId === info?.audioAssetId);
  const selected = available.find(v => v.id === info?.selectedId) ?? available[0];
  const [draft, setDraft] = useState(null), [currentTime, setCurrentTime] = useState(0), [editorError, setEditorError] = useState("");
  const segments = draft ?? selected?.data.segments ?? [], dirty = draft !== null;
  useEffect(() => { onDirtyChange(scene.id, dirty); return () => onDirtyChange(scene.id, false); }, [scene.id, dirty, onDirtyChange]);
  const current = segments.find(s => currentTime >= s.startSeconds && currentTime < s.endSeconds);
  const active = versions.some(v => v.audioAssetId === info?.audioAssetId && ["QUEUED", "PROCESSING"].includes(v.status));
  const failed = versions.find(v => v.audioAssetId === info?.audioAssetId && v.status === "FAILED");
  const imageUrl = renderMediaUrl(`/content-projects/${project.id}/assets/${state.visualSelections?.find(v => v.sceneId === scene.id)?.assetId}/file`);
  function update(index, key, value) { setDraft(segments.map((s, i) => i === index ? { id: s.id, order: s.order, text: s.text, startSeconds: s.startSeconds, endSeconds: s.endSeconds, [key]: value } : s)); }
  async function save() {
    setEditorError(""); let previous = 0;
    for (const s of segments) { if (!s.text.trim() || !Number.isFinite(s.startSeconds) || !Number.isFinite(s.endSeconds) || s.startSeconds < previous || s.endSeconds <= s.startSeconds || s.endSeconds > selected.data.audioDurationSeconds) { setEditorError("Revise os textos e tempos: início ≥ 0, fim > início, sem sobreposição e dentro da narração."); return; } previous = s.endSeconds; }
    if (await onEdit(scene.id, selected.id, segments)) setDraft(null);
  }
  return <article className="space-y-3 rounded-lg border border-border p-4">
    <h3 className="font-semibold">Cena {scene.order} · {info?.ready ? "Legendas prontas" : "Legendas pendentes"}</h3>
    {info?.outdated && <p className="text-sm text-amber-200">Estas legendas foram geradas para uma versão anterior da narração. Revise e confirme.</p>}
    {selected?.data.alignmentNote && <p className="text-sm text-amber-200">{selected.data.alignmentNote}</p>}
    {selected?.data.reviewRequired && (selected.data.matchScore ?? 0) < 0.85 && <p className="text-sm text-amber-200">A transcrição difere do roteiro ({Math.round((selected.data.matchScore ?? 0) * 100)}% de correspondência textual). Confira o áudio antes de confirmar.</p>}
    <button className={button} disabled={busy || active || !info?.audioAssetId || dirty} onClick={() => onGenerate(scene.id, Boolean(available.length))}>{active ? "Transcrevendo…" : available.length ? "Gerar legendas novamente" : "Gerar legendas"}</button>
    {active && <p role="status">Processando a narração selecionada. Você pode sair e acompanhar ao reabrir.</p>}
    {failed && <p role="alert" className="text-sm text-red-200">{failed.error}</p>}
    {info?.audioAssetId && <><audio aria-label={`Narração para legendas da cena ${scene.order}`} controls preload="none" src={renderMediaUrl(`/content-projects/${project.id}/assets/${info.audioAssetId}/file`)} onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)} onSeeked={e => setCurrentTime(e.currentTarget.currentTime)} className="w-full" /><p className="text-xs text-muted-foreground">Tempo real do áudio: {currentTime.toFixed(3)} s · {current?.text ?? "Sem legenda neste instante"}</p></>}
    <div style={{ containerType: "inline-size" }}><SubtitlePreview aspectRatio={project.config?.aspectRatio ?? "16:9"} settings={settings} segment={current ?? (currentTime === 0 ? segments[0] : { text: "" })} currentTime={currentTime} imageUrl={state.visualSelections?.some(v => v.sceneId === scene.id) ? imageUrl : undefined} /></div>
    {selected && <p className="text-xs text-muted-foreground">Tempos relativos à narração · {selected.data.granularity === "WORD" && !dirty ? "Timestamps por palavra" : "Timestamps por segmento; destaque por palavra indisponível"}. Alterações de texto ou tempo passam a usar segmentos.</p>}
    {editorError && <p role="alert" className="text-red-200">{editorError}</p>}
    {segments.length > 0 && <details><summary className="cursor-pointer">Editar legendas ({segments.length})</summary><div className="mt-3 space-y-3">{segments.map((s, i) => <div key={s.id} className={`space-y-2 rounded border p-3 ${current?.id === s.id ? "border-sky-400" : "border-border"}`}><div className="grid grid-cols-2 gap-2"><label className="text-xs">Início (segundos)<input aria-label={`Início da legenda ${i + 1} da cena ${scene.order}`} className={field} type="number" min="0" step="0.001" value={s.startSeconds} disabled={busy} onChange={e => update(i, "startSeconds", Number(e.target.value))} /></label><label className="text-xs">Fim (segundos)<input aria-label={`Fim da legenda ${i + 1} da cena ${scene.order}`} className={field} type="number" min="0" step="0.001" value={s.endSeconds} disabled={busy} onChange={e => update(i, "endSeconds", Number(e.target.value))} /></label></div><textarea aria-label={`Texto da legenda ${i + 1} da cena ${scene.order}`} className={field} maxLength="500" value={s.text} disabled={busy} onChange={e => update(i, "text", e.target.value)} /></div>)}<div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !dirty} onClick={() => void save()}>Salvar legendas</button><button className={button} disabled={busy || !dirty} onClick={() => setDraft(null)}>Descartar edição</button></div></div></details>}
    {available.length > 0 && <label className="block text-sm">Versões do áudio atual<select aria-label={`Versão das legendas da cena ${scene.order}`} className={field} value={info?.selectedId ?? ""} disabled={busy || dirty} onChange={e => { if (e.target.value) onSelect(scene.id, e.target.value); }}><option value="">Selecione e confirme após revisar</option>{available.map(v => <option key={v.id} value={v.id}>{new Date(v.createdAt).toLocaleString("pt-BR")} · {v.data.granularity}{v.data.edited ? " · Editada" : ""}</option>)}</select></label>}
    {selected && (!info?.selectedId || info.outdated || selected.data.reviewRequired) && <button className={button} disabled={busy || dirty} onClick={() => onSelect(scene.id, selected.id)}>Confirmar legendas revisadas</button>}
    {versions.some(v => v.audioAssetId !== info?.audioAssetId) && <p className="text-xs text-muted-foreground">Versões de outros áudios preservadas. Selecione a narração correspondente para utilizá-las.</p>}
  </article>;
}
export function SubtitleProductionView({ project, state, settings, dirty, hasUnsavedEdits = false, busy, error, onSettings, onSaveSettings, onGenerate, onMissing, onEdit, onSelect, onExport, onSceneDirty }) {
  return <section aria-label="Legendas automáticas" className="space-y-4 rounded-2xl border border-border bg-card p-5">
    <h2 className="text-xl font-semibold">Legendas automáticas</h2><p className="text-sm text-muted-foreground">Transcrição do áudio selecionado com timestamps reais. Revise o reconhecimento antes de renderizar.</p>
    {error && <p role="alert" className="text-red-200">{error}</p>}
    {!state ? <p role="status">Carregando legendas…</p> : <><p role="status">{state.readyCount} / {project.scenes.length} cenas prontas · {state.busyCount} em processamento</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy || state.busyCount > 0 || dirty || hasUnsavedEdits} onClick={onMissing}>Gerar legendas faltantes</button><button className={button} disabled={busy || dirty || hasUnsavedEdits || state.readyCount !== project.scenes.length} onClick={onExport}>Exportar SRT</button></div>
      <p className="text-xs text-muted-foreground">OpenAI whisper-1 · US$ 0,006/minuto de narração transcrita. Geração apenas por ação explícita; legendas existentes são reutilizadas.</p>
      <label className="flex gap-2"><input type="checkbox" checked={settings.enabled} onChange={e => onSettings({ ...settings, enabled: e.target.checked })} />Incorporar legendas no vídeo</label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="text-sm">Estilo<select aria-label="Estilo das legendas" className={field} value={settings.preset} onChange={e => onSettings({ ...settings, ...presetValues[e.target.value], preset: e.target.value })}>{Object.entries(presets).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        {[['fontSize','Tamanho da fonte',24,96,1],['outlineWidth','Contorno',0,6,0.5],['shadow','Sombra',0,6,0.5],['verticalPosition','Posição vertical',0.2,0.9,0.01],['bottomMargin','Margem inferior',20,300,1],['maxLines','Máximo de linhas',1,2,1],['maxWords','Palavras por grupo',1,10,1],['maxCharacters','Caracteres por linha',16,80,1],['horizontalMargin','Margem horizontal',0.03,0.2,0.01],['safeTop','Área segura superior',0.03,0.3,0.01],['safeBottom','Área segura inferior',0.03,0.35,0.01]].map(([key,label,min,max,step]) => <label key={key} className="text-sm">{label}<input aria-label={label} className={field} type="number" min={min} max={max} step={step} value={settings[key] ?? ({horizontalMargin:0.1,safeTop:0.08,safeBottom:0.18}[key] ?? 0)} onChange={e => onSettings({ ...settings, [key]: Number(e.target.value) })} /></label>)}
        {[['textColor','Cor do texto'],['highlightColor','Cor do destaque']].map(([key,label]) => <label key={key} className="text-sm">{label}<input aria-label={label} className="block h-10 w-full" type="color" value={settings[key] ?? ({horizontalMargin:0.1,safeTop:0.08,safeBottom:0.18}[key] ?? 0)} onChange={e => onSettings({ ...settings, [key]: e.target.value })} /></label>)}</div>
      <button className={button} disabled={busy || !dirty} onClick={onSaveSettings}>Salvar configurações de legendas</button><p className="text-xs text-muted-foreground">Prévia aproximada no navegador; o MP4 usa libass. Agrupamento afeta novas gerações. Textos editados mantêm seus tempos, sem inventar alinhamento por palavra.</p>
      {project.scenes.map(scene => <SceneEditor key={`${scene.id}-${state.scenes.find(s => s.sceneId === scene.id)?.selectedId ?? 'none'}-${state.scenes.find(s => s.sceneId === scene.id)?.audioAssetId}`} project={project} scene={scene} state={state} settings={settings} busy={busy} onGenerate={onGenerate} onEdit={onEdit} onSelect={onSelect} onDirtyChange={onSceneDirty} />)}
    </>}
  </section>;
}
export function SubtitleProduction({ project, onProjectChange, onDirtyChange }) {
  const [state, setState] = useState(null), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [sceneDirty, setSceneDirty] = useState({});
  const inFlight = useRef(false), projectRef = useRef(project), changeRef = useRef(onProjectChange);
  useEffect(() => { projectRef.current = project; changeRef.current = onProjectChange; }, [project, onProjectChange]);
  const dirty = draft !== null, anyDirty = dirty || Object.values(sceneDirty).some(Boolean);
  useEffect(() => { onDirtyChange(anyDirty); return () => onDirtyChange(false); }, [anyDirty, onDirtyChange]);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    const navigate = e => { if (!window.confirm("Há alterações de legendas não salvas. Deseja sair sem salvar?")) e.preventDefault(); };
    window.addEventListener("beforeunload", warn); window.addEventListener("content:before-navigate", navigate);
    return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("content:before-navigate", navigate); };
  }, [anyDirty]);
  const updateSceneDirty = useCallback((id, value) => setSceneDirty(current => current[id] === value ? current : { ...current, [id]: value }), []);
  const apply = useCallback(result => { if (result.project.revision < projectRef.current.revision) return; setState(result); if (result.project.revision > projectRef.current.revision) { projectRef.current = result.project; changeRef.current?.(result.project); } }, []);
  useEffect(() => {
    let active = true, timer;
    const poll = async () => { try { const result = await subtitles.list(project.id); if (active && !inFlight.current) apply(result); } catch (e) { if (active) setError(e.message); } finally { if (active) timer = setTimeout(poll, 2000); } };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [project.id, project.revision, apply]);
  async function run(work) { if (inFlight.current) return false; inFlight.current = true; setBusy(true); setError(""); try { const result = await work(); if (result?.versions) apply(result); return true; } catch (e) { setError(e.message); return false; } finally { inFlight.current = false; setBusy(false); } }
  return <SubtitleProductionView project={project} state={state} settings={draft ?? state?.settings} dirty={dirty} hasUnsavedEdits={Object.values(sceneDirty).some(Boolean)} busy={busy} error={error} onSceneDirty={updateSceneDirty} onSettings={setDraft}
    onSaveSettings={() => void run(async () => { const result = await subtitles.settings(projectRef.current, draft); setDraft(null); return result; })}
    onGenerate={(sceneId, replace) => { if (window.confirm(`${replace ? 'Gerar uma nova versão preservando as anteriores' : 'Transcrever a narração'}? A OpenAI cobra US$ 0,006 por minuto.`)) void run(() => subtitles.generate(projectRef.current, sceneId, replace)); }}
    onMissing={() => { if (window.confirm("Gerar somente legendas faltantes dos áudios selecionados? Esta ação utiliza a API OpenAI.")) void run(() => subtitles.missing(projectRef.current)); }}
    onEdit={(sceneId, versionId, segments) => run(() => subtitles.edit(projectRef.current, sceneId, versionId, segments))}
    onSelect={(sceneId, versionId) => void run(() => subtitles.select(projectRef.current, sceneId, versionId))}
    onExport={() => void run(() => subtitles.download(project.id))} />;
}
