import { useCallback, useEffect, useState } from "react";
import { intelligentEditing } from "../../../services/intelligentEditingService";
import { renderMediaUrl } from "../../../services/videoRenderService";
import { motionNames } from "../../../utils/videoEditing";
import { SceneFramingPreview } from "./SceneFramingPreview";
const button =
  "rounded border border-sky-400/40 px-3 py-2 text-sm disabled:opacity-50";
const input = "rounded border border-border bg-theme p-2 text-sm";
const labels = {
  PENDING: "Na fila",
  PROCESSING: "Analisando",
  COMPLETED: "Aguardando revisão",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  APPROVED: "Aprovado",
  APPLIED: "Aplicado",
  RESTORED: "Edição anterior restaurada",
};
export function IntelligentEditing({ project, blocked = false, onApplied }) {
  const [listing, setListing] = useState(null),
    [plan, setPlan] = useState(null),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [format, setFormat] = useState(project.config.aspectRatio ?? "16:9"),
    [style, setStyle] = useState("CINEMATIC"),
    [intensity, setIntensity] = useState("MODERATE");
  const refresh = useCallback(async () => {
    const result = await intelligentEditing.list(project.id);
    setListing(result);
    if (selected) setPlan(await intelligentEditing.get(project.id, selected));
  }, [project.id, selected]);
  useEffect(() => {
    let active = true,
      timer;
    async function poll() {
      try {
        const result = await intelligentEditing.list(project.id);
        const current = selected
          ? await intelligentEditing.get(project.id, selected)
          : null;
        if (active) {
          setListing(result);
          setPlan(current);
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) timer = setTimeout(poll, 4000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [project.id, project.revision, selected]);
  async function run(work) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const active = listing?.plans.some((p) =>
    ["PENDING", "PROCESSING"].includes(p.status),
  );
  const editable = plan && ["COMPLETED", "APPROVED"].includes(plan.status);
  async function analyze() {
    if (
      !window.confirm(
        `Analisar ${project.scenes.length} cenas com ${listing.configuration.model}${listing.configuration.visualModel ? ` e imagens com ${listing.configuration.visualModel}` : ""}? Esta ação pode consumir créditos de IA.`,
      )
    )
      return;
    await run(async () => {
      const created = await intelligentEditing.analyze(project, {
        format,
        style,
        intensity,
      });
      setSelected(created.id);
      setPlan(created);
    });
  }
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-semibold">
        Edição Inteligente
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          A IA propõe uma interpretação editorial. Revise as sugestões antes de
          aplicar. A narração, a música e os tempos das legendas são
          preservados.
        </p>
        {error && (
          <p role="alert" className="text-red-200">
            {error}
          </p>
        )}
        {listing && (
          <>
            <p className="text-sm">
              {project.scenes.length} cenas · Modelo narrativo:{" "}
              {listing.configuration.model} · Visual:{" "}
              {listing.configuration.visualModel ??
                "não configurado; enquadramento estático seguro"}{" "}
              · Limite: {listing.configuration.maxScenes} cenas · Uma análise
              por vez no servidor.
            </p>
            {!listing.configuration.enabled && (
              <p className="text-amber-200">
                Configure a chave de acesso e a integração com IA no servidor
                para analisar. A edição manual continua disponível.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <label>
                Formato{" "}
                <select
                  className={input}
                  value={format}
                  disabled={busy}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option>16:9</option>
                  <option>9:16</option>
                </select>
              </label>
              <label>
                Estilo{" "}
                <select
                  className={input}
                  value={style}
                  disabled={busy}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {[
                    ["CINEMATIC", "Cinematográfico"],
                    ["DYNAMIC", "Dinâmico"],
                    ["SUSPENSE", "Suspense"],
                    ["DOCUMENTARY", "Documentário"],
                    ["MINIMALIST", "Minimalista"],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Intensidade{" "}
                <select
                  className={input}
                  value={intensity}
                  disabled={busy}
                  onChange={(e) => setIntensity(e.target.value)}
                >
                  {[
                    ["SUBTLE", "Baixa"],
                    ["MODERATE", "Média"],
                    ["STRONG", "Alta"],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className={button}
              disabled={
                busy ||
                blocked ||
                active ||
                !listing.configuration.enabled ||
                !project.scenes.length ||
                project.scenes.length > listing.configuration.maxScenes
              }
              onClick={() => void analyze()}
            >
              Analisar projeto com IA
            </button>
            {blocked && (
              <p className="text-amber-200">
                Salve as alterações e aguarde a renderização antes de analisar
                ou aplicar um plano.
              </p>
            )}
            {listing.plans.length > 0 && (
              <label className="block">
                Histórico de planos{" "}
                <select
                  aria-label="Histórico de planos"
                  className={`${input} max-w-full`}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Selecione um plano</option>
                  {listing.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.version} · {p.format} · {p.style} · {labels[p.status]}{" "}
                      · {new Date(p.createdAt).toLocaleString("pt-BR")}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {plan && (
          <article className="space-y-3">
            <h4 className="font-semibold">
              Plano #{plan.version} · {plan.format} · {labels[plan.status]}
            </h4>
            {plan.stale && (
              <p role="alert" className="text-amber-200">
                Plano desatualizado: o projeto ou a edição mudou. Gere uma nova
                análise antes de aplicar.
              </p>
            )}
            {plan.error && (
              <p role="alert" className="text-amber-200">
                {plan.error}
              </p>
            )}
            {["PENDING", "PROCESSING"].includes(plan.status) && (
              <div role="status">
                <p>{plan.progress}% · Você pode fechar a página.</p>
                <progress max="100" value={plan.progress} />
                <button
                  className={button}
                  disabled={busy || plan.cancelRequested}
                  onClick={() =>
                    void run(() =>
                      intelligentEditing.action(project.id, plan, "cancel"),
                    )
                  }
                >
                  Cancelar análise
                </button>
              </div>
            )}
            {plan.result && (
              <>
                <p>{plan.result.summary}</p>
                <p className="text-sm">Ritmo: {plan.result.rhythm}</p>
                <ul className="list-disc pl-5 text-sm">
                  {plan.result.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Sugestões de legenda, duração e áudio são recomendações para
                  revisão manual. A prévia FFmpeg mostra até duas cenas,
                  silenciosas e aceleradas.
                </p>
                {plan.result.scenes.map((scene) => (
                  <SceneSuggestion
                    key={`${plan.id}:${plan.revision}:${scene.sceneId}`}
                    scene={scene}
                    project={project}
                    plan={plan}
                    disabled={!editable || busy || blocked}
                    onReview={(body) =>
                      void run(() =>
                        intelligentEditing.review(project.id, plan, body),
                      )
                    }
                  />
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy || blocked || !editable}
                    onClick={() =>
                      void run(() =>
                        intelligentEditing.approve(project.id, plan),
                      )
                    }
                  >
                    Aprovar todas as não rejeitadas
                  </button>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      blocked ||
                      plan.stale ||
                      plan.status !== "APPROVED"
                    }
                    onClick={() => {
                      if (
                        window.confirm(
                          "Aplicar as sugestões aceitas? Cenas manuais protegidas serão preservadas.",
                        )
                      )
                        void run(async () => {
                          await intelligentEditing.action(
                            project.id,
                            plan,
                            "apply",
                          );
                          await onApplied();
                        });
                    }}
                  >
                    Aplicar plano
                  </button>
                  <button
                    className={button}
                    disabled={
                      busy || blocked || plan.stale || plan.status !== "APPLIED"
                    }
                    onClick={() =>
                      void run(async () => {
                        await intelligentEditing.action(
                          project.id,
                          plan,
                          "preview",
                        );
                        await onApplied();
                      })
                    }
                  >
                    Gerar prévia FFmpeg
                  </button>
                  <button
                    className={button}
                    disabled={busy || blocked || plan.status !== "APPLIED"}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restaurar a edição anterior? A operação será bloqueada se houver edições posteriores.",
                        )
                      )
                        void run(async () => {
                          await intelligentEditing.action(
                            project.id,
                            plan,
                            "restore",
                          );
                          await onApplied();
                        });
                    }}
                  >
                    Restaurar configurações anteriores
                  </button>
                </div>
              </>
            )}
            {plan.usage.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Consumo registrado:{" "}
                {plan.usage.reduce((sum, u) => sum + u.totalTokens, 0)} tokens
                em {plan.usage.length} chamadas concluídas. Cancelamentos e
                falhas podem ter consumo adicional no provider.
              </p>
            )}
            {plan.events && (
              <details>
                <summary>Histórico de revisão e aplicação</summary>
                <ul className="text-xs">
                  {plan.events.map((e, i) => (
                    <li key={i}>
                      {e.action} ·{" "}
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                      {e.details?.skipped?.length
                        ? ` · ${e.details.skipped.length} cenas manuais preservadas`
                        : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        )}
      </div>
    </details>
  );
}
export function SceneSuggestion({ scene, project, plan, disabled, onReview }) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(scene);
  const order =
    project.scenes.find((s) => s.id === scene.sceneId)?.order ?? "?";
  const source = plan.sources.find((s) => s.sceneId === scene.sceneId);
  const before =
    plan.before.variants?.[plan.format]?.[scene.sceneId] ??
    ((plan.before.aspectRatio ?? project.config?.aspectRatio ?? "16:9") ===
    plan.format
      ? plan.before.scenes[scene.sceneId]
      : undefined);
  const patch = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const suggestion = () =>
    Object.fromEntries(
      [
        "sceneId",
        "narrativeRole",
        "tensionLevel",
        "emotionalTone",
        "pacing",
        "movement",
        "intensity",
        "interpolation",
        "fit",
        "focalPoint",
        "zoom",
        "transition",
        "explanation",
        "continuity",
        "recommendation",
      ].map((k) => [k, draft[k]]),
    );
  return (
    <details className="rounded border border-border p-3 text-sm">
      <summary className="cursor-pointer">
        Cena {order} · {scene.narrativeRole} ·{" "}
        {scene.decision === "ACCEPTED"
          ? "Aceita"
          : scene.decision === "REJECTED"
            ? "Rejeitada"
            : "Pendente"}
      </summary>
      <div className="mt-3 space-y-2">
        {source && (
          <SceneFramingPreview
            src={renderMediaUrl(
              `/content-projects/${project.id}/assets/${source.assetId}/file`,
            )}
            choice={scene.effective}
            aspectRatio={plan.format}
          />
        )}
        <p>
          Antes: {motionNames[before?.motion ?? "AUTO"]} ·{" "}
          {before?.fit ?? "CONTAIN"}
          {before?.locked ? " · Protegida" : ""}
        </p>
        <p>
          Sugestão: {motionNames[scene.movement]} · {scene.intensity} ·{" "}
          {scene.fit} · Foco ({scene.focalPoint.x.toFixed(2)},{" "}
          {scene.focalPoint.y.toFixed(2)}) · {scene.transition.type}{" "}
          {scene.transition.durationSeconds}s
        </p>
        <p>
          Efetivo validado: {motionNames[scene.effective.motion]} ·{" "}
          {scene.effective.fit} · Amplitude {scene.effective.amplitude}
        </p>
        <p>{scene.explanation}</p>
        <p>Continuidade: {scene.continuity}</p>
        <p>Recomendação: {scene.recommendation}</p>
        {scene.visual && (
          <p>
            Composição: {scene.visual.subject} · {scene.visual.composition} ·
            Legendas: {scene.visual.subtitleArea} (recomendação).
          </p>
        )}
        {scene.warnings.map((w) => (
          <p key={w} className="text-amber-200">
            {w}
          </p>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              onReview({ sceneId: scene.sceneId, decision: "ACCEPTED" })
            }
          >
            Aceitar
          </button>
          <button
            className={button}
            disabled={disabled}
            onClick={() => setEditing(!editing)}
          >
            Editar sugestão
          </button>
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              onReview({ sceneId: scene.sceneId, decision: "REJECTED" })
            }
          >
            Rejeitar / manter anterior
          </button>
        </div>
        {editing && (
          <fieldset disabled={disabled} className="flex flex-wrap gap-3">
            <legend>Editar sugestão da cena {order}</legend>
            <label>
              Movimento{" "}
              <select
                className={input}
                value={draft.movement}
                onChange={(e) => patch("movement", e.target.value)}
              >
                {Object.entries(motionNames)
                  .filter(([v]) => v !== "AUTO")
                  .map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Enquadramento{" "}
              <select
                className={input}
                value={draft.fit}
                onChange={(e) => patch("fit", e.target.value)}
              >
                {["CONTAIN", "COVER", "BLURRED_BACKGROUND"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Intensidade{" "}
              <select
                className={input}
                value={draft.intensity}
                onChange={(e) => patch("intensity", e.target.value)}
              >
                {["SUBTLE", "MODERATE", "STRONG"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Interpolação{" "}
              <select
                className={input}
                value={draft.interpolation}
                onChange={(e) => patch("interpolation", e.target.value)}
              >
                {["LINEAR", "EASE_IN", "EASE_OUT", "EASE_IN_OUT"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {["x", "y"].map((axis) => (
              <label key={axis}>
                Foco {axis}{" "}
                <input
                  className={`${input} w-24`}
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.focalPoint[axis]}
                  onChange={(e) =>
                    patch("focalPoint", {
                      ...draft.focalPoint,
                      [axis]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
            <label>
              Zoom{" "}
              <input
                className={`${input} w-24`}
                type="number"
                min="1"
                max="1.15"
                step="0.01"
                value={draft.zoom}
                onChange={(e) => patch("zoom", Number(e.target.value))}
              />
            </label>
            <label>
              Transição{" "}
              <select
                className={input}
                value={draft.transition.type}
                onChange={(e) =>
                  patch("transition", {
                    ...draft.transition,
                    type: e.target.value,
                  })
                }
              >
                {["CUT", "FADE", "CROSSFADE"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Duração da transição{" "}
              <input
                className={`${input} w-24`}
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={draft.transition.durationSeconds}
                onChange={(e) =>
                  patch("transition", {
                    ...draft.transition,
                    durationSeconds: Number(e.target.value),
                  })
                }
              />
            </label>
            <button
              className={button}
              onClick={() =>
                onReview({
                  sceneId: scene.sceneId,
                  decision: "ACCEPTED",
                  suggestion: suggestion(),
                })
              }
            >
              Salvar e aceitar sugestão
            </button>
          </fieldset>
        )}
      </div>
    </details>
  );
}
