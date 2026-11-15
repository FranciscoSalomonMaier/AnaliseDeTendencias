import { useEffect, useRef, useState } from "react";
import { remixStory, remixFileUrl } from "../../services/videoRemixService";
import { remixTimestamp } from "../../utils/videoRemix";
import { CopyTextButton } from "../ContentCreation/components/CopyTextButton";
const button = "rounded-lg border border-border px-3 py-2 disabled:opacity-50";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2";
const supportLabels = {
  PENDING: "Validação pendente",
  SUPPORTED: "Sustentado pelas evidências",
  PARTIALLY_SUPPORTED: "Parcialmente sustentado",
  UNSUPPORTED: "Sem suporte suficiente",
};
const phases = {
  QUEUED: "Na fila",
  RUNNING: "Em processamento",
  PLANNING: "Planejando roteiro",
  VALIDATING: "Validando correspondência visual",
  NARRATING: "Gerando narração",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};
const styles = {
  CURIOSIDADE: "Curiosidade",
  NARRATIVO: "Narrativo",
  DINAMICO: "Dinâmico",
  EXPLICATIVO: "Explicativo",
};
const kinds = {
  HOOK: "Introdução",
  DEVELOPMENT: "Desenvolvimento",
  REVEAL: "Revelação",
  ENDING: "Encerramento",
};
export function RemixStoryPanel({ project, disabled }) {
  const [options, setOptions] = useState(null),
    [config, setConfig] = useState({
      language: "pt-BR",
      style: "CURIOSIDADE",
      targetDuration: project.targetDurationSeconds,
      voice: "cedar",
      speed: 1,
    }),
    [history, setHistory] = useState([]),
    [jobs, setJobs] = useState([]),
    [script, setScript] = useState(null),
    [evidence, setEvidence] = useState([]),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const inFlight = useRef(false),
    seen = useRef(new Set()),
    selected = useRef(null),
    dirtyRef = useRef(false);
  const setEditing = (value) => {
    setDirty(value);
    dirtyRef.current = value;
  };
  async function open(id) {
    const data = await remixStory.get(project.id, id);
    setScript(data);
    setConfig(data.config);
    selected.current = id;
    setEditing(false);
    const refs = await remixStory
      .evidence(project.id)
      .catch(() => ({ items: [] }));
    setEvidence(refs.items);
  }
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [jobData, versions] = await Promise.all([
          remixStory.jobs(project.id),
          remixStory.history(project.id),
        ]);
        if (!active) return;
        setJobs(jobData.items);
        setHistory(versions.items);
        const completed = jobData.items.find(
          (j) =>
            j.status === "COMPLETED" && j.result_id && !seen.current.has(j.id),
        );
        jobData.items.forEach((j) => {
          if (["COMPLETED", "FAILED", "CANCELLED"].includes(j.status))
            seen.current.add(j.id);
        });
        if (
          !dirtyRef.current &&
          (completed || (!selected.current && versions.items[0]))
        )
          await open(completed?.result_id ?? versions.items[0].id);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    void remixStory
      .options(project.id)
      .then((o) => {
        if (active) setOptions(o);
      })
      .catch((e) => active && setError(e.message));
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // The lifecycle follows the project; editor refreshes are guarded by dirtyRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const running = jobs.some((j) => ["QUEUED", "RUNNING"].includes(j.status)),
    locked = disabled || busy || running;
  async function act(fn) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const run = (operation, data = {}) =>
    act(async () => {
      if (dirty)
        throw Error("Salve as alterações do texto antes de continuar.");
      if (
        !window.confirm(
          "Autorizar esta operação de IA? Chamadas novas podem consumir sua API.",
        )
      )
        return;
      await remixStory.run(project.id, script, operation, data);
      setMessage(
        "Operação enviada à fila. Áudio idêntico será reutilizado quando disponível.",
      );
      const r = await remixStory.jobs(project.id);
      setJobs(r.items);
    });
  const allSupported =
    script &&
    !script.stale &&
    script.segments.every((s) => s.validation.status === "SUPPORTED");
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-border p-4">
      <h2 className="text-xl font-semibold">Roteiro e Narração</h2>
      <p className="text-sm text-muted-foreground">
        Use os trechos selecionados na Análise Inteligente. O roteiro será
        revisado contra as evidências antes da narração. A voz produzida é
        gerada por IA.
      </p>
      {error && (
        <p role="alert" className="break-words text-red-400">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Idioma
          <select
            aria-label="Idioma do roteiro Remix"
            className={field}
            value={config.language}
            disabled={locked}
            onChange={(e) => setConfig({ ...config, language: e.target.value })}
          >
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </label>
        <label>
          Estilo
          <select
            aria-label="Estilo do roteiro Remix"
            className={field}
            value={config.style}
            disabled={locked}
            onChange={(e) => setConfig({ ...config, style: e.target.value })}
          >
            {Object.entries(styles).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duração desejada (segundos)
          <input
            aria-label="Duração do roteiro Remix"
            className={field}
            type="number"
            min="5"
            max="600"
            value={config.targetDuration}
            disabled={locked}
            onChange={(e) =>
              setConfig({ ...config, targetDuration: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Voz
          <select
            aria-label="Voz do roteiro Remix"
            className={field}
            value={config.voice}
            disabled={locked}
            onChange={(e) => setConfig({ ...config, voice: e.target.value })}
          >
            {(options?.voices ?? ["cedar"]).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Velocidade de fala
          <input
            aria-label="Velocidade do roteiro Remix"
            className={field}
            type="number"
            min="0.75"
            max="1.25"
            step="0.05"
            value={config.speed}
            disabled={locked}
            onChange={(e) =>
              setConfig({ ...config, speed: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <p className="text-sm">
        Provedor: {options?.provider ?? "…"} · Modelo de roteiro:{" "}
        {options?.scriptModel || "Não configurado"} · Modelo de voz:{" "}
        {options?.ttsModel ?? "…"}
      </p>
      <p className="text-sm">
        {options?.costNotice} Limite: {options?.maxJobsPerProject ?? "…"}{" "}
        operações e {options?.maxTtsCharactersPerProject ?? "…"} caracteres
        reservados por projeto. Um texto por chamada de TTS admite até{" "}
        {options?.maxCharactersPerRequest ?? "…"} caracteres.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={locked || dirty || !options?.enabled}
          onClick={() =>
            void act(async () => {
              if (
                !window.confirm(
                  "Gerar e validar o roteiro com IA a partir dos trechos selecionados? Isso pode consumir sua API.",
                )
              )
                return;
              await remixStory.generate(project.id, config);
              setJobs((await remixStory.jobs(project.id)).items);
              setMessage("Roteiro enviado à fila.");
            })
          }
        >
          Gerar roteiro com IA
        </button>
        {script && (
          <button
            className={button}
            disabled={locked || dirty}
            onClick={() =>
              void act(async () => {
                const updated = await remixStory.save(project.id, script, {
                  config,
                });
                setScript(updated);
                setMessage(
                  "Configuração salva. A narração será invalidada quando necessário.",
                );
              })
            }
          >
            Salvar configuração no roteiro
          </button>
        )}
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void act(async () => {
              if (
                dirty &&
                !window.confirm("Descartar alterações não salvas e atualizar?")
              )
                return;
              const refs = await remixStory.evidence(project.id);
              setEvidence(refs.items);
              if (script) await open(script.id);
            })
          }
        >
          Atualizar trechos e roteiro
        </button>
      </div>
      {!options?.enabled && options && (
        <p>
          Configure OPENAI_API_KEY e VIDEO_REMIX_SCRIPT_MODEL ou
          VIDEO_REMIX_ANALYSIS_MODEL no servidor.
        </p>
      )}
      {history.length > 0 && (
        <label className="block">
          Versão do roteiro
          <select
            aria-label="Versão do roteiro Remix"
            className={field}
            disabled={locked || dirty}
            value={script?.id ?? ""}
            onChange={(e) => void act(() => open(e.target.value))}
          >
            <option value="" disabled>
              Selecione
            </option>
            {history.map((h) => (
              <option value={h.id} key={h.id}>
                Versão {h.version} · revisão {h.revision} ·{" "}
                {styles[h.config.style]}
              </option>
            ))}
          </select>
        </label>
      )}
      {jobs.length > 0 && (
        <details>
          <summary>Histórico de roteiro e narração ({jobs.length})</summary>
          <div className="space-y-2">
            {jobs.map((j) => (
              <article className="rounded border border-border p-3" key={j.id}>
                <p>
                  {j.kind} · {phases[j.status]}{" "}
                  {j.status === "RUNNING"
                    ? `· ${phases[j.progress.stage] ?? ""} ${j.progress.completed ?? 0}/${j.progress.total ?? 0}`
                    : ""}
                </p>
                <p>
                  {j.usage.totalTokens ?? 0} tokens reportados ·{" "}
                  {j.usage.charactersSubmitted ?? 0} caracteres submetidos ao
                  TTS
                </p>
                {j.error_message && <p role="alert">{j.error_message}</p>}
                {["QUEUED", "RUNNING"].includes(j.status) && (
                  <button
                    className={button}
                    onClick={() =>
                      void act(() => remixStory.cancel(project.id, j.id))
                    }
                  >
                    Cancelar operação
                  </button>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
      {script && (
        <>
          <div className="space-y-2">
            <h3 className="font-semibold">
              Roteiro completo · versão {script.version}
            </h3>
            {script.stale && (
              <p role="alert">
                As fontes ou os trechos selecionados mudaram. Revise as
                associações e valide novamente.
              </p>
            )}
            <textarea
              aria-label="Roteiro completo Remix"
              readOnly
              className={`${field} min-h-36`}
              value={script.fullText}
            />
            <CopyTextButton text={script.fullText} />
            <p>
              Estimativa: {script.estimatedSeconds.toFixed(1)}s · Alvo:{" "}
              {script.desiredSeconds}s · Áudio real:{" "}
              {script.actualSeconds === null
                ? "pendente"
                : `${script.actualSeconds.toFixed(2)}s`}
            </p>
            {script.differenceSeconds > 0 && (
              <p role="alert">
                A narração ultrapassa o alvo em{" "}
                {script.differenceSeconds.toFixed(2)}s. Reduza o texto ou ajuste
                a velocidade e gere novamente. Nenhuma palavra será cortada
                automaticamente.
              </p>
            )}
            <details>
              <summary>Planejamento e lacunas visuais</summary>
              <p>{script.plan.structure}</p>
              {script.plan.visualGaps?.map((g, i) => (
                <p key={i}>{g}</p>
              ))}
            </details>
          </div>
          <StoryEditor
            key={`${script.id}-${script.revision}`}
            script={script}
            evidence={evidence}
            disabled={locked}
            onDirty={setEditing}
            onSave={(segments) =>
              void act(async () => {
                const updated = await remixStory.save(project.id, script, {
                  segments,
                });
                setScript(updated);
                setEditing(false);
                setMessage(
                  "Texto salvo. Valide a correspondência antes de gerar o áudio.",
                );
              })
            }
            onRun={run}
            project={project}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={locked || dirty || !options?.enabled}
              onClick={() => void run("validate")}
            >
              Validar correspondência visual
            </button>
            <button
              className={button}
              disabled={locked || dirty || !allSupported}
              onClick={() => void run("narrate", { mode: "SEGMENTED" })}
            >
              Gerar narração segmentada
            </button>
            <button
              className={button}
              disabled={locked || dirty || !allSupported}
              onClick={() => void run("narrate", { mode: "FULL" })}
            >
              Gerar narração completa
            </button>
          </div>
          {!allSupported && (
            <p>
              Revise os avisos, reformule o texto ou associe outra cena.
              Segmentos sem suporte suficiente não serão narrados.
            </p>
          )}
          {script.fullNarration && !script.stale && (
            <div>
              <p>
                Narração completa ·{" "}
                {script.fullNarration.duration_seconds.toFixed(2)}s
              </p>
              <audio
                className="w-full max-w-full"
                controls
                preload="none"
                src={remixStory.audioUrl(
                  project.id,
                  script.id,
                  script.fullNarration.id,
                )}
              />
            </div>
          )}
          <details>
            <summary>Sincronização preliminar</summary>
            <div className="space-y-3">
              {script.segments.map((s, i) => (
                <div key={s.id}>
                  <p>
                    Segmento {i + 1}: vídeo disponível{" "}
                    {s.sync.visualSeconds.toFixed(2)}s · áudio{" "}
                    {s.sync.audioSeconds === null
                      ? "pendente"
                      : `${s.sync.audioSeconds.toFixed(2)}s`}{" "}
                    · diferença{" "}
                    {s.sync.differenceSeconds === null
                      ? "pendente"
                      : `${s.sync.differenceSeconds.toFixed(2)}s`}
                  </p>
                  {s.sync.suggestions.map((suggestion, index) => (
                    <p key={index}>{suggestion}</p>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
function StoryEditor({
  script,
  evidence,
  disabled,
  onDirty,
  onSave,
  onRun,
  project,
}) {
  const [drafts, setDrafts] = useState(() =>
      script.segments.map((s) => ({
        id: s.id,
        kind: s.kind,
        text: s.text,
        candidateIds: s.candidate_ids,
        notes: s.notes,
      })),
    ),
    [changed, setChanged] = useState(false),
    [preview, setPreview] = useState(null);
  function edit(next) {
    setDrafts(next);
    setChanged(true);
    onDirty(true);
  }
  function patch(id, key, value) {
    edit(drafts.map((d) => (d.id === id ? { ...d, [key]: value } : d)));
  }
  function move(index, direction) {
    const next = [...drafts];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    edit(next);
  }
  return (
    <div className="space-y-4">
      {changed && (
        <p role="status">
          Há alterações não salvas. O áudio e a validação serão atualizados ao
          salvar.
        </p>
      )}
      {drafts.map((draft, index) => {
        const segment = script.segments.find((s) => s.id === draft.id);
        return (
          <article
            className="space-y-3 rounded-lg border border-border p-3"
            key={draft.id}
          >
            <div className="flex flex-wrap gap-2">
              <label>
                Parte {index + 1}
                <select
                  aria-label={`Tipo do segmento ${index + 1}`}
                  className={field}
                  value={draft.kind}
                  disabled={disabled}
                  onChange={(e) => patch(draft.id, "kind", e.target.value)}
                >
                  {Object.entries(kinds).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={button}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                Subir
              </button>
              <button
                className={button}
                disabled={disabled || index === drafts.length - 1}
                onClick={() => move(index, 1)}
              >
                Descer
              </button>
              <button
                className={button}
                disabled={disabled || drafts.length <= 1}
                onClick={() => edit(drafts.filter((d) => d.id !== draft.id))}
              >
                Excluir segmento
              </button>
            </div>
            <label className="block">
              Texto da narração
              <textarea
                aria-label={`Texto do segmento ${index + 1}`}
                maxLength={1000}
                className={`${field} min-h-28`}
                disabled={disabled}
                value={draft.text}
                onChange={(e) => patch(draft.id, "text", e.target.value)}
              />
            </label>
            <p>
              {segment.estimated_seconds.toFixed(1)}s estimados ·{" "}
              {supportLabels[changed ? "PENDING" : segment.validation.status]}
            </p>
            {segment.validation.status !== "PENDING" && (
              <div>
                <p>{segment.validation.reason}</p>
                {segment.validation.suggestedRewrite && (
                  <p>Sugestão: {segment.validation.suggestedRewrite}</p>
                )}
              </div>
            )}
            <details>
              <summary>Cenas e trechos associados</summary>
              <div className="space-y-2">
                {evidence.map((r) => (
                  <label key={r.id} className="block break-words">
                    <input
                      type="checkbox"
                      checked={draft.candidateIds.includes(r.id)}
                      disabled={
                        disabled ||
                        (!draft.candidateIds.includes(r.id) &&
                          draft.candidateIds.length >= 3)
                      }
                      onChange={(e) =>
                        patch(
                          draft.id,
                          "candidateIds",
                          e.target.checked
                            ? [...draft.candidateIds, r.id]
                            : draft.candidateIds.filter((id) => id !== r.id),
                        )
                      }
                    />{" "}
                    {project.sources.find((s) => s.id === r.sourceId)?.title ??
                      "Fonte"}{" "}
                    · {remixTimestamp(r.start)}–{remixTimestamp(r.end)} ·{" "}
                    {r.description}
                  </label>
                ))}
                {segment.references.map((r) => (
                  <button
                    key={r.id}
                    className={button}
                    onClick={() => setPreview(r)}
                  >
                    Ver trecho {remixTimestamp(r.start)}–{remixTimestamp(r.end)}
                  </button>
                ))}
              </div>
            </details>
            <label className="block">
              Observações
              <input
                aria-label={`Observações do segmento ${index + 1}`}
                className={field}
                maxLength={1500}
                disabled={disabled}
                value={draft.notes}
                onChange={(e) => patch(draft.id, "notes", e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={disabled || changed}
                onClick={() =>
                  void onRun("regenerate", { segmentId: draft.id })
                }
              >
                Regenerar este segmento
              </button>
              <button
                className={button}
                disabled={
                  disabled ||
                  changed ||
                  script.stale ||
                  segment.validation.status !== "SUPPORTED"
                }
                onClick={() =>
                  void onRun("narrate", {
                    segmentId: draft.id,
                    mode: "SEGMENTED",
                  })
                }
              >
                Gerar ou reutilizar áudio do segmento
              </button>
            </div>
            {segment.narration && !changed && !script.stale && (
              <div>
                <p>
                  Áudio real: {segment.narration.duration_seconds.toFixed(2)}s ·{" "}
                  {segment.narration.settings.voice} ·{" "}
                  {segment.narration.character_count} caracteres
                </p>
                <audio
                  className="w-full max-w-full"
                  controls
                  preload="none"
                  src={remixStory.audioUrl(
                    project.id,
                    script.id,
                    segment.narration.id,
                  )}
                />
              </div>
            )}
          </article>
        );
      })}
      <button
        className={button}
        disabled={
          disabled ||
          !changed ||
          drafts.some((d) => !d.text.trim() || !d.candidateIds.length)
        }
        onClick={() => onSave(drafts)}
      >
        Salvar alterações do roteiro
      </button>
      {preview && project.files.find((f) => f.id === preview.fileId) && (
        <video
          className="max-h-80 w-full"
          controls
          preload="metadata"
          src={remixFileUrl(
            project.files.find((f) => f.id === preview.fileId).url,
          )}
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = preview.start;
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= preview.end)
              e.currentTarget.pause();
          }}
        />
      )}
    </div>
  );
}
