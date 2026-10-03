import { useState } from "react";
import { ArrowLeftIcon, BookmarkIcon, CheckCircleIcon, TrashIcon } from "@heroicons/react/24/outline";

const STORAGE_KEY = "trend-analyzer-content-drafts";

function readDrafts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export function ContentCreation({ onNavigate, analysis }) {
  const [type, setType] = useState("Vídeo");
  const isYoutubeReference = analysis?.source === "youtube-video";
  const [title, setTitle] = useState(isYoutubeReference ? "" : analysis?.title ?? "");
  const [text, setText] = useState(isYoutubeReference ? "" : analysis?.summary ?? "");
  const [keywords, setKeywords] = useState(isYoutubeReference ? (analysis.tags ?? []).join(", ") : "");
  const [drafts, setDrafts] = useState(readDrafts);
  const [saved, setSaved] = useState(false);

  function saveContent(event) {
    event.preventDefault();
    if (!text.trim()) return;

    const content = {
      id: Date.now(),
      title: title.trim() || "Conteúdo sem título",
      type,
      text: text.trim(),
      keywords: keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean),
      createdAt: new Date().toISOString(),
    };
    const nextDrafts = [content, ...drafts];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDrafts));
    setDrafts(nextDrafts);
    setSaved(true);
  }

  function removeDraft(id) {
    const nextDrafts = drafts.filter((draft) => draft.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDrafts));
    setDrafts(nextDrafts);
  }

  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <button type="button" onClick={() => onNavigate("youtube-list")} className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white">
        <ArrowLeftIcon className="size-4" /> Voltar para o YouTube
      </button>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-6">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-sky-300">Estúdio de conteúdo</p>
            <h1 className="text-2xl font-semibold">Criar conteúdo</h1>
            <p className="mt-2 text-sm text-muted-foreground">Escreva uma ideia agora e conecte diferentes IAs de produção no futuro.</p>
          </div>

          {analysis && <div className="mb-5 rounded-xl border border-sky-400/30 bg-sky-400/10 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-sky-300">
              {isYoutubeReference ? "Referência do YouTube" : "Análise selecionada pela IA"}
            </p>
            {isYoutubeReference ? <>
              <p className="mt-2 font-semibold text-white">{analysis.referenceTitle}</p>
              {analysis.channel && <p className="mt-1 text-sm text-slate-300">Canal: {analysis.channel}</p>}
              <p className="mt-1 text-sm text-slate-300">Tema: {analysis.category || "Não informado"}</p>
              {analysis.tags?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                {analysis.tags.map((tag) => <span key={tag} className="rounded-full border border-sky-300/20 px-2 py-1 text-xs text-sky-100">#{tag}</span>)}
              </div>}
            </> : <>
              <p className="mt-2 font-semibold text-white">{analysis.title}</p>
              <p className="mt-1 text-sm text-slate-300">{analysis.summary}</p>
            </>}
          </div>}

          <form onSubmit={saveContent} className="space-y-5">
            <label className="block"><span className="mb-2 block text-sm font-medium">Título</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dê um nome para sua ideia"
                className="h-11 w-full rounded-xl border border-border bg-theme px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-sky-400" />
            </label>
            <fieldset><legend className="mb-2 text-sm font-medium">Formato</legend>
              <div className="grid grid-cols-3 gap-2">
                {["Vídeo", "Reels", "Imagem"].map((option) => <button type="button" key={option} onClick={() => setType(option)}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${type === option ? "border-sky-400 bg-sky-400/15 text-sky-200" : "border-border text-muted-foreground hover:text-white"}`}>
                  {option}
                </button>)}
              </div>
            </fieldset>
            <label className="block"><span className="mb-2 block text-sm font-medium">Texto para criação</span>
              <textarea required value={text} onChange={(event) => { setText(event.target.value); setSaved(false); }} rows="10"
                placeholder="Descreva o conteúdo que você quer produzir..."
                className="w-full resize-y rounded-xl border border-border bg-theme p-3 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:border-sky-400" />
            </label>
            <label className="block"><span className="mb-2 block text-sm font-medium">Palavras-chave</span>
              <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="tecnologia, criatividade, tendências"
                className="h-11 w-full rounded-xl border border-border bg-theme px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-sky-400" />
              <span className="mt-1 block text-xs text-muted-foreground">Separe as palavras por vírgulas.</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl gradient-primary px-4 py-2.5 text-sm font-medium"><BookmarkIcon className="size-4" /> Salvar conteúdo</button>
              {saved && <span role="status" className="inline-flex items-center gap-1.5 text-sm text-emerald-300"><CheckCircleIcon className="size-4" /> Conteúdo salvo</span>}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Conteúdos salvos</h2><p className="mt-1 text-xs text-muted-foreground">Consulte suas ideias posteriormente.</p></div><span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-muted-foreground">{drafts.length}</span></div>
          {drafts.length === 0 && <p className="py-6 text-sm text-muted-foreground">Nenhum conteúdo salvo ainda.</p>}
          <div className="space-y-3">
            {drafts.map((draft) => <article key={draft.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{draft.title}</h3><p className="mt-1 text-xs text-sky-300">{draft.type} · {new Date(draft.createdAt).toLocaleDateString("pt-BR")}</p></div><button type="button" onClick={() => removeDraft(draft.id)} aria-label={`Excluir ${draft.title}`} className="text-muted-foreground hover:text-red-300"><TrashIcon className="size-4" /></button></div>
              <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{draft.text}</p>
              {draft.keywords.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{draft.keywords.map((keyword) => <span key={keyword} className="rounded-full bg-sky-400/10 px-2 py-1 text-xs text-sky-200">#{keyword}</span>)}</div>}
            </article>)}
          </div>
        </section>
      </div>
    </div>
  );
}
