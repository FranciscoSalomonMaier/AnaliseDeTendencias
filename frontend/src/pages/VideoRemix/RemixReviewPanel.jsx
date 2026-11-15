import { useEffect, useRef, useState } from "react";
import {
  remixReview,
  remixAssembly,
  remixStory,
  remixFileUrl,
  videoRemix,
} from "../../services/videoRemixService";
import { remixTimestamp } from "../../utils/videoRemix";
const button = "rounded-lg border border-border px-3 py-2 disabled:opacity-50";
const field =
  "w-full min-w-0 rounded-lg border border-border bg-background px-2 py-2";
const modeLabel = (m) =>
  m === "MULTI_SOURCE" ? "Múltiplas fontes" : "Fonte única";
const bytes = (n) => `${(Number(n || 0) / 1024 / 1024).toFixed(2)} MB`;
const platformLabels = {
  YOUTUBE_SHORTS: "YouTube Shorts",
  INSTAGRAM_REELS: "Instagram Reels",
  TIKTOK: "TikTok",
  CUSTOM: "Personalizado",
};
const phases = {
  QUEUED: "Na fila",
  RUNNING: "Processando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  VALIDATING: "Validando arquivo",
  CONVERTING: "Convertendo formato",
  METADATA: "Gerando metadados",
};
const emptyRatings = {
  visualCoherence: null,
  cuts: null,
  narration: null,
  subtitles: null,
  overall: null,
};
const ratingLabels = {
  visualCoherence: "Coerência visual",
  cuts: "Cortes",
  narration: "Narração",
  subtitles: "Legendas",
  overall: "Resultado geral",
};
export function RemixReviewPlayer({ src, label, videoRef }) {
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  return (
    <div className="min-w-0 space-y-2">
      <video
        ref={videoRef}
        key={src}
        className="mx-auto max-h-[32rem] w-full max-w-sm rounded"
        controls
        playsInline
        preload="metadata"
        src={src}
        aria-label={label}
        onLoadStart={() => {
          setLoading(true);
          setError("");
        }}
        onCanPlay={() => setLoading(false)}
        onLoadedMetadata={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(
            "Não foi possível reproduzir esta versão. Confira o arquivo e a autorização das fontes.",
          );
        }}
      />
      {loading && !error && <p role="status">Carregando vídeo…</p>}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
function RenderFacts({ render }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        {modeLabel(render.mode)} ·{" "}
        {render.kind === "PREVIEW" ? "Prévia" : "Final"} · versão{" "}
        {render.version}
      </p>
      <p>
        {render.width} × {render.height} · {render.fps ?? "—"} FPS ·{" "}
        {remixTimestamp(render.duration)} · {bytes(render.byteSize)}
      </p>
      <p>
        {new Date(render.createdAt).toLocaleString("pt-BR")} ·{" "}
        {phases[render.status]}
      </p>
      <p>
        {render.sourceCount} fontes · {render.cutCount} cortes · Processamento:{" "}
        {render.processingMs == null
          ? "não registrado"
          : `${(render.processingMs / 1000).toFixed(1)}s`}
      </p>
      <p>
        Ajustes manuais salvos: {render.manualAdjustments ?? "não registrado"} ·
        Roteiro v{render.scriptVersion}, revisão {render.scriptRevision}
      </p>
      {render.warnings?.map((w, i) => (
        <p key={i} className="text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}
function Validation({ report }) {
  if (!report) return <p>Solicite a validação técnica desta versão.</p>;
  return (
    <div className="space-y-2">
      <p className="font-semibold">
        {report.valid
          ? "Validação técnica aprovada"
          : "Exportação bloqueada por erros técnicos"}
      </p>
      <p className="text-sm">
        {new Date(report.checkedAt).toLocaleString("pt-BR")}
      </p>
      {report.issues.map((i, index) => (
        <p
          key={index}
          className={
            i.severity === "ERROR"
              ? "text-red-400"
              : i.severity === "WARNING"
                ? "text-amber-300"
                : "text-muted"
          }
        >
          {i.severity}: {i.message}
        </p>
      ))}
    </div>
  );
}
export function RemixReviewPanel({ project, disabled, onEditTimeline }) {
  const [renders, setRenders] = useState([]),
    [currentId, setCurrentId] = useState(null),
    [selection, setSelection] = useState(""),
    [detail, setDetail] = useState(null),
    [jobs, setJobs] = useState([]),
    [deliveries, setDeliveries] = useState([]),
    [deliveryId, setDeliveryId] = useState(""),
    [metadata, setMetadata] = useState(null),
    [options, setOptions] = useState(null),
    [platform, setPlatform] = useState("YOUTUBE_SHORTS"),
    [custom, setCustom] = useState({
      width: 1080,
      height: 1920,
      fps: 30,
      crf: 23,
    }),
    [rating, setRating] = useState({
      revision: 0,
      ratings: emptyRatings,
      notes: "",
    }),
    [projects, setProjects] = useState([]),
    [projectOffset, setProjectOffset] = useState(0),
    [projectTotal, setProjectTotal] = useState(0),
    [otherProject, setOtherProject] = useState(project.id),
    [otherRenders, setOtherRenders] = useState([]),
    [otherRender, setOtherRender] = useState(""),
    [comparison, setComparison] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false);
  const [narrativeConsent, setNarrativeConsent] = useState(false);
  const video = useRef(null),
    metadataDirty = useRef(false),
    selectedRef = useRef(""),
    deliveryRef = useRef(""),
    seen = useRef(new Set());
  async function selectRender(id) {
    const d = await remixReview.detail(project.id, id);
    setDetail(d);
    setSelection(id);
    selectedRef.current = id;
    setRating(
      d.review
        ? {
            revision: d.review.revision,
            ratings: d.review.ratings,
            notes: d.review.notes,
          }
        : { revision: 0, ratings: emptyRatings, notes: "" },
    );
  }
  function selectDelivery(d) {
    setDeliveryId(d?.id || "");
    deliveryRef.current = d?.id || "";
    setMetadata(d?.metadata ?? null);
    metadataDirty.current = false;
    setConsent(false);
  }
  async function refresh() {
    const [r, j, d, o] = await Promise.all([
      remixReview.list(project.id),
      remixReview.jobs(project.id),
      remixReview.deliveries(project.id),
      remixReview.presets(project.id),
    ]);
    setRenders(r.items);
    setCurrentId(r.currentRenderId);
    setJobs(j.items);
    setDeliveries(d.items);
    setOptions(o);
    return { r, j, d };
  }
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
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
      remixReview.list(project.id),
      remixReview.jobs(project.id),
      remixReview.deliveries(project.id),
      remixReview.presets(project.id),
      videoRemix.list(),
    ])
      .then(async ([r, j, d, o, p]) => {
        if (!live) return;
        setRenders(r.items);
        setCurrentId(r.currentRenderId);
        setJobs(j.items);
        j.items
          .filter((x) => x.status === "COMPLETED")
          .forEach((x) => seen.current.add(x.id));
        setDeliveries(d.items);
        setOptions(o);
        setProjects(p.items);
        setProjectTotal(p.total);
        setProjectOffset(p.items.length);
        const id = r.currentRenderId || r.items[0]?.id;
        if (id) {
          const detail = await remixReview.detail(project.id, id);
          if (live) {
            setDetail(detail);
            setSelection(id);
            selectedRef.current = id;
            if (detail.review)
              setRating({
                revision: detail.review.revision,
                ratings: detail.review.ratings,
                notes: detail.review.notes,
              });
          }
        }
        if (live && d.items[0]) selectDelivery(d.items[0]);
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
    remixReview
      .list(otherProject)
      .then((r) => {
        if (live) {
          setOtherRenders(r.items.filter((x) => x.status === "COMPLETED"));
          setOtherRender(r.currentRenderId || "");
          setComparison(null);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [otherProject]);
  useEffect(() => {
    let live = true;
    const timer = setInterval(() => {
      Promise.all([
        remixReview.list(project.id),
        remixReview.jobs(project.id),
        remixReview.deliveries(project.id),
      ])
        .then(([r, j, d]) => {
          if (!live) return;
          setRenders(r.items);
          setCurrentId(r.currentRenderId);
          setJobs(j.items);
          setDeliveries(d.items);
          const completed = j.items.find(
            (x) =>
              x.status === "COMPLETED" &&
              x.kind === "EXPORT" &&
              !seen.current.has(x.id),
          );
          j.items
            .filter((x) => x.status === "COMPLETED")
            .forEach((x) => seen.current.add(x.id));
          if (completed && !metadataDirty.current) {
            const delivery = d.items.find(
              (x) => x.id === completed.result.deliveryId,
            );
            if (delivery) selectDelivery(delivery);
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
  const locked = busy || disabled,
    render = detail?.render,
    delivery = deliveries.find((d) => d.id === deliveryId),
    report = jobs.find(
      (j) =>
        j.render_id === selection &&
        j.status === "COMPLETED" &&
        j.result?.validation,
    )?.result.validation,
    active = jobs.some(
      (j) =>
        j.render_id === selection && ["QUEUED", "RUNNING"].includes(j.status),
    ),
    suggestion = jobs.find(
      (j) =>
        j.kind === "METADATA" &&
        j.status === "COMPLETED" &&
        j.result.deliveryId === deliveryId,
    )?.result.suggestion;
  async function enqueue(kind) {
    const job = await remixReview.enqueue(project.id, selection, kind, {
      platform,
      ...(platform === "CUSTOM" ? { custom } : {}),
      ...(kind === "METADATA" ? { deliveryId } : {}),
    });
    const result = await refresh();
    if (job.result?.deliveryId) {
      const d = result.d.items.find((d) => d.id === job.result.deliveryId);
      if (d) selectDelivery(d);
    }
    setMessage("Solicitação registrada. Acompanhe o processamento abaixo.");
  }
  function seek(seconds) {
    const el = video.current;
    if (!el) return;
    if (Number.isFinite(el.duration))
      el.currentTime = Math.min(seconds, el.duration);
    else
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = Math.min(seconds, el.duration);
        },
        { once: true },
      );
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  return (
    <details
      id="remix-final-review"
      className="min-w-0 break-words rounded-xl border border-border p-4 [&_label]:min-w-0 [&_button]:max-w-full"
      open
    >
      <summary className="cursor-pointer text-xl font-semibold">
        Revisão Final
      </summary>
      <div className="mt-4 min-w-0 space-y-4">
        <h3 className="break-words text-lg font-semibold">{project.title}</h3>
        <p>
          Revise o vídeo, compare versões e prepare uma exportação. Os metadados
          serão salvos para publicação futura.
        </p>
        {error && (
          <p role="alert" className="break-words text-red-400">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button
          className={button}
          disabled={locked}
          onClick={() =>
            act(async () => {
              const { r } = await refresh();
              if (!selectedRef.current && r.items[0])
                await selectRender(r.currentRenderId || r.items[0].id);
            })
          }
        >
          Atualizar revisão final
        </button>
        {!renders.length && (
          <p>
            Gere uma prévia ou um vídeo final em Montagem e Edição para iniciar
            a revisão.
          </p>
        )}
        {!!renders.length && (
          <>
            <label className="block">
              Versão para revisão
              <select
                className={field}
                aria-label="Versão para revisão"
                value={selection}
                disabled={locked}
                onChange={(e) => act(() => selectRender(e.target.value))}
              >
                {renders.map((r) => (
                  <option key={r.id} value={r.id}>
                    v{r.version} · {r.kind === "FINAL" ? "Final" : "Prévia"} ·{" "}
                    {phases[r.status]}
                    {r.id === currentId ? " · Atual" : ""}
                  </option>
                ))}
              </select>
            </label>
            {render && (
              <>
                <RenderFacts render={render} />
                {render.status === "COMPLETED" && (
                  <RemixReviewPlayer
                    key={render.id}
                    label="Vídeo em revisão"
                    src={remixAssembly.fileUrl(project.id, render.id)}
                    videoRef={video}
                  />
                )}
                {render.error && <p role="alert">{render.error}</p>}
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Timeline utilizada
                  </summary>
                  <div className="mt-3 space-y-3">
                    {detail.timeline.data.items.map((i, index) => (
                      <article
                        key={i.id}
                        className="min-w-0 space-y-2 rounded border border-border p-3"
                      >
                        <div className="flex flex-wrap gap-3">
                          <video
                            className="max-h-24 w-20 max-w-full rounded"
                            src={remixFileUrl(
                              `/video-remix/projects/${project.id}/files/${i.fileId}/file`,
                            )}
                            muted
                            preload="metadata"
                            aria-label={`Miniatura de revisão ${index + 1}`}
                            onLoadedMetadata={(e) => {
                              e.currentTarget.currentTime = i.sourceStart;
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <h4 className="break-words font-semibold">
                              {index + 1}.{" "}
                              {detail.sources.find((s) => s.id === i.sourceId)
                                ?.title || "Fonte indisponível"}
                            </h4>
                            <p>
                              Fonte: {remixTimestamp(i.sourceStart)} →{" "}
                              {remixTimestamp(i.sourceEnd)}
                            </p>
                            <p>
                              Timeline: {remixTimestamp(i.timelineStart)} →{" "}
                              {remixTimestamp(i.timelineEnd)} ·{" "}
                              {i.duration.toFixed(2)}s
                            </p>
                            <p>
                              Enquadramento: {i.framing.mode} · Transição:{" "}
                              {i.transition}
                            </p>
                          </div>
                        </div>
                        <p className="break-words">
                          {
                            detail.timeline.data.segments.find(
                              (s) => s.id === i.segmentId,
                            )?.text
                          }
                        </p>
                        <button
                          className={button}
                          disabled={render.status !== "COMPLETED"}
                          onClick={() => seek(i.timelineStart)}
                        >
                          Ver trecho {index + 1}
                        </button>
                      </article>
                    ))}
                  </div>
                </details>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={locked || detail.timeline.stale}
                    onClick={() => onEditTimeline?.(render.timelineId)}
                  >
                    Ajustar cortes, áudio e legendas
                  </button>
                  <a
                    className={`${button} inline-block`}
                    href="#remix-story-editor"
                  >
                    Revisar roteiro e narração
                  </a>
                  <button
                    className={button}
                    disabled={locked || render.status !== "COMPLETED"}
                    onClick={() =>
                      act(async () => {
                        if (
                          !window.confirm(
                            "Excluir esta versão? Exportações que dependem dela impedem a exclusão.",
                          )
                        )
                          return;
                        await remixReview.removeRender(project.id, render.id);
                        setDetail(null);
                        setSelection("");
                        selectedRef.current = "";
                        const { r } = await refresh();
                        if (r.items[0])
                          await selectRender(
                            r.currentRenderId || r.items[0].id,
                          );
                      })
                    }
                  >
                    Excluir versão
                  </button>
                </div>
                {detail.timeline.stale && (
                  <p className="text-amber-300">
                    Esta versão preserva um roteiro anterior. Ela pode ser
                    reproduzida enquanto fontes e áudios estiverem disponíveis e
                    autorizados. Para novos ajustes, crie uma timeline do
                    roteiro atual.
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Nova versão de um segmento narrativo
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      A reescrita usa a IA da Etapa 4 e pode gerar custos.
                      Depois, confira o texto e gere a narração em Roteiro e
                      Narração; a versão renderizada atual será preservada.
                    </p>
                    <label>
                      <input
                        type="checkbox"
                        checked={narrativeConsent}
                        onChange={(e) => setNarrativeConsent(e.target.checked)}
                      />{" "}
                      Autorizo a reescrita com IA deste segmento.
                    </label>
                    {detail.timeline.data.segments.map((segment, index) => (
                      <div key={segment.id} className="space-y-2">
                        <p className="break-words">
                          {index + 1}. {segment.text}
                        </p>
                        <button
                          className={button}
                          disabled={
                            locked || !narrativeConsent || detail.timeline.stale
                          }
                          onClick={() =>
                            act(async () => {
                              const script = await remixStory.get(
                                project.id,
                                detail.timeline.data.scriptId,
                              );
                              if (script.revision !== render.scriptRevision)
                                throw new Error(
                                  "O roteiro mudou. Revise a versão atual.",
                                );
                              await remixStory.run(
                                project.id,
                                script,
                                "regenerate",
                                { segmentId: segment.id },
                              );
                              setNarrativeConsent(false);
                              setMessage(
                                "Reescrita enviada à fila. Confira o resultado e gere a narração em Roteiro e Narração.",
                              );
                            })
                          }
                        >
                          Reescrever segmento {index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Avaliação manual
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      Notas pessoais de 1 a 5; deixe em branco os critérios
                      ainda não revisados.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {Object.entries(ratingLabels).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <select
                            className={field}
                            value={rating.ratings[key] ?? ""}
                            onChange={(e) =>
                              setRating((r) => ({
                                ...r,
                                ratings: {
                                  ...r.ratings,
                                  [key]: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                },
                              }))
                            }
                          >
                            <option value="">Sem avaliação</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <label className="block">
                      Observações
                      <textarea
                        className={field}
                        rows="3"
                        value={rating.notes}
                        onChange={(e) =>
                          setRating((r) => ({ ...r, notes: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className={button}
                      disabled={locked}
                      onClick={() =>
                        act(async () => {
                          const r = await remixReview.rate(
                            project.id,
                            selection,
                            rating,
                          );
                          setRating({
                            revision: r.revision,
                            ratings: r.ratings,
                            notes: r.notes,
                          });
                          setMessage("Avaliação salva.");
                        })
                      }
                    >
                      Salvar avaliação
                    </button>
                  </div>
                </details>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    Comparar versões e modos
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      Projeto da versão B
                      <select
                        className={field}
                        aria-label="Projeto da comparação"
                        value={otherProject}
                        onChange={(e) => setOtherProject(e.target.value)}
                      >
                        {!projects.some((p) => p.id === project.id) && (
                          <option value={project.id}>{project.title}</option>
                        )}
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title} · {modeLabel(p.mode)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {projectOffset < projectTotal && (
                      <button
                        className={button}
                        disabled={locked}
                        onClick={() =>
                          act(async () => {
                            const p = await videoRemix.list(projectOffset);
                            setProjects((old) => [...old, ...p.items]);
                            setProjectOffset(projectOffset + p.items.length);
                          })
                        }
                      >
                        Carregar mais projetos
                      </button>
                    )}
                    <label className="block">
                      Versão B
                      <select
                        className={field}
                        value={otherRender}
                        onChange={(e) => setOtherRender(e.target.value)}
                      >
                        {otherRenders.map((r) => (
                          <option key={r.id} value={r.id}>
                            v{r.version} ·{" "}
                            {r.kind === "FINAL" ? "Final" : "Prévia"} ·{" "}
                            {modeLabel(r.mode)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className={button}
                      disabled={
                        locked || !otherRender || render.status !== "COMPLETED"
                      }
                      onClick={() =>
                        act(async () =>
                          setComparison(
                            await remixReview.compare(
                              project.id,
                              selection,
                              otherProject,
                              otherRender,
                            ),
                          ),
                        )
                      }
                    >
                      Comparar A e B
                    </button>
                    {comparison && (
                      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                        {["a", "b"].map((k) => {
                          const d = comparison[k];
                          return (
                            <article
                              key={k}
                              className="min-w-0 space-y-3 rounded border border-border p-3"
                            >
                              <h4 className="break-words font-semibold">
                                Versão {k.toUpperCase()} · {d.render.title}
                              </h4>
                              <RemixReviewPlayer
                                label={`Comparação ${k.toUpperCase()}`}
                                src={remixAssembly.fileUrl(
                                  d.render.projectId,
                                  d.render.id,
                                )}
                              />
                              <RenderFacts render={d.render} />
                              <p>
                                Configurações:{" "}
                                {d.render.config.quality === "HIGH"
                                  ? "qualidade alta"
                                  : "qualidade padrão"}{" "}
                                · Áudio original{" "}
                                {Math.round(
                                  d.render.config.originalVolume * 100,
                                )}
                                % · Legendas{" "}
                                {d.render.config.subtitles.enabled
                                  ? "ativadas"
                                  : "desativadas"}
                              </p>
                              <p>
                                Avaliação geral:{" "}
                                {d.review?.ratings.overall ?? "sem avaliação"}
                              </p>
                              <p className="break-words">{d.review?.notes}</p>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </details>
                <details open>
                  <summary className="cursor-pointer text-lg font-semibold">
                    Exportar Vídeo
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      Versão selecionada: v{render.version} ·{" "}
                      {remixTimestamp(render.duration)} ·{" "}
                      {bytes(render.byteSize)} atuais. O tamanho após conversão
                      depende do conteúdo.
                    </p>
                    <label className="block">
                      Plataforma / preset
                      <select
                        aria-label="Preset de exportação Remix"
                        className={field}
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value)}
                      >
                        {Object.entries(platformLabels).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {platform === "CUSTOM" ? (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label>
                          Resolução
                          <select
                            className={field}
                            value={custom.width}
                            onChange={(e) => {
                              const width = Number(e.target.value);
                              setCustom((c) => ({
                                ...c,
                                width,
                                height: (width * 16) / 9,
                              }));
                            }}
                          >
                            {[540, 720, 1080].map((w) => (
                              <option key={w} value={w}>
                                {w} × {(w * 16) / 9}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          FPS
                          <select
                            className={field}
                            value={custom.fps}
                            onChange={(e) =>
                              setCustom((c) => ({
                                ...c,
                                fps: Number(e.target.value),
                              }))
                            }
                          >
                            <option value="24">24</option>
                            <option value="30">30</option>
                          </select>
                        </label>
                        <label>
                          Qualidade
                          <select
                            className={field}
                            value={custom.crf}
                            onChange={(e) =>
                              setCustom((c) => ({
                                ...c,
                                crf: Number(e.target.value),
                              }))
                            }
                          >
                            <option value="18">Alta</option>
                            <option value="23">Padrão</option>
                            <option value="28">Arquivo menor</option>
                          </select>
                        </label>
                      </div>
                    ) : (
                      <p>1080 × 1920 · 30 FPS · MP4 · H.264 / AAC</p>
                    )}
                    <p className="text-sm">
                      Os presets validam formato, sem garantir aceitação pela
                      plataforma. Confira as regras atuais antes de publicar. Um
                      arquivo compatível é reutilizado; a conversão só é feita
                      quando necessária.
                    </p>
                    <Validation report={report} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={button}
                        disabled={
                          locked || active || render.status !== "COMPLETED"
                        }
                        onClick={() => act(() => enqueue("VALIDATE"))}
                      >
                        Validar vídeo
                      </button>
                      <button
                        className={button}
                        disabled={
                          locked || active || render.status !== "COMPLETED"
                        }
                        onClick={() => act(() => enqueue("EXPORT"))}
                      >
                        Preparar exportação
                      </button>
                    </div>
                  </div>
                </details>
              </>
            )}
          </>
        )}
        {!!jobs.length && (
          <details open>
            <summary className="cursor-pointer font-semibold">
              Processamentos de revisão e exportação
            </summary>
            <div className="mt-3 space-y-3">
              {jobs.slice(0, 15).map((j) => (
                <article
                  key={j.id}
                  className="space-y-1 rounded border border-border p-3"
                >
                  <p>
                    {j.kind === "EXPORT"
                      ? "Exportação"
                      : j.kind === "VALIDATE"
                        ? "Validação"
                        : "Metadados"}{" "}
                    · {phases[j.status]} · {phases[j.progress?.stage] || ""}
                  </p>
                  {j.progress?.total > 1 && (
                    <p>
                      {Number(j.progress.completed).toFixed(1)} /{" "}
                      {Number(j.progress.total).toFixed(1)} s
                    </p>
                  )}
                  {j.error_message && <p role="alert">{j.error_message}</p>}
                  {j.result?.validation && !j.result.validation.valid && (
                    <Validation report={j.result.validation} />
                  )}
                  {["QUEUED", "RUNNING"].includes(j.status) && (
                    <button
                      className={button}
                      disabled={locked}
                      onClick={() =>
                        act(async () => {
                          await remixReview.cancel(project.id, j.id);
                          await refresh();
                        })
                      }
                    >
                      Cancelar finalização
                    </button>
                  )}
                </article>
              ))}
            </div>
          </details>
        )}
        {!!deliveries.length && (
          <details open>
            <summary className="cursor-pointer text-lg font-semibold">
              Exportações e metadados para publicação
            </summary>
            <div className="mt-3 min-w-0 space-y-3">
              <label className="block">
                Exportação pronta
                <select
                  className={field}
                  value={deliveryId}
                  onChange={(e) =>
                    selectDelivery(
                      deliveries.find((d) => d.id === e.target.value),
                    )
                  }
                >
                  {deliveries.map((d) => (
                    <option key={d.id} value={d.id}>
                      {platformLabels[d.platform]} ·{" "}
                      {new Date(d.created_at).toLocaleString("pt-BR")}
                    </option>
                  ))}
                </select>
              </label>
              {delivery && metadata && (
                <>
                  <RemixReviewPlayer
                    label="Vídeo exportado"
                    src={remixReview.fileUrl(project.id, deliveryId)}
                  />
                  <p>
                    {delivery.media.width} × {delivery.media.height} ·{" "}
                    {delivery.media.fps} FPS · {bytes(delivery.byte_size)} ·{" "}
                    {delivery.reused
                      ? "Arquivo reutilizado"
                      : "Arquivo convertido"}
                  </p>
                  <a
                    className="inline-block underline"
                    href={remixReview.fileUrl(project.id, deliveryId, true)}
                  >
                    Baixar exportação MP4
                  </a>
                  <Validation report={delivery.validation} />
                  <label className="block">
                    Título para publicação
                    <input
                      className={field}
                      maxLength="100"
                      aria-label="Título para publicação Remix"
                      value={metadata.title}
                      onChange={(e) => {
                        metadataDirty.current = true;
                        setMetadata((m) => ({ ...m, title: e.target.value }));
                      }}
                    />
                  </label>
                  <label className="block">
                    Descrição
                    <textarea
                      className={field}
                      rows="4"
                      maxLength="5000"
                      value={metadata.description}
                      onChange={(e) => {
                        metadataDirty.current = true;
                        setMetadata((m) => ({
                          ...m,
                          description: e.target.value,
                        }));
                      }}
                    />
                  </label>
                  <label className="block">
                    Hashtags (separadas por espaço)
                    <input
                      className={field}
                      value={metadata.hashtags.join(" ")}
                      onChange={(e) => {
                        metadataDirty.current = true;
                        setMetadata((m) => ({
                          ...m,
                          hashtags: e.target.value.split(/\s+/).filter(Boolean),
                        }));
                      }}
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label>
                      Idioma
                      <input
                        className={field}
                        value={metadata.language}
                        onChange={(e) => {
                          metadataDirty.current = true;
                          setMetadata((m) => ({
                            ...m,
                            language: e.target.value,
                          }));
                        }}
                      />
                    </label>
                    <label>
                      Categoria (opcional)
                      <input
                        className={field}
                        value={metadata.category}
                        onChange={(e) => {
                          metadataDirty.current = true;
                          setMetadata((m) => ({
                            ...m,
                            category: e.target.value,
                          }));
                        }}
                      />
                    </label>
                    <label>
                      Preparação
                      <select
                        className={field}
                        value={metadata.status}
                        onChange={(e) => {
                          metadataDirty.current = true;
                          setMetadata((m) => ({
                            ...m,
                            status: e.target.value,
                          }));
                        }}
                      >
                        <option value="DRAFT">Rascunho</option>
                        <option value="READY">Revisado para publicação</option>
                      </select>
                    </label>
                  </div>
                  <button
                    className={button}
                    disabled={locked}
                    onClick={() =>
                      act(async () => {
                        const d = await remixReview.metadata(
                          project.id,
                          deliveryId,
                          delivery.revision,
                          metadata,
                        );
                        setDeliveries((old) =>
                          old.map((x) => (x.id === d.id ? d : x)),
                        );
                        selectDelivery(d);
                        setMessage(
                          "Metadados salvos. Nenhum vídeo foi publicado.",
                        );
                      })
                    }
                  >
                    Salvar metadados
                  </button>
                  <p className="text-sm">
                    A integração existente com YouTube permanece disponível no
                    módulo de publicação. Esta preparação conserva arquivo e
                    metadados para uma futura conexão do Video Remix; não envia
                    vídeos às plataformas.
                  </p>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />{" "}
                    Autorizo gerar uma sugestão de metadados com IA; pode haver
                    cobrança pela API.
                  </label>
                  <button
                    className={button}
                    disabled={
                      locked ||
                      !consent ||
                      !options?.metadataAiEnabled ||
                      jobs.some(
                        (j) =>
                          j.kind === "METADATA" &&
                          ["QUEUED", "RUNNING"].includes(j.status),
                      )
                    }
                    onClick={() =>
                      act(async () => {
                        await remixReview.enqueue(
                          project.id,
                          delivery.render_id,
                          "METADATA",
                          { deliveryId, platform: delivery.platform },
                        );
                        await refresh();
                        setConsent(false);
                      })
                    }
                  >
                    Sugerir metadados com IA
                  </button>
                  {suggestion && (
                    <div className="space-y-2 rounded border border-border p-3">
                      <h4 className="font-semibold">
                        Sugestão para revisão humana
                      </h4>
                      <p>{suggestion.title}</p>
                      <p className="whitespace-pre-wrap break-words">
                        {suggestion.description}
                      </p>
                      <p className="break-words">
                        {suggestion.hashtags.join(" ")}
                      </p>
                      <button
                        className={button}
                        onClick={() => {
                          setMetadata(suggestion);
                          metadataDirty.current = true;
                        }}
                      >
                        Aplicar sugestão no formulário
                      </button>
                    </div>
                  )}
                  <button
                    className={button}
                    disabled={locked}
                    onClick={() =>
                      act(async () => {
                        if (
                          !window.confirm(
                            "Excluir esta preparação de exportação e seus metadados?",
                          )
                        )
                          return;
                        await remixReview.removeDelivery(
                          project.id,
                          deliveryId,
                        );
                        const { d } = await refresh();
                        selectDelivery(d.items[0]);
                      })
                    }
                  >
                    Excluir exportação preparada
                  </button>
                </>
              )}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
