import { SparklesIcon, CheckCircleIcon } from "@heroicons/react/24/outline";

const formats = [
  { id: "video", label: "Vídeo", available: true },
  { id: "reels", label: "Reels", available: false },
  { id: "image", label: "Imagem", available: false },
];

export function IdeaStep({
  settings,
  onSettingsChange,
  ideas,
  selectedIdea,
  onSelectIdea,
  onGenerateIdeas,
  onGenerateScript,
  busy,
  canGenerate,
  selectingIdeaId,
  error,
}) {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Etapa 1</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Gerar ideias</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configure o formato do vídeo e peça propostas baseadas na trend selecionada.</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-white">Formato</legend>
          <div className="flex flex-wrap gap-2">
            {formats.map((format) => <button key={format.id} type="button" disabled={!format.available || busy}
              title={!format.available ? "Este formato será disponibilizado em breve." : undefined}
              aria-pressed={format.available}
              className={`rounded-xl border px-4 py-2 text-sm ${format.available ? "border-sky-400/50 bg-sky-400/10 text-sky-200" : "border-border text-muted-foreground opacity-60"}`}>
              {format.label}{format.available ? " · selecionado" : " · em breve"}
            </button>)}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-white">Idioma
            <select value={settings.language} disabled={busy} onChange={(event) => onSettingsChange("language", event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-border bg-theme px-3 text-sm font-normal text-white outline-none focus:border-sky-400">
              <option value="pt-BR">Português (BR)</option>
              <option value="en-US">English (US)</option>
              <option value="es-ES">Español</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-white">Duração desejada
            <select value={settings.durationPreference} disabled={busy} onChange={(event) => onSettingsChange("durationPreference", event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-border bg-theme px-3 text-sm font-normal text-white outline-none focus:border-sky-400">
              <option value="5-8">5–8 minutos</option>
              <option value="8-10">8–10 minutos</option>
              <option value="10-15">10–15 minutos</option>
            </select>
          </label>
        </div>

        <label className="mt-5 block text-sm font-medium text-white">Instruções adicionais
          <textarea rows="3" maxLength="2000" value={settings.additionalInstructions} disabled={busy}
            onChange={(event) => onSettingsChange("additionalInstructions", event.target.value)}
            placeholder="Ex.: Quero uma abordagem misteriosa, com suspense e foco em curiosidades."
            className="mt-2 w-full resize-y rounded-xl border border-border bg-theme p-3 text-sm font-normal leading-6 text-white outline-none placeholder:text-muted-foreground focus:border-sky-400" />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onGenerateIdeas} disabled={busy || !canGenerate}
            title={!canGenerate ? "Abra o Estúdio a partir de uma trend ou análise com ID." : undefined}
            className="inline-flex items-center gap-2 rounded-xl gradient-primary px-4 py-2.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-50">
            <SparklesIcon className="size-4" />{busy ? "Gerando ideias…" : ideas.length ? "Gerar novas ideias" : "Gerar ideias com IA"}
          </button>
          {selectedIdea && <button type="button" onClick={onGenerateScript} disabled={busy || Boolean(selectingIdeaId)}
            className="rounded-xl border border-sky-400/40 px-4 py-2.5 text-sm font-medium text-sky-200 transition hover:bg-sky-400/10 disabled:opacity-50">
            Gerar roteiro <span aria-hidden="true">→</span>
          </button>}
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      </div>

      {ideas.length > 0 && <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-white">{ideas.length} ideias geradas</h3>
          {selectedIdea && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircleIcon className="size-4" /> Ideia selecionada</span>}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ideas.map((idea, index) => {
            const selected = selectedIdea?.ideaId === idea.ideaId;
            const selecting = selectingIdeaId === idea.ideaId;
            return <article key={idea.ideaId} className={`flex flex-col rounded-2xl border bg-card p-4 transition ${selected ? "border-sky-400/70 ring-1 ring-sky-400/30" : "border-border"}`}>
              <p className="text-[11px] font-medium uppercase tracking-wider text-sky-300">Ideia {String(index + 1).padStart(2, "0")}</p>
              <h4 className="mt-2 text-base font-semibold leading-6 text-white">{idea.title}</h4>
              <div className="mt-4 space-y-3 text-sm">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gancho</p><p className="mt-1 leading-5 text-slate-200">{idea.hook}</p></div>
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Abordagem</p><p className="mt-1 leading-5 text-slate-200">{idea.angle}</p></div>
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resumo</p><p className="mt-1 leading-5 text-muted-foreground">{idea.summary}</p></div>
                {idea.targetAudience && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Público provável</p><p className="mt-1 text-slate-200">{idea.targetAudience}</p></div>}
              </div>
              <button type="button" onClick={() => onSelectIdea(idea)} disabled={busy || Boolean(selectingIdeaId)} aria-pressed={selected}
                className={`mt-5 w-full rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${selected ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-200" : "border-border text-white hover:border-sky-400/50 hover:bg-sky-400/5"}`}>
                {selecting ? "Salvando seleção…" : selected ? "Ideia selecionada" : "Selecionar ideia"}
              </button>
            </article>;
          })}
        </div>
      </div>}
    </section>
  );
}
