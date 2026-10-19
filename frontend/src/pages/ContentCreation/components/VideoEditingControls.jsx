import { useEffect, useState } from "react";
import { videoRenders } from "../../../services/videoRenderService";
import { motionNames } from "../../../utils/videoEditing";
const fits = { CONTAIN: "Imagem inteira (faixas)", COVER: "Preencher (recorte central)", BLURRED_BACKGROUND: "Fundo desfocado" };
export function VideoEditingControls({ project, preview, busy, onSaved, onDirty, onPreview }) {
  const [settings, setSettings] = useState(null), [dirty, setDirty] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    videoRenders.settings(project.id).then(value => { if (active) { setSettings(value); setDirty(false); onDirty(false); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [project.id, project.revision, onDirty]);
  function update(value) { setSettings(value); setDirty(true); onDirty(true); }
  async function save() {
    setSaving(true); setError("");
    try { const value = await videoRenders.saveSettings(project, settings); setSettings(value); setDirty(false); onDirty(false); await onSaved(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <h3 className="font-semibold">Movimentos, enquadramento e transições</h3>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p>Carregando configurações de edição…</p>}
    {settings && <>
      <div className="flex flex-wrap gap-4">
        <label>Transição <select disabled={busy || saving} value={settings.transition} onChange={e => update({ ...settings, transition: e.target.value })} className="rounded border bg-theme p-2">{["CUT", "FADE", "CROSSFADE"].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Duração solicitada (s) <input className="w-20 rounded border bg-theme p-2" type="number" min="0" max="2" step="0.05" disabled={busy || saving || settings.transition === "CUT"} value={settings.transition === "CUT" ? 0 : settings.transitionSeconds} onChange={e => update({ ...settings, transitionSeconds: Number(e.target.value) })} /></label>
      </div>
      <p className="text-xs text-muted-foreground">Para movimentar, use Preencher. Imagem inteira e fundo desfocado preservam o primeiro plano estático. Crossfade usa a pausa após a fala, sem mover narrações, efeitos ou legendas. A duração efetiva pode ser reduzida. Fade escurece e clareia na troca de cena. A prévia é silenciosa e acelera o movimento completo para até 3 segundos por cena; a transição pode durar mais que a pausa disponível no vídeo final.</p>
      {project.scenes.map(scene => {
        const item = preview?.timeline?.scenes.find(s => s.sceneId === scene.id);
        const choice = settings.scenes[scene.id] ?? { motion: "AUTO", fit: "CONTAIN", amplitude: 0.05 };
        function change(key, value) { update({ ...settings, scenes: { ...settings.scenes, [scene.id]: { ...choice, [key]: value } } }); }
        return <div key={scene.id} className="space-y-2 rounded border border-border p-3 text-sm">
          <strong>Cena {scene.order}</strong>
          <div className="flex flex-wrap gap-3">
            <label>Movimento <select aria-label={`Movimento da cena ${scene.order}`} className="rounded border bg-theme p-2" disabled={busy || saving} value={choice.motion} onChange={e => change("motion", e.target.value)}>{Object.entries(motionNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Enquadramento <select aria-label={`Enquadramento da cena ${scene.order}`} className="rounded border bg-theme p-2" disabled={busy || saving} value={choice.fit} onChange={e => change("fit", e.target.value)}>{Object.entries(fits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Amplitude <input aria-label={`Amplitude da cena ${scene.order}`} className="w-20 rounded border bg-theme p-2" type="number" min="0" max="0.08" step="0.01" value={choice.amplitude} disabled={busy || saving} onChange={e => change("amplitude", Number(e.target.value))} /></label>
          </div>
          <p>Movimento efetivo salvo: {motionNames[item?.motion] ?? "Pendente"}{item?.requestedMotion === "AUTO" ? " · Automático" : ""}</p>
          {item?.fallbackReason && <p className="text-amber-200">{item.fallbackReason}</p>}
          {item?.transition && <p>Transição efetiva: {item.transition.type} · {item.transition.durationSeconds.toFixed(2)} s{settings.transition !== "CUT" && item.transition.type === "CUT" ? " · Pausa insuficiente para transição" : ""}</p>}
          <button type="button" className="rounded border border-sky-400/40 px-3 py-2 disabled:opacity-50" disabled={dirty || saving || busy || !preview?.ready} onClick={() => onPreview(scene.id)}>Prévia animada da cena {scene.order}</button>
        </div>;
      })}
      <button type="button" className="rounded border border-sky-400/40 px-3 py-2 disabled:opacity-50" disabled={!dirty || saving || busy} onClick={() => void save()}>{saving ? "Salvando edição…" : "Salvar edição"}</button>
      {dirty && <p role="status">Salve a edição antes de gerar o vídeo ou a prévia.</p>}
    </>}
  </div>;
}
