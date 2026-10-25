const field =
  "mt-2 w-full rounded-xl border border-border bg-theme p-3 outline-none focus:border-sky-400";
export function ProjectConfiguration({
  config,
  onChange,
  onSubmit,
  busy,
  existing,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-card p-5 space-y-4"
    >
      <h2 className="text-xl font-semibold">
        {existing ? "Configuração do projeto" : "Novo projeto"}
      </h2>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-lg border border-sky-400 bg-sky-400/10 px-4 py-2">
          Vídeo
        </span>
        {["Imagem"].map((type) => (
          <button
            key={type}
            type="button"
            disabled
            className="rounded-lg border border-border px-4 py-2 text-muted-foreground opacity-50"
          >
            {type} · Em breve
          </button>
        ))}
      </div>
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">Formato do vídeo<select className={field} value={config.aspectRatio ?? "16:9"} onChange={e => onChange("aspectRatio", e.target.value)}><option value="16:9">Horizontal — 16:9</option><option value="9:16">Vertical — 9:16 (Shorts e Reels)</option></select></label>
        <label className="block">
          Tema *
          <input
            required
            maxLength={300}
            value={config.topic}
            onChange={(e) => onChange("topic", e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          Descrição / instruções
          <textarea
            maxLength={4000}
            rows={3}
            value={config.instructions}
            onChange={(e) => onChange("instructions", e.target.value)}
            className={field}
          />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label>
            Estilo
            <select
              value={config.style}
              onChange={(e) => onChange("style", e.target.value)}
              className={field}
            >
              <option value="DARK">Dark</option>
            </select>
          </label>
          <label>
            Duração desejada
            <select
              value={config.targetDurationSeconds}
              onChange={(e) =>
                onChange("targetDurationSeconds", Number(e.target.value))
              }
              className={field}
            >
              {[30, 60, 90, 180, 300, 600].map((s) => (
                <option key={s} value={s}>
                  {s >= 120 && s % 60 === 0 ? `${s / 60} minutos` : `${s} segundos`}
                </option>
              ))}
            </select>
          </label>
          <label>Duração personalizada (30–600 segundos)<input type="number" min="30" max="600" step="1" className={field} value={config.targetDurationSeconds} onChange={e => onChange("targetDurationSeconds", Number(e.target.value))}/></label>
          <label>
            Idioma
            <select
              value={config.language}
              onChange={(e) => onChange("language", e.target.value)}
              className={field}
            >
              <option value="pt-BR">Português (Brasil)</option>
            </select>
          </label>
        </div>
      </fieldset>
      <div>
        <h3 className="text-sm font-medium">Referências opcionais</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="px-3 py-2 text-sm text-sky-200">Imagens: adicione na seção abaixo</span>
          {["Sons", "Músicas"].map((type) => (
            <button
              key={type}
              type="button"
              disabled
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground opacity-50"
            >
              + {type} · Em breve
            </button>
          ))}
        </div>
      </div>
      <button
        disabled={busy || !config.topic.trim()}
        className="rounded-xl gradient-primary px-4 py-2 disabled:opacity-50"
      >
        {busy ? "Aguarde…" : existing ? "Salvar configuração" : "Gerar ideias"}
      </button>
    </form>
  );
}
