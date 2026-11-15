import { useEffect, useRef, useState } from "react";
import {
  remixAssembly,
  remixStory,
  remixFileUrl,
} from "../../services/videoRemixService";
import { remixTimestamp } from "../../utils/videoRemix";
const button = "rounded-lg border border-border px-3 py-2 disabled:opacity-50";
const field =
  "w-full min-w-0 rounded-lg border border-border bg-background px-2 py-2";
const modes = {
  CENTER_CROP: "Recorte central",
  BLURRED_BACKGROUND: "Fundo desfocado",
  MANUAL_CROP: "Recorte manual",
};
const phases = {
  QUEUED: "Na fila",
  RUNNING: "Renderizando",
  PREPARING_AUDIO: "Preparando narração",
  CUTTING: "Extraindo cortes",
  TRANSITIONS: "Aplicando transições",
  JOINING: "Montando vídeo",
  ENCODING: "Codificando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};
const cutFields = [
  "id",
  "segmentId",
  "candidateId",
  "sourceStart",
  "sourceEnd",
  "speed",
  "freeze",
  "framing",
  "transition",
  "transitionSeconds",
  "zoom",
];
export function RemixAssemblyPanel({ project, disabled }) {
  const [scripts, setScripts] = useState([]),
    [scriptId, setScriptId] = useState(""),
    [versions, setVersions] = useState([]),
    [timeline, setTimeline] = useState(null),
    [jobs, setJobs] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [review, setReview] = useState(false),
    [editCaptions, setEditCaptions] = useState(false);
  const current = useRef(null),
    dirtyRef = useRef(false),
    seen = useRef(new Set());
  async function refresh() {
    const [h, v, j] = await Promise.all([
      remixStory.history(project.id),
      remixAssembly.list(project.id),
      remixAssembly.renders(project.id),
    ]);
    setScripts(h.items);
    setScriptId((old) => old || h.items[0]?.id || "");
    setVersions(v.items);
    setJobs(j.items);
    return v;
  }
  async function open(id) {
    const t = await remixAssembly.get(project.id, id);
    setTimeline(t);
    current.current = id;
    dirtyRef.current = false;
    setDirty(false);
    setReview(false);
    setEditCaptions(false);
  }
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    Promise.all([
      remixStory.history(project.id),
      remixAssembly.list(project.id),
      remixAssembly.renders(project.id),
    ])
      .then(async ([h, v, j]) => {
        if (!live) return;
        setScripts(h.items);
        setScriptId(h.items[0]?.id || "");
        setVersions(v.items);
        setJobs(j.items);
        j.items
          .filter((x) => x.status === "COMPLETED")
          .forEach((x) => seen.current.add(x.id));
        if (v.items[0]) {
          const t = await remixAssembly.get(project.id, v.items[0].id);
          if (live) {
            setTimeline(t);
            current.current = t.id;
          }
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [project.id]);
  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      remixAssembly
        .renders(project.id)
        .then(async (j) => {
          if (!live) return;
          setJobs(j.items);
          const finished = j.items.find(
            (x) =>
              x.status === "COMPLETED" &&
              x.timeline_id === current.current &&
              !seen.current.has(x.id),
          );
          j.items
            .filter((x) => x.status === "COMPLETED")
            .forEach((x) => seen.current.add(x.id));
          if (finished && !dirtyRef.current) {
            const t = await remixAssembly.get(project.id, current.current);
            if (live && !dirtyRef.current) setTimeline(t);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [project.id]);
  function change(updater) {
    setTimeline((t) => ({ ...t, data: updater(t.data) }));
    setDirty(true);
    dirtyRef.current = true;
    setReview(false);
  }
  function config(key, value) {
    change((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  }
  function item(id, key, value) {
    change((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, [key]: value } : i)),
    }));
  }
  function move(index, delta) {
    change((d) => {
      const items = [...d.items];
      [items[index], items[index + delta]] = [
        items[index + delta],
        items[index],
      ];
      return { ...d, items };
    });
  }
  async function save() {
    const data = timeline.data;
    const subtitles = editCaptions
      ? timeline.captions.map(
          ({ id, order, text, startSeconds, endSeconds }) => ({
            id,
            order,
            text,
            startSeconds,
            endSeconds,
          }),
        )
      : data.subtitleOverrides;
    const t = await remixAssembly.save(project.id, timeline.id, {
      config: data.config,
      items: data.items.map((i) =>
        Object.fromEntries(cutFields.map((k) => [k, i[k]])),
      ),
      subtitles,
    });
    await refresh();
    await open(t.id);
  }
  const data = timeline?.data,
    configData = data?.config,
    locked = disabled || busy,
    active = jobs.some(
      (j) =>
        j.timeline_id === timeline?.id &&
        ["QUEUED", "RUNNING"].includes(j.status),
    ),
    blocked =
      locked ||
      dirty ||
      timeline?.stale ||
      !data?.items.length ||
      Boolean(data?.issues.length);
  const completed = jobs.filter(
      (j) => j.status === "COMPLETED" && j.timeline_id === timeline?.id,
    ),
    player = completed[0],
    hasPreview = completed.some((j) => j.kind === "PREVIEW");
  return (
    <details className="min-w-0 rounded-xl border border-border p-4" open>
      <summary className="cursor-pointer text-xl font-semibold">
        Montagem e Edição
      </summary>
      <div className="mt-4 min-w-0 space-y-4">
        <p>
          Monte os trechos selecionados usando a narração por segmento. Prévia:
          540 × 960. Exportação: 1080 × 1920, vertical 9:16, MP4 (H.264/AAC).
        </p>
        {error && (
          <p role="alert" className="break-words text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          className={button}
          disabled={locked}
          onClick={() => act(refresh)}
        >
          Atualizar montagem e roteiros
        </button>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            Roteiro
            <select
              aria-label="Roteiro da montagem"
              className={field}
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
            >
              {!scripts.length && (
                <option value="">Gere e narre um roteiro primeiro</option>
              )}
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  Roteiro v{s.version} · revisão {s.revision}
                </option>
              ))}
            </select>
          </label>
          <button
            className={button}
            disabled={locked || !scriptId}
            onClick={() =>
              act(async () => {
                const t = await remixAssembly.create(project.id, scriptId);
                await refresh();
                await open(t.id);
              })
            }
          >
            Criar timeline
          </button>
        </div>
        {!!versions.length && (
          <label className="block">
            Versão da timeline
            <select
              className={field}
              value={timeline?.id || ""}
              onChange={(e) => act(() => open(e.target.value))}
              disabled={locked || dirty}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Timeline v{v.version}
                </option>
              ))}
            </select>
          </label>
        )}
        {data && (
          <>
            <p>
              Timeline v{timeline.version} · {remixTimestamp(data.duration)} ·
              Roteiro v{data.scriptVersion}, revisão {data.scriptRevision}
            </p>
            {timeline.stale && (
              <p role="alert">
                Roteiro, áudio ou fontes alterados. Crie uma nova timeline.
              </p>
            )}
            {data.issues.map((s, i) => (
              <p key={i} role="alert" className="text-amber-400">
                {s}
              </p>
            ))}
            {data.warnings.map((s, i) => (
              <p key={i} className="text-sm text-muted">
                {s}
              </p>
            ))}
            <p className="text-sm">
              A duração acompanha a narração completa. Reordene os cortes
              mantendo juntos os trechos de cada segmento. Após editar, salve
              para recalcular os tempos e verificar a sincronização.
            </p>
            <fieldset
              disabled={locked || timeline.stale}
              className="min-w-0 space-y-3"
            >
              <legend className="font-semibold">Trechos da timeline</legend>
              {data.items.map((i, index) => {
                const segment = data.segments.find((s) => s.id === i.segmentId),
                  source = project.sources.find((s) => s.id === i.sourceId);
                return (
                  <article
                    key={i.id}
                    className="min-w-0 space-y-3 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap gap-3">
                      <video
                        className="max-h-28 w-24 max-w-full rounded"
                        preload="metadata"
                        muted
                        src={remixFileUrl(
                          `/video-remix/projects/${project.id}/files/${i.fileId}/file`,
                        )}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.currentTime = i.sourceStart;
                        }}
                        aria-label={`Miniatura do trecho ${index + 1}`}
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="break-words font-semibold">
                          {index + 1}. {source?.title || "Fonte importada"}
                        </h4>
                        <p>
                          Timeline: {remixTimestamp(i.timelineStart)} →{" "}
                          {remixTimestamp(i.timelineEnd)} ·{" "}
                          {i.duration.toFixed(2)}s
                        </p>
                        <p className="break-words text-sm">
                          Narração: {segment?.text}
                        </p>
                        <p className="text-sm">
                          Áudio vinculado · {segment?.audioDuration.toFixed(2)}s
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label>
                        Início na fonte (s)
                        <input
                          className={field}
                          type="number"
                          min="0"
                          step="0.01"
                          value={i.sourceStart}
                          onChange={(e) =>
                            item(i.id, "sourceStart", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Fim na fonte (s)
                        <input
                          className={field}
                          type="number"
                          min="0"
                          step="0.01"
                          value={i.sourceEnd}
                          onChange={(e) =>
                            item(i.id, "sourceEnd", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Enquadramento
                        <select
                          className={field}
                          value={i.framing.mode}
                          onChange={(e) =>
                            item(i.id, "framing", {
                              ...i.framing,
                              mode: e.target.value,
                            })
                          }
                        >
                          {Object.entries(modes).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {i.framing.mode === "MANUAL_CROP" && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {["x", "y"].map((axis) => (
                          <label key={axis}>
                            Posição {axis === "x" ? "horizontal" : "vertical"}{" "}
                            (0–1)
                            <input
                              className={field}
                              type="number"
                              min="0"
                              max="1"
                              step="0.05"
                              value={i.framing[axis]}
                              onChange={(e) =>
                                item(i.id, "framing", {
                                  ...i.framing,
                                  [axis]: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label>
                        Transição
                        <select
                          className={field}
                          value={i.transition}
                          onChange={(e) =>
                            item(i.id, "transition", e.target.value)
                          }
                        >
                          <option value="CUT">Corte seco</option>
                          <option value="FADE">Fade de entrada e saída</option>
                          <option value="CROSSFADE">
                            Crossfade para o próximo
                          </option>
                        </select>
                      </label>
                      <label>
                        Transição (s)
                        <input
                          className={field}
                          type="number"
                          min="0.05"
                          max="0.5"
                          step="0.05"
                          value={i.transitionSeconds}
                          onChange={(e) =>
                            item(
                              i.id,
                              "transitionSeconds",
                              Number(e.target.value),
                            )
                          }
                        />
                      </label>
                      <label className="self-center">
                        <input
                          type="checkbox"
                          checked={i.zoom}
                          onChange={(e) => item(i.id, "zoom", e.target.checked)}
                        />{" "}
                        Zoom leve
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label>
                        Velocidade (0,9–1)
                        <input
                          className={field}
                          type="number"
                          min="0.9"
                          max="1"
                          step="0.01"
                          disabled={!configData.allowSlowdown}
                          value={i.speed}
                          onChange={(e) =>
                            item(i.id, "speed", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Congelar último frame (s)
                        <input
                          className={field}
                          type="number"
                          min="0"
                          max={configData.maxFreezeSeconds}
                          step="0.05"
                          value={i.freeze}
                          onChange={(e) =>
                            item(i.id, "freeze", Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={button}
                        disabled={!index}
                        onClick={() => move(index, -1)}
                      >
                        Subir trecho
                      </button>
                      <button
                        className={button}
                        disabled={index === data.items.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        Descer trecho
                      </button>
                      <button
                        className={button}
                        onClick={() =>
                          change((d) => ({
                            ...d,
                            items: d.items.filter((x) => x.id !== i.id),
                          }))
                        }
                      >
                        Remover trecho
                      </button>
                    </div>
                  </article>
                );
              })}
              <details>
                <summary className="cursor-pointer font-semibold">
                  Configurações de exportação e áudio
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label>
                    FPS
                    <select
                      className={field}
                      value={configData.fps}
                      onChange={(e) => config("fps", Number(e.target.value))}
                    >
                      <option value="30">30 FPS</option>
                      <option value="24">24 FPS</option>
                    </select>
                  </label>
                  <label>
                    Qualidade
                    <select
                      className={field}
                      value={configData.quality}
                      onChange={(e) => config("quality", e.target.value)}
                    >
                      <option value="STANDARD">Padrão</option>
                      <option value="HIGH">Alta</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={configData.allowSlowdown}
                      onChange={(e) =>
                        config("allowSlowdown", e.target.checked)
                      }
                    />{" "}
                    Permitir desaceleração até 10%
                  </label>
                  <label>
                    Limite de congelamento por corte (s)
                    <input
                      className={field}
                      type="number"
                      min="0"
                      max="1"
                      step="0.1"
                      value={configData.maxFreezeSeconds}
                      onChange={(e) =>
                        config("maxFreezeSeconds", Number(e.target.value))
                      }
                    />
                  </label>
                  {[
                    ["narrationVolume", "Volume da narração", 0.1, 2],
                    ["originalVolume", "Volume original (0 silencia)", 0, 1],
                    ["audioFadeSeconds", "Fade do áudio (s)", 0, 0.5],
                  ].map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        className={field}
                        type="number"
                        min={min}
                        max={max}
                        step="0.05"
                        value={configData[key]}
                        onChange={(e) => config(key, Number(e.target.value))}
                      />
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={configData.normalize}
                      onChange={(e) => config("normalize", e.target.checked)}
                    />{" "}
                    Normalizar narração
                  </label>
                </div>
              </details>
              <details>
                <summary className="cursor-pointer font-semibold">
                  Legendas
                </summary>
                <div className="mt-3 space-y-3">
                  <label>
                    <input
                      type="checkbox"
                      checked={configData.subtitles.enabled}
                      onChange={(e) =>
                        config("subtitles", {
                          ...configData.subtitles,
                          enabled: e.target.checked,
                        })
                      }
                    />{" "}
                    Ativar legendas tradicionais
                  </label>
                  <p>
                    Os tempos automáticos estimam frases usando pausas do áudio
                    e o texto conhecido. Não têm precisão por palavra. Revise a
                    prévia; ajuste os tempos se necessário.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["fontSize", "Tamanho da fonte", 24, 96, 1],
                      [
                        "verticalPosition",
                        "Posição vertical (0,2–0,9)",
                        0.2,
                        0.9,
                        0.01,
                      ],
                    ].map(([key, label, min, max, step]) => (
                      <label key={key}>
                        {label}
                        <input
                          className={field}
                          type="number"
                          min={min}
                          max={max}
                          step={step}
                          value={configData.subtitles[key]}
                          onChange={(e) =>
                            config("subtitles", {
                              ...configData.subtitles,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Cor
                      <input
                        className={field}
                        type="color"
                        value={configData.subtitles.textColor}
                        onChange={(e) =>
                          config("subtitles", {
                            ...configData.subtitles,
                            textColor: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Estilo
                      <select
                        className={field}
                        value={configData.subtitles.preset}
                        onChange={(e) =>
                          config("subtitles", {
                            ...configData.subtitles,
                            preset: e.target.value,
                          })
                        }
                      >
                        <option value="BOLD_SHORTS">Shorts</option>
                        <option value="CLASSIC">Clássico</option>
                        <option value="DARK_CINEMATIC">Cinemático</option>
                      </select>
                    </label>
                  </div>
                  {!!timeline.captions?.length && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={editCaptions}
                          onChange={(e) => {
                            setEditCaptions(e.target.checked);
                            setDirty(true);
                            dirtyRef.current = true;
                            setReview(false);
                          }}
                        />{" "}
                        Editar texto e tempos manualmente
                      </label>
                      {editCaptions &&
                        timeline.captions.map((cue, index) => (
                          <div
                            key={cue.id}
                            className="grid gap-2 sm:grid-cols-3"
                          >
                            {["startSeconds", "endSeconds", "text"].map(
                              (key) => (
                                <label key={key}>
                                  {key === "text"
                                    ? "Texto"
                                    : key === "startSeconds"
                                      ? "Início (s)"
                                      : "Fim (s)"}
                                  <input
                                    className={field}
                                    type={key === "text" ? "text" : "number"}
                                    step="0.01"
                                    value={cue[key]}
                                    onChange={(e) => {
                                      const value =
                                        key === "text"
                                          ? e.target.value
                                          : Number(e.target.value);
                                      setTimeline((t) => ({
                                        ...t,
                                        captions: t.captions.map((c, n) =>
                                          n === index
                                            ? { ...c, [key]: value }
                                            : c,
                                        ),
                                      }));
                                      setDirty(true);
                                      dirtyRef.current = true;
                                    }}
                                  />
                                </label>
                              ),
                            )}
                          </div>
                        ))}
                    </>
                  )}
                </div>
              </details>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={locked || !dirty || timeline.stale}
                onClick={() => act(save)}
              >
                Salvar nova versão da timeline
              </button>
              {dirty && (
                <button
                  className={button}
                  disabled={locked}
                  onClick={() => act(() => open(timeline.id))}
                >
                  Descartar edição
                </button>
              )}
            </div>
            {dirty && (
              <p>
                Há alterações não salvas. Salve para recalcular a sincronização
                e liberar a renderização.
              </p>
            )}
            {configData.subtitles.enabled && !data.subtitleOverrides && (
              <label className="block">
                <input
                  type="checkbox"
                  checked={review}
                  disabled={!hasPreview || dirty}
                  onChange={(e) => setReview(e.target.checked)}
                />{" "}
                Revisei as legendas aproximadas na prévia desta versão
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={blocked || active}
                onClick={() =>
                  act(async () => {
                    await remixAssembly.render(
                      project.id,
                      timeline.id,
                      "PREVIEW",
                    );
                    await refresh();
                  })
                }
              >
                Gerar prévia
              </button>
              <button
                className={button}
                disabled={
                  blocked ||
                  active ||
                  (configData.subtitles.enabled &&
                    !data.subtitleOverrides &&
                    !review)
                }
                onClick={() =>
                  act(async () => {
                    await remixAssembly.render(
                      project.id,
                      timeline.id,
                      "FINAL",
                      review,
                    );
                    await refresh();
                  })
                }
              >
                Renderizar vídeo final
              </button>
            </div>
            {player && (
              <div className="space-y-2">
                <video
                  key={player.id}
                  className="mx-auto max-h-[32rem] w-full max-w-sm rounded"
                  controls
                  preload="metadata"
                  src={remixAssembly.fileUrl(project.id, player.id)}
                />
                <p>
                  {player.kind === "PREVIEW" ? "Prévia" : "Vídeo final"} ·{" "}
                  {player.width} × {player.height} ·{" "}
                  {remixTimestamp(player.duration_seconds)}
                </p>
                <a
                  className="inline-block underline"
                  href={remixAssembly.fileUrl(project.id, player.id, true)}
                >
                  Baixar MP4
                </a>
              </div>
            )}
          </>
        )}
        {!!jobs.length && (
          <details>
            <summary className="cursor-pointer font-semibold">
              Histórico de renderizações
            </summary>
            <div className="mt-3 space-y-3">
              {jobs.map((j) => (
                <article
                  key={j.id}
                  className="space-y-1 rounded border border-border p-3"
                >
                  <p>
                    {j.kind === "PREVIEW" ? "Prévia" : "Exportação final"} ·{" "}
                    {phases[j.status]} ·{" "}
                    {new Date(j.created_at).toLocaleString("pt-BR")}
                  </p>
                  {["QUEUED", "RUNNING"].includes(j.status) && (
                    <>
                      <p>
                        {phases[j.progress?.stage] || "Aguardando"}{" "}
                        {j.progress?.total > 0
                          ? `${Number(j.progress.completed).toFixed(1)} / ${Number(j.progress.total).toFixed(1)}`
                          : ""}
                      </p>
                      <button
                        className={button}
                        disabled={locked}
                        onClick={() =>
                          act(async () => {
                            await remixAssembly.cancel(project.id, j.id);
                            await refresh();
                          })
                        }
                      >
                        Cancelar renderização
                      </button>
                    </>
                  )}
                  {j.error_message && (
                    <p role="alert">
                      {j.error_message} É possível solicitar outra renderização.
                    </p>
                  )}
                  {j.status === "COMPLETED" && (
                    <a
                      className="underline"
                      href={remixAssembly.fileUrl(project.id, j.id, true)}
                    >
                      Baixar {j.width} × {j.height}
                    </a>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
