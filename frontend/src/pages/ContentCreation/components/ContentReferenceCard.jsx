import { PlayCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";

export function ContentReferenceCard({ reference }) {
  if (!reference) {
    return <section className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
      Nenhuma trend foi selecionada. Abra o Estúdio a partir de uma trend ou análise de IA.
    </section>;
  }

  const fromAnalysis = reference.source === "ai-analysis";
  return (
    <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
          {fromAnalysis ? <SparklesIcon className="size-5" /> : <PlayCircleIcon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-sky-300">
            {fromAnalysis ? "Referência da trend" : "Referência do YouTube"}
          </p>
          <h2 className="mt-1 break-words text-base font-semibold text-white md:text-lg">
            {reference.referenceTitle || reference.title || "Trend selecionada"}
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {reference.channel && <span>Canal: {reference.channel}</span>}
            <span>Tema: {reference.category || "Não informado"}</span>
            {reference.regionCode && <span>Região: {reference.regionCode}</span>}
          </div>
          {reference.tags?.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
            {reference.tags.map((tag) => <span key={tag} className="rounded-full border border-border px-2 py-1 text-[11px] text-sky-200">#{tag}</span>)}
          </div>}
          {fromAnalysis && reference.summary && <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">{reference.summary}</p>}
        </div>
      </div>
    </section>
  );
}
