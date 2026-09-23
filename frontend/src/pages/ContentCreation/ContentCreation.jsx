import { ArrowLeftIcon, SparklesIcon } from "@heroicons/react/24/outline";

export function ContentCreation({ onNavigate }) {
  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <button type="button" onClick={() => onNavigate("youtube-list")} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white">
        <ArrowLeftIcon className="size-4" /> Voltar para o YouTube
      </button>
      <section className="max-w-3xl rounded-2xl border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl gradient-primary"><SparklesIcon className="size-5" /></div>
          <div><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Próxima etapa</p><h1 className="text-xl font-semibold">Criação de conteúdo</h1></div>
        </div>
        <p className="text-sm text-muted-foreground">A análise foi selecionada. A página completa de criação será construída nesta próxima etapa.</p>
      </section>
    </div>
  );
}
