import { useEffect, useRef, useState } from "react";
import { contentAssets, assetImageUrl } from "../../../services/contentAssetService";

export function VisualReferences({ project, ensureProject, disabled, onBusyChange }) {
  const [assets,setAssets] = useState([]), [usage,setUsage] = useState("REFERENCE"), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    if (project) contentAssets.list(project.id).then(r => { if (active) setAssets(r.assets.filter(a => a.sceneId === null)); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [project]);
  async function upload(file) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); onBusyChange?.(true);
    try {
      const p = project ?? await ensureProject();
      const state = await contentAssets.upload(p,null,file,usage);
      setAssets(state.assets.filter(a => a.sceneId === null));
    } catch (e) { setError(e.message); }
    finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3">
    <h3 className="text-sm font-medium">Imagens do projeto</h3>
    <p className="text-xs text-muted-foreground">Obrigatória: deve ser selecionada em uma cena. Referência: orientação visual para a etapa futura de geração baseada em imagem. Opcional: use se fizer sentido. PNG, JPEG ou WEBP estático, até 10 MB.</p>
    <div className="flex flex-wrap gap-3">
      <select aria-label="Uso da imagem" value={usage} onChange={e => setUsage(e.target.value)} disabled={disabled || busy} className="rounded-lg border border-border bg-theme px-3 py-2 text-sm"><option value="REQUIRED">Obrigatória</option><option value="REFERENCE">Referência</option><option value="OPTIONAL">Opcional</option></select>
      <label className="cursor-pointer rounded-lg border border-sky-400/40 px-3 py-2 text-sm">{busy ? "Enviando imagem…" : "+ Imagens"}<input aria-label="Enviar imagem do projeto" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} /></label>
    </div>
    {!project && <p className="text-xs text-muted-foreground">Ao enviar uma imagem, o tema e a configuração serão salvos como rascunho.</p>}
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{assets.filter(a => a.status === "READY").map(a => <article key={a.id} className="rounded-lg border border-border p-2"><img src={assetImageUrl(a)} alt="Imagem enviada ao projeto" className="aspect-video w-full object-contain" /><p className="mt-1 text-xs text-muted-foreground">{a.usage === "REQUIRED" ? "Obrigatória" : a.usage === "REFERENCE" ? "Referência" : "Opcional"}</p></article>)}</div>
    <p className="text-xs text-muted-foreground">As imagens enviadas não são encaminhadas à IA nesta etapa. Ficam disponíveis para seleção na Produção.</p>
  </section>;
}
