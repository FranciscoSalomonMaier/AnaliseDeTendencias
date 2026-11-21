import { NarrationMode, narrationMode } from "./NarrationMode";
import { EditingConfiguration } from "./EditingConfiguration";
import { editingMode } from "./editorialConfiguration";
import { Soundtrack } from "./Soundtrack";
import { EditingReferences } from "./EditingReferences";
import { useEffect, useRef, useState } from "react";
import { shorts, shortMediaUrl } from "../../services/shortCreationService";
import { publications } from "../../services/publicationService";
const steps = [
  "Criar roteiro",
  "Vídeos para montagem",
  "Configuração de edição",
  "Texto da narração",
  "Gerar narração",
  "Editar vídeo",
  "Trilha sonora",
  "Renderizar Short",
  "Resultado",
];
const field =
  "mt-2 block w-full rounded-lg border border-border bg-background p-3 text-white";
const button =
  "rounded-lg border border-sky-400/40 px-4 py-2 text-sm disabled:opacity-40";
const primary = button + " bg-sky-500/15";
const time = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const scriptEmpty = { introduction: "", development: "", conclusion: "" };
export function CreateShort() {
  const [project, setProject] = useState(null),
    [items, setItems] = useState([]),
    [options, setOptions] = useState(null),
    [optionsLoading, setOptionsLoading] = useState(true),
    [optionsError, setOptionsError] = useState(""),
    [revisionConflict, setRevisionConflict] = useState(false),
    [description, setDescription] = useState(""),
    [duration, setDuration] = useState(45),
    [draft, setDraft] = useState(scriptEmpty),
    [text, setText] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [login, setLogin] = useState(false),
    [accessKey, setAccessKey] = useState(""),
    [rights, setRights] = useState(false),
    [semantic, setSemantic] = useState(false),
    [uploading, setUploading] = useState("");
  const projectRef = useRef(null),
    dirtyRef = useRef(false),
    flight = useRef(false);
  const accept = (p) => {
    projectRef.current = p;
    setProject(p);
    setRevisionConflict(false);
    if (!dirtyRef.current) {
      setDraft(p.data.script ?? scriptEmpty);
      setText(p.data.narrationText ?? "");
    }
  };
  const edit = () => {
    dirtyRef.current = true;
    setDirty(true);
  };
  const clean = () => {
    dirtyRef.current = false;
    setDirty(false);
  };
  const fail = (e) => {
    setError(e.message);
    if (e.status === 401) setLogin(true);
    if (e.status === 409) setRevisionConflict(true);
  };
  const updateUrl = (id) => {
    const params = new URLSearchParams({
      page: "create-short",
      ...(id ? { shortProjectId: id } : {}),
    });
    window.history.pushState({}, "", `${window.location.pathname}?${params}`);
  };
  async function loadList() {
    const data = await shorts.list();
    setItems(data.items);
  }
  async function open(id) {
    if (
      dirtyRef.current &&
      !window.confirm("Descartar as alterações não salvas?")
    )
      return;
    clean();
    accept(await shorts.get(id));
    updateUrl(id);
    setError("");
  }
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const [config, list] = await Promise.allSettled([
          shorts.options(),
          shorts.list(),
        ]);
        if (!active) return;
        if (config.status === "fulfilled") setOptions(config.value);
        else {
          setOptionsError(config.reason.message);
          if (config.reason.status === 401) fail(config.reason);
        }
        setOptionsLoading(false);
        if (list.status === "rejected") throw list.reason;
        setItems(list.value.items);
        const id = new URLSearchParams(window.location.search).get(
          "shortProjectId",
        );
        if (id) {
          const p = await shorts.get(id);
          if (active) accept(p);
        }
      } catch (e) {
        if (active) fail(e);
      }
    }
    void init();
    const timer = setInterval(() => {
      const p = projectRef.current;
      if (!p || !["QUEUED", "RUNNING"].includes(p.status)) return;
      void shorts
        .get(p.id)
        .then((fresh) => {
          if (active) accept(fresh);
        })
        .catch((e) => active && fail(e));
    }, 2000);
    const restore = () => {
      const id = new URLSearchParams(window.location.search).get(
        "shortProjectId",
      );
      if (id)
        void shorts
          .get(id)
          .then((p) => {
            clean();
            accept(p);
          })
          .catch(fail);
      else {
        clean();
        projectRef.current = null;
        setProject(null);
      }
    };
    const beforeNavigate = (e) => {
      if (
        dirtyRef.current &&
        !window.confirm("Há alterações não salvas. Deseja sair?")
      )
        e.preventDefault();
    };
    const unload = (e) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("content:before-navigate", beforeNavigate);
    window.addEventListener("beforeunload", unload);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("content:before-navigate", beforeNavigate);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  async function act(fn) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      fail(e);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function save(data) {
    const p = await shorts.save(projectRef.current, data);
    clean();
    accept(p);
    return p;
  }
  async function run(kind) {
    if (dirty) throw Error("Salve as alterações antes de gerar novamente.");
    if (
      kind !== "SCRIPT" &&
      projectRef.current &&
      editingMode(projectRef.current) === "EDITORIAL_CLASSIFICATION"
    )
      throw Error(
        "A execução da nova configuração ainda está em desenvolvimento. Utilize o fluxo legado para produzir agora.",
      );
    let p = projectRef.current;
    if (!p) {
      p = await shorts.create({
        description,
        targetSeconds: duration,
        editingMode: "EDITORIAL_CLASSIFICATION",
      });
      clean();
      accept(p);
      updateUrl(p.id);
      await loadList();
    }
    accept(await shorts.run(p, kind, semantic));
  }
  async function next() {
    const step = project.step;
    if (step === 1) await save({ script: draft, approve: "SCRIPT" });
    else if (step === 2) await save({ step: 3 });
    else if (step === 3) {
      if (editingMode(project) === "EDITORIAL_CLASSIFICATION")
        throw Error("A execução editorial ainda está em desenvolvimento.");
      await save(
        project.data.editing?.config && project.data.editing?.profiles?.length
          ? { approve: "EDITING" }
          : { skipReferences: true },
      );
    } else if (step === 4)
      await save(
        withoutNarration
          ? { step: 5 }
          : { narrationText: text, approve: "TEXT" },
      );
    else if (step === 6) await save({ approve: "PLAN" });
    else await save({ step: step + 1 });
  }
  function reset() {
    if (dirty && !window.confirm("Descartar alterações não salvas?")) return;
    clean();
    projectRef.current = null;
    setProject(null);
    setDescription("");
    setDuration(45);
    setDraft(scriptEmpty);
    setText("");
    setRights(false);
    setError("");
    updateUrl(null);
    void loadList().catch(fail);
  }
  const withoutNarration = narrationMode(project) === "WITHOUT_NARRATION";
  const step = project?.step ?? 1;
  const locked = busy || ["QUEUED", "RUNNING"].includes(project?.status);
  const canNext =
    step === 1
      ? Object.values(draft).every((v) => v.trim())
      : step === 2
        ? project.files.length > 0
        : step === 3
          ? !dirty && editingMode(project) === "LEGACY_REFERENCE"
          : step === 4
            ? withoutNarration || Boolean(text.trim())
            : step === 5
              ? !withoutNarration && Boolean(project.data.audio)
              : step === 6
                ? Boolean(project.data.plan?.clips.length)
                : step === 7
                  ? !dirty
                  : step === 8
                    ? Boolean(project.data.output)
                    : false;
  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Criar Short</h1>
          {project && (
            <button className={button} disabled={locked} onClick={reset}>
              Meus Shorts
            </button>
          )}
        </header>
        {login ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await publications.login(accessKey);
                setAccessKey("");
                window.location.reload();
              });
            }}
          >
            <p>Entre com a chave de acesso configurada para este sistema.</p>
            {error && <p role="alert">{error}</p>}
            <input
              aria-label="Chave de acesso"
              type="password"
              autoComplete="current-password"
              className={field}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
            <button className={button} disabled={busy}>
              Entrar
            </button>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Etapa {step} de 9 · {steps[step - 1]}
              {step === 5 && withoutNarration ? " · Dispensada" : ""}
            </p>
            {error && (
              <p
                role="alert"
                className="rounded border border-red-400/40 p-3 text-red-200"
              >
                {error}
              </p>
            )}
            {revisionConflict && (
              <button
                className={button}
                disabled={locked}
                onClick={() =>
                  void act(async () => {
                    if (
                      dirty &&
                      !window.confirm(
                        "Recarregar o projeto e descartar suas alterações locais?",
                      )
                    )
                      return;
                    const fresh = await shorts.get(project.id);
                    clean();
                    accept(fresh);
                    setError("");
                  })
                }
              >
                Recarregar projeto
              </button>
            )}
            {project && step > 3 && (
              <button
                className={button}
                disabled={locked}
                onClick={() =>
                  void act(async () => {
                    if (dirty)
                      throw Error(
                        "Salve suas alterações antes de voltar à configuração.",
                      );
                    await save({ step: 3 });
                  })
                }
              >
                Revisar configuração de edição
              </button>
            )}
            {project?.error_message && (
              <p role="alert" className="rounded border border-red-400/40 p-3">
                {project.error_message} Uma nova tentativa pode consumir a API
                novamente.
              </p>
            )}
            {locked && (
              <div role="status">
                <p>
                  {uploading
                    ? `Enviando ${uploading}…`
                    : project?.status === "QUEUED"
                      ? "Na fila…"
                      : "Processando…"}
                </p>
                {project?.job && (
                  <progress
                    className="mt-2 w-full"
                    max="100"
                    value={project.job.progress}
                  />
                )}
              </div>
            )}
            <section className="space-y-5" aria-label={steps[step - 1]}>
              {step === 1 && (
                <>
                  <label className="block">
                    Sobre o que será o Short?
                    <textarea
                      className={`${field} min-h-32`}
                      maxLength={6000}
                      value={project?.description ?? description}
                      disabled={locked || Boolean(project)}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    Duração desejada
                    <select
                      className={field}
                      value={project?.target_seconds ?? duration}
                      disabled={locked || Boolean(project)}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      {[30, 45, 60].map((n) => (
                        <option key={n} value={n}>
                          {n} segundos
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-muted-foreground">
                    A geração usa sua API de IA. Revise informações factuais
                    antes de aprovar.
                  </p>
                  <button
                    className={primary}
                    disabled={
                      locked ||
                      dirty ||
                      !options?.aiEnabled ||
                      (!project && description.trim().length < 10)
                    }
                    onClick={() => void act(() => run("SCRIPT"))}
                  >
                    {project?.data.script
                      ? "Regenerar roteiro"
                      : "Gerar roteiro"}
                  </button>
                  {!options?.aiEnabled && (
                    <p>
                      Geração com IA indisponível. Configure a chave e o modelo
                      no servidor.
                    </p>
                  )}
                  {project && (
                    <>
                      {[
                        ["introduction", "Introdução"],
                        ["development", "Desenvolvimento"],
                        ["conclusion", "Conclusão"],
                      ].map(([key, label]) => (
                        <label key={key} className="block">
                          {label}
                          <textarea
                            className={`${field} min-h-24`}
                            value={draft[key]}
                            disabled={locked}
                            maxLength={
                              key === "development"
                                ? 2500
                                : key === "conclusion"
                                  ? 1000
                                  : 1500
                            }
                            onChange={(e) => {
                              setDraft({ ...draft, [key]: e.target.value });
                              edit();
                            }}
                          />
                        </label>
                      ))}
                      <button
                        className={button}
                        disabled={
                          locked ||
                          !dirty ||
                          !Object.values(draft).every((v) => v.trim())
                        }
                        onClick={() => void act(() => save({ script: draft }))}
                      >
                        Salvar roteiro
                      </button>
                    </>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <p>
                    Envie os vídeos que serão recortados e usados no Short
                    final.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    MP4, MOV ou WebM · até {options?.maxFiles} vídeos ·{" "}
                    {Math.round((options?.maxBytes ?? 0) / 1024 ** 2)} MB por
                    arquivo · até {time(options?.maxDuration ?? 0)} por vídeo.
                  </p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={rights}
                      disabled={locked}
                      onChange={(e) => setRights(e.target.checked)}
                    />
                    Confirmo que tenho autorização para utilizar os materiais
                    enviados.
                  </label>
                  <label className="block">
                    Selecionar vídeos
                    <input
                      aria-label="Enviar vídeos"
                      className={field}
                      type="file"
                      multiple
                      accept=".mp4,.mov,.webm"
                      disabled={locked || !rights}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        void act(async () => {
                          if (
                            files.length + project.files.length >
                            (options?.maxFiles ?? 5)
                          )
                            throw Error(
                              "Quantidade de vídeos acima do limite.",
                            );
                          try {
                            for (const file of files) {
                              if (file.size > (options?.maxBytes ?? 0))
                                throw Error(
                                  `${file.name}: arquivo acima do limite.`,
                                );
                              setUploading(file.name);
                              accept(await shorts.upload(project.id, file));
                            }
                          } finally {
                            setUploading("");
                          }
                        });
                      }}
                    />
                  </label>
                  <ul className="divide-y divide-border">
                    {project.files.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <p className="break-all">{f.original_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {time(f.duration)} ·{" "}
                            {(f.bytes / 1024 ** 2).toFixed(1)} MB · Enviado
                          </p>
                        </div>
                        <button
                          className={button}
                          disabled={locked}
                          onClick={() =>
                            void act(async () =>
                              accept(await shorts.removeFile(project.id, f.id)),
                            )
                          }
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {step === 3 && (
                <div className="space-y-6">
                  {editingMode(project) === "EDITORIAL_CLASSIFICATION" ? (
                    <EditingConfiguration
                      key={`${project.id}:${project.revision}`}
                      project={project}
                      options={options}
                      loading={optionsLoading}
                      error={optionsError}
                      locked={locked}
                      dirty={dirty}
                      onDirty={edit}
                      onSave={(data) => act(() => save(data))}
                      onRetry={() =>
                        void act(async () => {
                          setOptionsLoading(true);
                          setOptionsError("");
                          try {
                            setOptions(await shorts.options());
                          } catch (e) {
                            setOptionsError(e.message);
                            throw e;
                          } finally {
                            setOptionsLoading(false);
                          }
                        })
                      }
                    />
                  ) : (
                    <>
                      <h2 className="text-xl font-semibold">
                        Configuração de edição
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Fluxo legado de referências. As preferências da nova
                        configuração não serão aplicadas aqui.
                      </p>
                      <EditingReferences
                        key={`${project.id}:${project.revision}`}
                        project={project}
                        options={options}
                        locked={locked}
                        dirty={dirty}
                        onDirty={edit}
                        onSave={(data) => void act(() => save(data))}
                        onRemove={(file) =>
                          void act(async () =>
                            accept(
                              await shorts.removeReference(project.id, file),
                            ),
                          )
                        }
                        onAnalyze={() => void act(() => run("REFERENCES"))}
                        onSkip={() =>
                          void act(() => save({ skipReferences: true }))
                        }
                        onUpload={(files) =>
                          void act(async () => {
                            if (
                              files.length + (project.references?.length ?? 0) >
                              (options?.referenceMaxFiles ?? 3)
                            )
                              throw Error(
                                "Quantidade de referências acima do limite.",
                              );
                            try {
                              for (const file of files) {
                                setUploading(file.name);
                                accept(
                                  await shorts.uploadReference(
                                    project.id,
                                    file,
                                  ),
                                );
                              }
                            } finally {
                              setUploading("");
                            }
                          })
                        }
                      />
                    </>
                  )}
                  <details className="border-t border-border pt-4">
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Outras opções de edição
                    </summary>
                    <p className="mt-3 text-sm text-muted-foreground">
                      A troca preserva referências, preferências e resultados
                      existentes. Cada modalidade utiliza suas próprias
                      configurações.
                    </p>
                    <button
                      className={`${button} mt-3`}
                      disabled={locked}
                      onClick={() => {
                        const target =
                          editingMode(project) === "EDITORIAL_CLASSIFICATION"
                            ? "LEGACY_REFERENCE"
                            : "EDITORIAL_CLASSIFICATION";
                        const message = `${dirty ? "Descartar as alterações não salvas e " : ""}${target === "LEGACY_REFERENCE" ? "usar o fluxo legado para produzir o Short? A nova configuração ficará guardada e não será aplicada." : "usar a nova configuração? Suas referências serão preservadas, mas a execução editorial ainda está em desenvolvimento."}`;
                        if (window.confirm(message))
                          void act(() => save({ editingMode: target }));
                      }}
                    >
                      {editingMode(project) === "EDITORIAL_CLASSIFICATION"
                        ? "Usar fluxo legado de referências"
                        : "Usar nova configuração editorial"}
                    </button>
                  </details>
                </div>
              )}
              {step === 4 && (
                <>
                  <NarrationMode
                    project={project}
                    disabled={locked || dirty}
                    onChange={(narration) =>
                      void act(() => save({ narration }))
                    }
                  />
                  {withoutNarration ? (
                    <p role="status">
                      Narração dispensada. Texto e geração de voz não são
                      necessários. A montagem sem narração ainda não está
                      disponível no fluxo atual.
                    </p>
                  ) : (
                    <>
                      <p>
                        Transforme o roteiro aprovado em um texto natural para
                        narração.
                      </p>
                      <button
                        className={primary}
                        disabled={locked || dirty || !options?.aiEnabled}
                        onClick={() => void act(() => run("TEXT"))}
                      >
                        {project.data.narrationText
                          ? "Regenerar texto"
                          : "Gerar texto da narração"}
                      </button>
                      <label className="block">
                        Texto da narração
                        <textarea
                          className={`${field} min-h-64`}
                          maxLength={4096}
                          value={text}
                          disabled={locked}
                          onChange={(e) => {
                            setText(e.target.value);
                            edit();
                          }}
                        />
                      </label>
                      <button
                        className={button}
                        disabled={locked || !dirty || !text.trim()}
                        onClick={() =>
                          void act(() => save({ narrationText: text }))
                        }
                      >
                        Salvar texto
                      </button>
                    </>
                  )}
                </>
              )}
              {step === 5 && withoutNarration && (
                <p role="status">
                  Etapa dispensada — nenhuma voz será gerada. A montagem, a
                  trilha sonora e a renderização sem narração ainda não estão
                  disponíveis. Volte para alterar o modo; o conteúdo anterior
                  foi preservado.
                </p>
              )}
              {step === 5 && !withoutNarration && (
                <>
                  <p>
                    O áudio será gerado somente a partir do texto aprovado. A
                    voz é produzida por IA.
                  </p>
                  <label className="block">
                    Voz
                    <select
                      className={field}
                      value={project.data.voice ?? "cedar"}
                      disabled={locked}
                      onChange={(e) =>
                        void act(() => save({ voice: e.target.value }))
                      }
                    >
                      {options?.voices.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={primary}
                    disabled={locked}
                    onClick={() => void act(() => run("AUDIO"))}
                  >
                    {project.data.audio
                      ? "Regenerar narração"
                      : "Gerar narração"}
                  </button>
                  {project.data.audio && (
                    <>
                      <audio
                        className="w-full"
                        controls
                        src={shortMediaUrl(project.data.audio.url)}
                      />
                      <p>
                        Duração real: {project.data.audio.duration.toFixed(1)}{" "}
                        segundos.
                      </p>
                      {Math.abs(
                        project.data.audio.duration - project.target_seconds,
                      ) > Math.max(5, project.target_seconds * 0.2) && (
                        <p role="status">
                          A duração difere do alvo. Você pode voltar e ajustar o
                          texto; a montagem seguirá a duração real do áudio.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {step === 6 && (
                <>
                  <p>
                    Selecione automaticamente os cortes dos seus vídeos para
                    acompanhar a narração.
                  </p>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={semantic}
                      disabled={locked || !options?.aiEnabled}
                      onChange={(e) => setSemantic(e.target.checked)}
                    />
                    Usar análise visual com IA (consome sua API)
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Sem essa opção, a montagem distribui trechos dos arquivos,
                    sem compreensão semântica. A seleção examina até{" "}
                    {time(options?.scanSeconds ?? 600)} de cada vídeo.
                  </p>
                  {project.data.editing?.enabled &&
                    project.data.editing.approved && (
                      <p className="text-sm text-muted-foreground">
                        A edição aplicará o perfil aprovado. Legendas e textos
                        na tela podem consumir transcrição e IA ao selecionar os
                        trechos.
                      </p>
                    )}
                  <button
                    className={primary}
                    disabled={locked}
                    onClick={() => void act(() => run("PLAN"))}
                  >
                    {project.data.plan
                      ? "Refazer seleção"
                      : "Selecionar trechos"}
                  </button>
                  {project.data.plan && (
                    <>
                      <p role="status">{project.data.plan.notice}</p>
                      {project.data.decorations?.warnings.map((warning, i) => (
                        <p role="status" key={i}>
                          {warning}
                        </p>
                      ))}
                      {project.data.decorations && (
                        <p>
                          Legendas:{" "}
                          {project.data.decorations.granularity === "WORD"
                            ? "timestamps reais de palavras"
                            : "timestamps reais de segmentos"}
                          .
                        </p>
                      )}
                      {project.data.decorations?.overlays.map((overlay, i) => (
                        <p key={i}>
                          Texto na tela: {overlay.text} ·{" "}
                          {overlay.start.toFixed(1)}–{overlay.end.toFixed(1)}s
                        </p>
                      ))}
                      <ol className="divide-y divide-border">
                        {project.data.plan.clips.map((clip, i) => {
                          const f = project.files.find(
                            (f) => f.id === clip.fileId,
                          );
                          return (
                            <li
                              key={`${clip.fileId}-${i}`}
                              className="space-y-2 py-3"
                            >
                              <p>
                                {i + 1}. {f?.original_name} ·{" "}
                                {clip.start.toFixed(1)}–{clip.end.toFixed(1)}s
                              </p>
                              <p className="text-sm">{clip.description}</p>
                              {f && (
                                <video
                                  className="max-h-52 w-full rounded bg-black"
                                  controls
                                  preload="none"
                                  src={`${shortMediaUrl(f.url)}#t=${clip.start},${clip.end}`}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </>
              )}
              {step === 7 && (
                <Soundtrack
                  key={`${project.id}:${project.revision}`}
                  project={project}
                  options={options}
                  locked={locked}
                  dirty={dirty}
                  onDirty={edit}
                  onSave={(data) => void act(() => save(data))}
                  onUpload={(file) =>
                    void act(async () => {
                      try {
                        setUploading(file.name);
                        accept(await shorts.uploadMusic(project, file));
                      } finally {
                        setUploading("");
                      }
                    })
                  }
                  onRemove={() =>
                    void act(async () =>
                      accept(await shorts.removeMusic(project)),
                    )
                  }
                  onSkip={() =>
                    void act(() => save({ skipMusic: true, step: 8 }))
                  }
                />
              )}
              {step === 8 && (
                <>
                  <p>
                    Seu Short será montado em formato vertical, usando os cortes
                    aprovados, a narração e a trilha sonora habilitada.
                  </p>
                  <label className="block">
                    Enquadramento
                    <select
                      className={field}
                      value={project.data.framing ?? "CROP"}
                      disabled={locked}
                      onChange={(e) =>
                        void act(() => save({ framing: e.target.value }))
                      }
                    >
                      <option value="CROP">
                        Recorte vertical centralizado
                      </option>
                      <option value="BLUR">
                        Vídeo inteiro com fundo desfocado
                      </option>
                    </select>
                  </label>
                  <button
                    className={primary}
                    disabled={locked}
                    onClick={() => void act(() => run("RENDER"))}
                  >
                    Renderizar Short
                  </button>
                </>
              )}
              {step === 9 && project.data.output && (
                <>
                  <video
                    className="mx-auto max-h-[65vh] w-full rounded bg-black"
                    controls
                    src={shortMediaUrl(project.data.output.url)}
                  />
                  <p>
                    {project.data.output.duration.toFixed(1)}s ·{" "}
                    {(project.data.output.bytes / 1024 ** 2).toFixed(1)} MB ·{" "}
                    {project.data.output.width} × {project.data.output.height}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Salvo em{" "}
                    {new Date(project.data.output.createdAt).toLocaleString(
                      "pt-BR",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      className={primary}
                      href={shortMediaUrl(project.data.output.downloadUrl)}
                    >
                      Baixar MP4
                    </a>
                    <button className={button} onClick={reset}>
                      Criar outro Short
                    </button>
                  </div>
                </>
              )}
            </section>
            {project && (
              <nav
                aria-label="Etapas"
                className="flex justify-between gap-3 border-t border-border pt-4"
              >
                <button
                  className={button}
                  disabled={locked || step === 1}
                  onClick={() =>
                    void act(async () => {
                      if (dirty)
                        throw Error("Salve suas alterações antes de voltar.");
                      await save({ step: step - 1 });
                    })
                  }
                >
                  Voltar
                </button>
                {step < 9 &&
                  !(
                    step === 3 &&
                    editingMode(project) === "EDITORIAL_CLASSIFICATION"
                  ) && (
                    <button
                      className={primary}
                      disabled={locked || !canNext}
                      onClick={() => void act(next)}
                    >
                      {step === 4 && withoutNarration
                        ? "Dispensar narração e continuar"
                        : [1, 4, 6].includes(step)
                          ? "Aprovar e continuar"
                          : "Continuar"}
                    </button>
                  )}
              </nav>
            )}
            {!project && (
              <section className="space-y-3 border-t border-border pt-6">
                <h2 className="text-xl font-semibold">Meus Shorts</h2>
                {items.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum Short salvo ainda.
                  </p>
                )}
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <li className="space-y-2 py-4" key={item.id}>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(item.created_at).toLocaleString("pt-BR")} ·{" "}
                        {item.status === "COMPLETED"
                          ? "Concluído"
                          : item.status === "FAILED"
                            ? "Falhou"
                            : ["QUEUED", "RUNNING"].includes(item.status)
                              ? "Processando"
                              : `Etapa ${item.step} de 9`}
                        {item.duration
                          ? ` · ${Number(item.duration).toFixed(1)}s`
                          : ""}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => void act(() => open(item.id))}
                        >
                          {item.status === "COMPLETED"
                            ? "Visualizar"
                            : "Continuar"}
                        </button>
                        {item.status === "COMPLETED" && (
                          <a
                            className={button}
                            href={shortMediaUrl(
                              `/shorts/${item.id}/video?download=1`,
                            )}
                          >
                            Baixar
                          </a>
                        )}
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Excluir este Short e seus arquivos?",
                              )
                            )
                              void act(async () => {
                                await shorts.remove(item.id);
                                await loadList();
                              });
                          }}
                        >
                          Excluir
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
