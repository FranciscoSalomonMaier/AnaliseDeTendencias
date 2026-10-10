import { ArrowLeftIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { countScriptWords, formatStudioDuration } from "../../../utils/contentStudioTime";

export function ScriptStep({ script, selectedIdea, onChange, onChangeSection, onBack, onRegenerate, onGenerateScenes, busy, saveStatus, error, onSave, onApprove, scenesAllowed = false }) {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Etapa {onApprove ? 3 : 2}</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Revisar roteiro</h2>
      </div>

      <div className="rounded-2xl border border-sky-400/25 bg-sky-400/5 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Ideia selecionada</p>
        <h3 className="mt-1 font-semibold text-white">{selectedIdea.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground"><span className="text-slate-200">Gancho:</span> {selectedIdea.hook}</p>
        <p className="mt-1 text-sm text-muted-foreground"><span className="text-slate-200">Abordagem:</span> {selectedIdea.angle}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">Roteiro narrado</p><h3 className="mt-1 text-lg font-semibold text-white">Edite antes de gerar as cenas</h3></div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span>Duração: {formatStudioDuration(script.estimatedDurationSeconds)}</span><span>~{countScriptWords(script)} palavras</span>{saveStatus === "saving" && <span role="status">Salvando alterações…</span>}{saveStatus === "saved" && <span role="status" className="text-emerald-300">Alterações salvas</span>}{saveStatus === "error" && <span role="alert" className="text-red-300">Falha ao salvar</span>}</div>
        </div>

        {script.researchRequired && <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p className="font-medium">Pesquisa adicional necessária</p>
          {script.researchNotes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/80">{script.researchNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>}
        </div>}

        <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-75">
          <label className="block text-sm font-medium text-white">Título
            <input value={script.title} onChange={(event) => onChange("title", event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-border bg-theme px-3 font-normal outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-white">Gancho
            <textarea rows="3" value={script.hook} onChange={(event) => onChange("hook", event.target.value)}
              className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400" />
          </label>
          <label className="block text-sm font-medium text-white">Introdução
            <textarea rows="4" value={script.introduction} onChange={(event) => onChange("introduction", event.target.value)}
              className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400" />
          </label>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white">Seções</h4>
            {script.sections.map((section, index) => <section key={index} className="rounded-xl border border-border p-4">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Seção {String(index + 1).padStart(2, "0")}</p>
              <label className="block text-sm font-medium text-white">Título
                <input value={section.title} onChange={(event) => onChangeSection(index, "title", event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-border bg-theme px-3 font-normal outline-none focus:border-sky-400" />
              </label>
              <label className="mt-3 block text-sm font-medium text-white">Narração
                <textarea rows="6" value={section.narration} onChange={(event) => onChangeSection(index, "narration", event.target.value)}
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400" />
              </label>
            </section>)}
          </div>

          <label className="block text-sm font-medium text-white">Conclusão
            <textarea rows="4" value={script.conclusion} onChange={(event) => onChange("conclusion", event.target.value)}
              className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 font-normal leading-6 outline-none focus:border-sky-400" />
          </label>
        </fieldset>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-border pt-4">
          <button type="button" onClick={onBack} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-white disabled:opacity-50"><ArrowLeftIcon className="size-4" /> Voltar para ideias</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRegenerate} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-white disabled:opacity-50"><SparklesIcon className="size-4" />{busy ? "Gerando…" : "Gerar roteiro novamente"}</button>
            {onSave && <button type="button" disabled={busy} onClick={onSave} className="rounded-xl border border-border px-4 py-2 text-sm">Salvar alterações</button>}
            {onApprove && <button type="button" disabled={busy || scenesAllowed} onClick={onApprove} className="rounded-xl border border-sky-400/40 px-4 py-2 text-sm">{scenesAllowed ? 'Roteiro aprovado' : 'Aprovar roteiro'}</button>}
            <button type="button" onClick={onGenerateScenes} disabled={busy || (Boolean(onApprove) && !scenesAllowed)} className="rounded-xl gradient-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{onApprove ? 'Gerar cenas →' : 'Aprovar roteiro e gerar cenas →'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
