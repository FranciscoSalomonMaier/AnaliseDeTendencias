import { useEffect, useRef, useState } from "react";
import { remixImport, remixFileUrl } from "../../services/videoRemixService";
const button =
  "rounded-lg border border-sky-400/40 px-3 py-2 text-sm disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-border bg-theme p-2";
const blankRights = {
  authorization: "",
  userDeclaredRights: false,
  author: "",
  licenseType: "",
  evidence: "",
  notes: "",
};
export function RemixImportPanel({ project, disabled, onChanged, onBusy }) {
  const [filters, setFilters] = useState({
    query: project.topic,
    maxResults: 10,
    language: project.narrationLanguage.split("-")[0],
    order: "relevance",
    duration: "any",
    creativeCommons: false,
  });
  const [submitted, setSubmitted] = useState(null),
    [result, setResult] = useState(null),
    [settings, setSettings] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null),
    [target, setTarget] = useState(
      project.mode === "SINGLE_SOURCE" ? (project.sources[0]?.id ?? "") : "",
    ),
    [rights, setRights] = useState({ ...blankRights }),
    [progress, setProgress] = useState(null),
    [attachment, setAttachment] = useState({ sourceId: "", fileId: "" });
  const active = useRef(null),
    inFlight = useRef(false),
    fileInput = useRef(null);
  useEffect(() => {
    let mounted = true;
    remixImport
      .settings(project.id)
      .then((r) => {
        if (mounted) setSettings(r);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
      active.current?.abort();
    };
  }, [project.id]);
  async function run(work) {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await onChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  async function search(pageToken) {
    const data = pageToken ? { ...submitted, pageToken } : filters;
    await run(async () => {
      const found = await remixImport.search(project.id, data);
      setSubmitted({ ...data, pageToken: undefined });
      setResult(found);
    });
  }
  async function select(video) {
    let replacement = {};
    if (project.mode === "SINGLE_SOURCE" && project.sources.length) {
      const old = project.sources[0];
      if (
        !window.confirm(
          `Substituir a fonte “${old.title}” por “${video.title}”? Os arquivos locais existentes serão preservados.`,
        )
      )
        return;
      replacement = { replaceSourceId: old.id, confirmReplacement: true };
    }
    await run(async () => {
      await remixImport.candidate(project, video.externalId, replacement);
      await onChanged();
      setRights({ ...blankRights });
      setMessage(
        "Candidato associado. O arquivo ainda precisa ser importado com autorização.",
      );
    });
  }
  async function upload() {
    if (!file) return;
    if (
      !rights.authorization ||
      !rights.userDeclaredRights ||
      !rights.evidence.trim()
    ) {
      setError("Informe autorização, evidência e confirme os direitos de uso.");
      return;
    }
    if (settings && file.size > settings.maxBytes) {
      setError("Arquivo acima do limite permitido.");
      return;
    }
    await run(async () => {
      setProgress(0);
      const task = remixImport.upload(
        project,
        file,
        effectiveTarget,
        rights,
        setProgress,
      );
      active.current = task;
      try {
        await task.promise;
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        await onChanged();
        setMessage(
          "Arquivo validado e importado. A declaração de direitos foi registrada.",
        );
      } finally {
        active.current = null;
        setProgress(null);
      }
    });
  }
  const effectiveTarget = project.sources.some((s) => s.id === target)
    ? target
    : project.mode === "SINGLE_SOURCE"
      ? (project.sources[0]?.id ?? "")
      : "";
  const blocked = busy || disabled;
  return (
    <section
      aria-label="Descoberta e importação"
      className="space-y-5 rounded-xl border border-border bg-card p-4"
    >
      <h2 className="text-xl font-semibold">Pesquisar vídeos</h2>
      <p className="text-sm text-muted-foreground">
        A pesquisa consulta metadados oficiais do YouTube. Selecionar um
        candidato não baixa o vídeo. Creative Commons exige verificação dos
        direitos aplicáveis.
      </p>
      {error && (
        <p role="alert" className="break-words text-red-200">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sky-100">
          {message}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="space-y-3"
      >
        <fieldset disabled={blocked} className="space-y-3">
          <label className="block">
            Termo de pesquisa
            <input
              aria-label="Termo de pesquisa"
              className={input}
              minLength={2}
              maxLength={200}
              required
              value={filters.query}
              onChange={(e) =>
                setFilters((v) => ({ ...v, query: e.target.value }))
              }
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              Resultados
              <input
                aria-label="Quantidade de resultados"
                className={input}
                type="number"
                min="1"
                max="25"
                required
                value={filters.maxResults}
                onChange={(e) =>
                  setFilters((v) => ({
                    ...v,
                    maxResults: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Idioma
              <select
                aria-label="Idioma da pesquisa"
                className={input}
                value={filters.language}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, language: e.target.value }))
                }
              >
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
              </select>
            </label>
            <label>
              Ordenação
              <select
                aria-label="Ordenação"
                className={input}
                value={filters.order}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, order: e.target.value }))
                }
              >
                <option value="relevance">Relevância</option>
                <option value="date">Data</option>
                <option value="viewCount">Visualizações</option>
              </select>
            </label>
            <label>
              Duração aproximada
              <select
                aria-label="Duração aproximada"
                className={input}
                value={filters.duration}
                onChange={(e) =>
                  setFilters((v) => ({ ...v, duration: e.target.value }))
                }
              >
                <option value="any">Qualquer</option>
                <option value="short">Menos de 4 minutos</option>
                <option value="medium">4 a 20 minutos</option>
                <option value="long">Mais de 20 minutos</option>
              </select>
            </label>
          </div>
          <label className="block">
            <input
              type="checkbox"
              checked={filters.creativeCommons}
              onChange={(e) =>
                setFilters((v) => ({ ...v, creativeCommons: e.target.checked }))
              }
            />{" "}
            Somente Creative Commons informado pelo YouTube
          </label>
          <button className={button} type="submit">
            {busy ? "Aguarde…" : "Pesquisar no YouTube"}
          </button>
        </fieldset>
      </form>
      {result && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {result.items.map((video) => {
              const candidate = project.sources.find(
                (s) =>
                  s.externalId === video.externalId && s.platform === "YOUTUBE",
              );
              return (
                <article
                  key={video.externalId}
                  className="min-w-0 space-y-2 rounded-lg border border-border p-3"
                >
                  {video.thumbnail && (
                    <img
                      className="aspect-video w-full rounded object-cover"
                      src={video.thumbnail}
                      alt={`Thumbnail de ${video.title}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <h3 className="break-words font-semibold">{video.title}</h3>
                  <p className="text-sm">
                    {video.channel} ·{" "}
                    {video.durationSeconds
                      ? `${Math.round(video.durationSeconds)}s`
                      : "Duração indisponível"}{" "}
                    · {video.views ?? "—"} visualizações
                  </p>
                  <p
                    className={
                      candidate ? "text-sky-200" : "text-muted-foreground"
                    }
                  >
                    {candidate?.status === "UNAVAILABLE"
                      ? "Fonte indisponível para importação"
                      : candidate?.status === "IMPORTED"
                        ? "Fonte autorizada e importada"
                        : candidate
                          ? "Candidato selecionado"
                          : video.eligibility === "UNAVAILABLE"
                            ? "Indisponível para importação"
                            : "Vídeo encontrado"}
                  </p>
                  <details>
                    <summary>Origem e licença</summary>
                    <p className="break-words">{video.description}</p>
                    <p>
                      YouTube · Licença informada:{" "}
                      {video.platformLicense ?? "Não informada"} · Publicação:{" "}
                      {new Date(video.publishedAt).toLocaleDateString("pt-BR")}
                    </p>
                    <p>{video.importNote}</p>
                  </details>
                  <a
                    href={video.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-sky-200 underline"
                  >
                    Abrir vídeo original
                  </a>
                  <button
                    className={`${button} ml-2`}
                    disabled={
                      blocked ||
                      !!candidate ||
                      video.eligibility === "UNAVAILABLE"
                    }
                    onClick={() => void select(video)}
                  >
                    Selecionar candidato
                  </button>
                </article>
              );
            })}
          </div>
          {result.items.length === 0 && <p>Nenhum resultado encontrado.</p>}
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={blocked || !result.previousPageToken}
              onClick={() => void search(result.previousPageToken)}
            >
              Página anterior da pesquisa
            </button>
            <button
              className={button}
              disabled={blocked || !result.nextPageToken}
              onClick={() => void search(result.nextPageToken)}
            >
              Próxima página da pesquisa
            </button>
          </div>
        </>
      )}
      <details open className="space-y-3">
        <summary className="cursor-pointer text-lg font-semibold">
          Importar arquivo local
        </summary>
        <p className="text-sm text-muted-foreground">
          MP4, MOV, WebM ou MKV · até{" "}
          {settings ? Math.round(settings.maxBytes / 1024 / 1024) : "…"} MiB.
          Envie material obtido legitimamente; não há download de plataformas.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void upload();
          }}
          className="space-y-3"
        >
          <fieldset disabled={blocked} className="space-y-3">
            <label className="block">
              Fonte que receberá o arquivo
              <select
                aria-label="Fonte para importar"
                className={input}
                value={effectiveTarget}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option
                  value=""
                  disabled={
                    project.mode === "SINGLE_SOURCE" &&
                    project.sources.length > 0
                  }
                >
                  Criar nova fonte local
                </option>
                {project.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Arquivo de vídeo
              <input
                aria-label="Arquivo de vídeo"
                ref={fileInput}
                className={`${input} max-w-full text-sm`}
                type="file"
                accept=".mp4,.mov,.webm,.mkv"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <RightsFields value={rights} onChange={setRights} />
            <button
              className={button}
              type="submit"
              disabled={!file || !settings}
            >
              Importar vídeo autorizado
            </button>
          </fieldset>
        </form>
        {progress !== null && (
          <div role="status">
            <p>
              {progress < 100
                ? `Enviando arquivo: ${progress}%`
                : "Arquivo enviado. Validando formato e metadados…"}
            </p>
            <progress className="w-full" max="100" value={progress} />
            <button className={button} onClick={() => active.current?.abort()}>
              Cancelar envio
            </button>
          </div>
        )}
      </details>
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Arquivos importados</h3>
        {(project.files ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum arquivo importado neste projeto.
          </p>
        )}
        {(project.files ?? []).map((f) => (
          <article
            key={f.id}
            className="min-w-0 space-y-2 rounded border border-border p-3 text-sm"
          >
            <strong className="break-all">{f.originalName}</strong>
            {f.available === false && (
              <p className="text-amber-200">Arquivo indisponível no storage.</p>
            )}
            <p>
              {f.extension.toUpperCase()} ·{" "}
              {(f.byteSize / 1024 / 1024).toFixed(2)} MiB ·{" "}
              {f.durationSeconds.toFixed(2)}s · {f.width} × {f.height} ·{" "}
              {f.fps.toFixed(2)} FPS · {f.codec}
            </p>
            <a
              href={remixFileUrl(f.url)}
              target="_blank"
              rel="noreferrer"
              className="text-sky-200 underline"
            >
              Abrir arquivo original
            </a>
            <button
              className={`${button} ml-2`}
              disabled={blocked}
              onClick={() => {
                if (
                  window.confirm(
                    "Excluir esta cópia importada do storage e desvinculá-la das fontes?",
                  )
                )
                  void run(async () => {
                    await remixImport.remove(project, f.id);
                    await onChanged();
                    setMessage("Exclusão registrada.");
                  });
              }}
            >
              Excluir arquivo importado
            </button>
          </article>
        ))}
      </div>
      {project.sources.length > 0 && (project.files ?? []).length > 0 && (
        <form
          className="space-y-3 rounded border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await remixImport.attach(
                project,
                attachment.sourceId,
                attachment.fileId,
                rights,
              );
              await onChanged();
              setMessage(
                "Arquivo associado à fonte com declaração de direitos.",
              );
            });
          }}
        >
          <h3 className="font-semibold">Associar arquivo já importado</h3>
          <fieldset disabled={blocked} className="space-y-3">
            <label className="block">
              Fonte
              <select
                aria-label="Fonte para associação"
                className={input}
                required
                value={attachment.sourceId}
                onChange={(e) =>
                  setAttachment((v) => ({ ...v, sourceId: e.target.value }))
                }
              >
                <option value="">Selecione</option>
                {project.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Arquivo
              <select
                aria-label="Arquivo para associação"
                className={input}
                required
                value={attachment.fileId}
                onChange={(e) =>
                  setAttachment((v) => ({ ...v, fileId: e.target.value }))
                }
              >
                <option value="">Selecione</option>
                {project.files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.originalName}
                  </option>
                ))}
              </select>
            </label>
            <RightsFields value={rights} onChange={setRights} />
            <button className={button}>Associar arquivo autorizado</button>
          </fieldset>
        </form>
      )}
      {project.sources.some((s) => s.importedFileId) && (
        <div className="space-y-2">
          <h3 className="font-semibold">Associações e declarações</h3>
          {project.sources
            .filter((s) => s.importedFileId)
            .map((s) => (
              <div
                className="space-y-2 rounded border border-border p-3"
                key={s.id}
              >
                <strong className="break-words">{s.title}</strong>
                <p className="break-words text-sm">
                  Evidência informada: {s.licensing.evidence ?? "—"} · Registro:{" "}
                  {s.licensing.verifiedAt
                    ? new Date(s.licensing.verifiedAt).toLocaleString("pt-BR")
                    : "—"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={blocked}
                    onClick={() =>
                      void run(async () => {
                        await remixImport.unlink(project, s.id);
                        await onChanged();
                      })
                    }
                  >
                    Desvincular arquivo
                  </button>
                  <button
                    className={button}
                    disabled={blocked}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Retirar a declaração de direitos e tornar esta fonte indisponível para processamento?",
                        )
                      )
                        void run(async () => {
                          await remixImport.withdraw(project, s.id);
                          await onChanged();
                        });
                    }}
                  >
                    Retirar declaração de direitos
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
export function RightsFields({ value, onChange }) {
  const set = (key, next) => onChange((v) => ({ ...v, [key]: next }));
  return (
    <div className="space-y-3">
      <label className="block">
        Direitos de uso
        <select
          aria-label="Direitos de uso"
          className={input}
          required
          value={value.authorization}
          onChange={(e) => set("authorization", e.target.value)}
        >
          <option value="">Selecione a autorização</option>
          <option value="OWNED">Conteúdo próprio</option>
          <option value="AUTHORIZED">Uso autorizado</option>
          <option value="PUBLIC_DOMAIN">Domínio público</option>
        </select>
      </label>
      <label className="block">
        Autor / canal
        <input
          aria-label="Autor ou canal"
          className={input}
          maxLength={200}
          value={value.author}
          onChange={(e) => set("author", e.target.value)}
        />
      </label>
      <label className="block">
        Tipo de licença
        <input
          aria-label="Tipo de licença"
          className={input}
          maxLength={200}
          value={value.licenseType}
          onChange={(e) => set("licenseType", e.target.value)}
        />
      </label>
      <label className="block">
        Evidência ou referência da autorização
        <textarea
          aria-label="Evidência da autorização"
          className={input}
          required
          maxLength={2000}
          value={value.evidence}
          onChange={(e) => set("evidence", e.target.value)}
        />
      </label>
      <label className="block">
        Observações
        <textarea
          aria-label="Observações de direitos"
          className={input}
          maxLength={2000}
          value={value.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          required
          checked={value.userDeclaredRights}
          onChange={(e) => set("userDeclaredRights", e.target.checked)}
        />{" "}
        Declaro que possuo os direitos ou autorização para utilizar este
        conteúdo.
      </label>
      <p className="text-xs text-muted-foreground">
        A declaração será registrada e não constitui prova automática de
        licenciamento.
      </p>
    </div>
  );
}
