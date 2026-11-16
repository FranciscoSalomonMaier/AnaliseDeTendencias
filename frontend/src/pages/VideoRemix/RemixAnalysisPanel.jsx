import { remixTimestamp } from "../../utils/videoRemix";
import { useCallback, useEffect, useRef, useState } from "react";
import { remixAnalysis, remixFileUrl } from "../../services/videoRemixService";
const button = "rounded-lg border border-border px-3 py-2 disabled:opacity-50";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2";
const phases = {
  QUEUED: "Na fila",
  PREPARING: "Preparando vídeo",
  DETECTING: "Detectando cenas",
  EXTRACTING: "Extraindo frames",
  ANALYZING: "Analisando com IA",
  RELEVANCE: "Calculando relevância",
  COMPLETED: "Finalizado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};
export function RemixAnalysisPanel({ project, disabled }) {
  const [profile, setProfile] = useState("ECONOMIC"),
    [jobs, setJobs] = useState([]),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [estimate, setEstimate] = useState(null),
    [order, setOrder] = useState("relevance"),
    [preview, setPreview] = useState(null),
    [comparison, setComparison] = useState([]);
  const resultAnchor = useRef(null),
    candidatesAnchor = useRef(null),
    pendingNavigation = useRef(false);
  const player = useRef(null),
    inflight = useRef(false);
  const load = useCallback(async () => {
    const r = await remixAnalysis.list(project.id);
    setJobs(r.items);
  }, [project.id]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) void load().catch((e) => active && setError(e.message));
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    const latest = jobs.find((job) => job.id === result?.analysis.id);
    if (!latest || latest.status === result.analysis.status) return;
    let active = true;
    remixAnalysis.results(project.id, latest.id)
      .then((fresh) => { if (active) setResult(fresh); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [jobs, project.id, result]);
  useEffect(() => {
    if (!result || !pendingNavigation.current) return;
    pendingNavigation.current = false;
    const target = candidatesAnchor.current ?? resultAnchor.current;
    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    target?.focus?.({ preventScroll: true });
  }, [result]);
  async function act(fn) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  const sources = project.sources.filter(
    (s) => s.status === "IMPORTED" && s.importedFileId,
  );
  const files = project.files ?? [];
  const sourceName = (id) =>
    project.sources.find((s) => s.id === id)?.title ?? "Fonte removida";
  const show = async (id) => {
    const fresh = await remixAnalysis.results(project.id, id);
    pendingNavigation.current = true;
    setResult(fresh);
    setComparison([]);
    setPreview(null);
  };
  const complementary = comparison
    .flatMap((a, index) =>
      comparison
        .slice(index + 1)
        .filter(
          (b) =>
            a.analysis.source_id !== b.analysis.source_id &&
            a.narrativeRole !== b.narrativeRole &&
            a.narrativeRole !== "OTHER" &&
            b.narrativeRole !== "OTHER",
        )
        .map((b) => ({ a, b })),
    )
    .slice(0, 4);
  const candidates = [
    ...(comparison.length ? comparison : (result?.candidates ?? [])),
  ].sort((a, b) =>
    order === "chronological"
      ? a.start_seconds - b.start_seconds
      : b.relevance - a.relevance,
  );
  const watch = (candidate, analysis) => {
    const job = analysis ?? result.analysis;
    const f = files.find((f) => f.id === job.file_id);
    if (f) {
      setPreview({
        url: remixFileUrl(f.url),
        start: candidate.start_seconds,
        end: candidate.end_seconds,
        title: sourceName(job.source_id),
      });
    }
  };
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border p-4">
      <h2 className="text-xl font-semibold">Análise Inteligente</h2>
      <p className="text-sm text-muted">
        Analisa somente arquivos importados e autorizados. O envio de frames à
        IA consome sua API. Não há análise automática ao abrir a página.
      </p>
      {error && (
        <p role="alert" className="break-words text-red-400">
          {error}
        </p>
      )}
      <label className="block">
        Perfil
        <select
          className={field}
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value);
            setEstimate(null);
          }}
        >
          <option value="ECONOMIC">Econômico</option>
          <option value="DETAILED">Detalhado</option>
        </select>
      </label>
      {!sources.length && <p>Importe e autorize um vídeo para iniciar.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={disabled || busy || !sources.length}
          onClick={() =>
            void act(async () =>
              setEstimate({
                ...(await remixAnalysis.estimate(project.id, { profile })),
                sourceId: null,
              }),
            )
          }
        >
          Estimar todas as fontes
        </button>
        <button
          className={button}
          disabled={busy || !jobs.some((j) => j.status === "COMPLETED")}
          onClick={() =>
            void act(async () => {
              const seen = new Set();
              const latest = jobs.filter(
                (j) =>
                  j.status === "COMPLETED" &&
                  !seen.has(j.source_id) &&
                  seen.add(j.source_id),
              );
              const results = await Promise.all(
                latest.map((j) => remixAnalysis.results(project.id, j.id)),
              );
              setComparison(
                results.flatMap((r) =>
                  r.candidates.map((c) => ({ ...c, analysis: r.analysis })),
                ),
              );
              setResult(null);
            })
          }
        >
          Comparar sugestões das fontes
        </button>
      </div>
      {sources.map((source) => {
        const j = jobs.find((j) => j.source_id === source.id);
        return (
          <article
            key={source.id}
            className="space-y-2 rounded-lg border border-border p-3"
          >
            <h3 className="break-words font-semibold">{source.title}</h3>
            {files.find((f) => f.id === source.importedFileId)?.url && (
              <video
                className="max-h-28 max-w-full rounded"
                aria-label={`Prévia da fonte ${source.title}`}
                muted
                preload="metadata"
                src={remixFileUrl(
                  files.find((f) => f.id === source.importedFileId).url,
                )}
              />
            )}
            <p>
              {remixTimestamp(source.durationSeconds ?? 0)} ·{" "}
              {(j?.status === "RUNNING"
                ? phases[j?.progress?.stage]
                : phases[j?.status]) ?? "Não analisado"}
            </p>
            {j?.progress?.total > 0 && (
              <p>
                {j.progress.completed} / {j.progress.total} segmentos ·{" "}
                {phases[j.progress.stage]}
              </p>
            )}
            <button
              className={button}
              disabled={
                disabled ||
                busy ||
                j?.status === "QUEUED" ||
                j?.status === "RUNNING"
              }
              onClick={() =>
                void act(async () =>
                  setEstimate({
                    ...(await remixAnalysis.estimate(project.id, {
                      profile,
                      sourceId: source.id,
                    })),
                    sourceId: source.id,
                  }),
                )
              }
            >
              Estimar análise
            </button>
          </article>
        );
      })}
      {estimate && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h3>Estimativa antes de iniciar</h3>
          <p>Modelo: {estimate.model || "Não configurado"}</p>
          {estimate.items.map((i) => (
            <p key={i.sourceId}>
              {i.title}: até {i.maxFrames} frames, {i.maxSegments} segmentos,{" "}
              {i.maxCalls} chamadas · {remixTimestamp(i.analyzedSeconds)}{" "}
              {i.truncated ? "(vídeo limitado pela configuração)" : ""}
            </p>
          ))}
          <p>
            {estimate.estimatedUpperUsd === null
              ? "Estimativa em dólares indisponível: configure preços e limite de tokens de imagem do modelo."
              : `Estimativa máxima configurada: US$ ${estimate.estimatedUpperUsd.toFixed(4)}`}
          </p>
          <p>
            Retentativas transitórias são limitadas. Revise o consumo antes de
            repetir uma análise com falha.
          </p>
          <button
            className={button}
            disabled={!estimate.enabled || disabled || busy}
            onClick={() =>
              void act(async () => {
                if (
                  !window.confirm(
                    "Autorizar o envio destes frames à IA e o consumo da API?",
                  )
                )
                  return;
                await remixAnalysis.start(project.id, {
                  profile,
                  ...(estimate.sourceId ? { sourceId: estimate.sourceId } : {}),
                });
                setEstimate(null);
              })
            }
          >
            Confirmar e iniciar análise
          </button>
          {!estimate.enabled && (
            <p>
              Configure OPENAI_API_KEY e VIDEO_REMIX_ANALYSIS_MODEL no servidor.
            </p>
          )}
        </div>
      )}
      {jobs.length > 0 && (
        <details>
          <summary>Histórico de análises ({jobs.length})</summary>
          <div className="space-y-3">
            {jobs.map((j) => (
              <article
                className="rounded-lg border border-border p-3"
                key={j.id}
              >
                <p>
                  {sourceName(j.source_id)} · {phases[j.status] ?? j.status} ·{" "}
                  {j.config.profile} · {j.config.model}
                </p>
                <p>{j.usage?.totalTokens ?? 0} tokens reportados</p>
                {j.error_message && <p role="alert">{j.error_message}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void act(() => show(j.id))}
                  >
                    Consultar cenas e trechos
                  </button>
                  {["QUEUED", "RUNNING"].includes(j.status) && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void act(() => remixAnalysis.cancel(project.id, j.id))
                      }
                    >
                      Cancelar
                    </button>
                  )}
                  {j.status === "FAILED" && j.progress?.stage === "RELEVANCE" && (
                    <button className={button} disabled={busy || disabled}
                      onClick={() => void act(async () => {
                        await remixAnalysis.recover(project.id, j.id);
                        await show(j.id);
                      })}>
                      Recuperar trechos sem usar IA
                    </button>
                  )}
                  {["FAILED", "CANCELLED"].includes(j.status) && (
                    <button
                      className={button}
                      disabled={busy || disabled}
                      onClick={() =>
                        void act(async () => {
                          if (
                            window.confirm(
                              "Reprocessar pode consumir a API novamente. Continuar?",
                            )
                          )
                            await remixAnalysis.retry(project.id, j.id);
                        })
                      }
                    >
                      Reprocessar
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      {result && (
        <div className="space-y-3" ref={resultAnchor} tabIndex={-1}>
          <p role="status">
            Análise aberta: {phases[result.analysis.status] ?? result.analysis.status}
            {" · "}{result.scenes.length} cenas · {result.candidates.length} trechos.
          </p>
          {result.candidates.length === 0 && (
            <p>Esta análise ainda não possui trechos selecionáveis. Consulte o status no histórico; se houver falha na finalização, use a recuperação sem IA.</p>
          )}
          <details>
          <summary className="cursor-pointer font-semibold">Cenas identificadas ({result.scenes.length}) — expandir detalhes</summary>
          <h3 className="font-semibold">
            Cenas identificadas — {sourceName(result.analysis.source_id)}
          </h3>
          <p>
            Áudio:{" "}
            {result.analysis.metadata.hasAudio
              ? "presente"
              : "ausente ou ainda não verificado"}{" "}
            · {result.analysis.metadata.width} ×{" "}
            {result.analysis.metadata.height} · {result.analysis.metadata.fps}{" "}
            FPS
          </p>
          {result.scenes.map((scene) => (
            <article
              className="space-y-2 rounded-lg border border-border p-3"
              key={scene.id}
            >
              {scene.frames[0] && (
                <img
                  className="max-h-36 rounded"
                  src={remixAnalysis.frameUrl(
                    project.id,
                    result.analysis.id,
                    scene.frames[0].id,
                  )}
                  alt={`Frame em ${remixTimestamp(scene.frames[0].timestamp)}`}
                />
              )}
              <p>
                {remixTimestamp(scene.start_seconds)}–
                {remixTimestamp(scene.end_seconds)}
              </p>
              <p>{scene.result.description}</p>
              <p>
                Relevância: {scene.result.relevance}/100 · Confiança:{" "}
                {Math.round(scene.result.confidence * 100)}%
              </p>
              <p>{scene.result.keywords.join(" · ")}</p>
              <details>
                <summary>Evidências e incertezas</summary>
                <p>{scene.result.uncertainty}</p>
                <p>{scene.result.justification}</p>
                {scene.result.events.map((e, i) => (
                  <p key={i}>
                    {remixTimestamp(e.timestamp)} · {e.evidence} ·{" "}
                    {e.description}
                  </p>
                ))}
              </details>
            </article>
          ))}
          </details>
        </div>
      )}
      {complementary.length > 0 && (
        <div>
          <h3>Possíveis cenas complementares</h3>
          <p>
            Sugestões pelos papéis narrativos atribuídos pela IA; não confirmam
            continuidade ou causalidade entre fontes.
          </p>
          {complementary.map(({ a, b }) => (
            <p key={`${a.id}-${b.id}`}>
              {sourceName(a.analysis.source_id)} ({a.narrativeRole}) +{" "}
              {sourceName(b.analysis.source_id)} ({b.narrativeRole})
            </p>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="space-y-3" ref={candidatesAnchor} tabIndex={-1}>
          <h3 className="font-semibold">Trechos sugeridos ({candidates.length})</h3>
          <label>
            Ordenação
            <select
              className={field}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              <option value="relevance">Relevância</option>
              <option value="chronological">Cronológica</option>
            </select>
          </label>
          {candidates.map((candidate) => (
            <Candidate
              key={candidate.id}
              candidate={candidate}
              source={sourceName(
                (candidate.analysis ?? result.analysis).source_id,
              )}
              disabled={
                disabled ||
                busy ||
                (candidate.analysis ?? result.analysis).status !== "COMPLETED"
              }
              onPreview={() => watch(candidate, candidate.analysis)}
              onSave={(data) =>
                void act(async () => {
                  const analysis = candidate.analysis ?? result.analysis;
                  await remixAnalysis.select(
                    project.id,
                    analysis.id,
                    candidate.id,
                    data,
                  );
                  if (comparison.length) {
                    setComparison((old) =>
                      old.map((c) =>
                        c.id === candidate.id
                          ? {
                              ...c,
                              ...data,
                              start_seconds: data.start,
                              end_seconds: data.end,
                              revision: c.revision + 1,
                            }
                          : c,
                      ),
                    );
                  } else await show(analysis.id);
                })
              }
            />
          ))}
        </div>
      )}
      {preview && (
        <div className="space-y-2">
          <p>
            {preview.title} · {remixTimestamp(preview.start)}–
            {remixTimestamp(preview.end)}
          </p>
          <video
            key={`${preview.url}-${preview.start}-${preview.end}`}
            ref={player}
            className="max-h-96 w-full"
            controls
            preload="metadata"
            src={preview.url}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = preview.start;
            }}
            onTimeUpdate={(e) => {
              if (e.currentTarget.currentTime >= preview.end)
                e.currentTarget.pause();
            }}
          />
          <p>
            A prévia usa o arquivo original. Timestamps são aproximados; revise
            antes de selecionar.
          </p>
        </div>
      )}
    </section>
  );
}
function Candidate({ candidate: c, source, disabled, onPreview, onSave }) {
  const [start, setStart] = useState(c.start_seconds),
    [end, setEnd] = useState(c.end_seconds);
  return (
    <article className="space-y-2 rounded-lg border border-border p-3">
      <p>
        {source} · {remixTimestamp(c.start_seconds)}–
        {remixTimestamp(c.end_seconds)} ·{" "}
        {(c.end_seconds - c.start_seconds).toFixed(2)}s
      </p>
      <p>{c.description}</p>
      <p>
        Relevância {c.relevance}/100 · Confiança{" "}
        {Math.round(c.confidence * 100)}% · {c.evidence_type} ·{" "}
        {c.narrativeRole} · {c.relevanceBand}
      </p>
      <p>{c.justification}</p>
      <div className="flex flex-wrap gap-2">
        <label>
          Início (segundos)
          <input
            className={field}
            type="number"
            min="0"
            step="0.01"
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        <label>
          Fim (segundos)
          <input
            className={field}
            type="number"
            min="0"
            step="0.01"
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} onClick={onPreview}>
          Visualizar trecho
        </button>
        <button
          className={button}
          disabled={disabled || end <= start}
          onClick={() =>
            onSave({ selected: !c.selected, start, end, revision: c.revision })
          }
        >
          {c.selected ? "Desmarcar" : "Selecionar"}
        </button>
        <button
          className={button}
          disabled={disabled || end <= start}
          onClick={() =>
            onSave({ selected: c.selected, start, end, revision: c.revision })
          }
        >
          Salvar timestamps
        </button>
      </div>
    </article>
  );
}
