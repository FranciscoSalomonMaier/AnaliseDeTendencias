import { ArrowLeftIcon, PlusIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { calculateSceneTimestamps, formatStudioDuration } from "../../../utils/contentStudioTime";

export function ScenesStep({ videoPlan, onSceneChange, onBack, onApprove, busy, saveStatus, error }) {
  const timestamps = calculateSceneTimestamps(videoPlan.scenes);
  const totalDuration = videoPlan.scenes.reduce((sum, scene) => sum + scene.estimatedDurationSeconds, 0);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Etapa 3</p><h2 className="mt-1 text-xl font-semibold text-white">Cenas</h2></div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{videoPlan.scenes.length} cenas · {formatStudioDuration(totalDuration)}</span>{saveStatus === "saving" && <span role="status">Salvando alterações…</span>}{saveStatus === "saved" && <span role="status" className="text-emerald-300">Alterações salvas</span>}{saveStatus === "error" && <span role="alert" className="text-red-300">Falha ao salvar</span>}</div>
      </div>

      <div className="space-y-3">
        {videoPlan.scenes.map((scene, index) => <article key={scene.order} className="rounded-2xl border border-border bg-card p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-sky-400/10 text-sm font-semibold text-sky-200">{String(scene.order).padStart(2, "0")}</span><h3 className="font-semibold text-white">Cena {String(scene.order).padStart(2, "0")}</h3></div>
            <span className="rounded-lg border border-border px-2.5 py-1 text-xs tabular-nums text-muted-foreground">{formatStudioDuration(timestamps[index].startSeconds)} — {formatStudioDuration(timestamps[index].endSeconds)}</span>
          </div>
          <label className="block text-sm font-medium text-white">Narração
            <textarea rows="3" value={scene.narration} disabled={busy} onChange={(event) => onSceneChange(index, "narration", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400 disabled:opacity-60" />
          </label>
          <label className="mt-4 block text-sm font-medium text-white">Visual
            <textarea rows="2" value={scene.visualDescription} disabled={busy} onChange={(event) => onSceneChange(index, "visualDescription", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400 disabled:opacity-60" />
          </label>
          <label className="mt-4 block text-sm font-medium text-white">Prompt da imagem
            <textarea rows="3" value={scene.imagePrompt} disabled={busy} onChange={(event) => onSceneChange(index, "imagePrompt", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400 disabled:opacity-60" />
          </label>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm text-muted-foreground">Duração (segundos)
              <input type="number" min="1" max="60" value={scene.estimatedDurationSeconds} disabled={busy}
                onChange={(event) => onSceneChange(index, "estimatedDurationSeconds", Math.min(60, Math.max(1, Number(event.target.value) || 1)))}
                className="ml-2 h-9 w-20 rounded-lg border border-border bg-theme px-2 text-center text-sm text-white outline-none focus:border-sky-400 disabled:opacity-60" />
            </label>
            <button type="button" disabled title="Regeneração individual de cena disponível em breve." className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground opacity-50"><ArrowPathIcon className="size-4" /> Regenerar cena</button>
          </div>
        </article>)}
      </div>

      <button type="button" disabled title="Adicionar cenas estará disponível em breve." className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground opacity-50"><PlusIcon className="size-4" /> Adicionar cena</button>
      {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
        <button type="button" onClick={onBack} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-white disabled:opacity-50"><ArrowLeftIcon className="size-4" /> Voltar ao roteiro</button>
        <button type="button" onClick={onApprove} disabled={busy} className="rounded-xl gradient-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "Salvando…" : "Aprovar cenas →"}</button>
      </div>
    </section>
  );
}
