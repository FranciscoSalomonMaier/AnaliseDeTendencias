import { useCallback, useEffect, useRef, useState } from "react";
import { contentProjects } from "../../services/contentProjectService";
import {
  canGenerateScenes,
  projectStep,
  projectStatusLabels,
  validProjectSteps,
} from "../../utils/contentProjectState";
import { ProjectConfiguration } from "./components/ProjectConfiguration";
import { ContentStudioStepper } from "./components/ContentStudioStepper";
import { ScriptStep } from "./components/ScriptStep";
import { ScenesStep } from "./components/ScenesStep";
import { VisualProduction } from "./components/VisualProduction";
import { VisualReferences } from "./components/VisualReferences";

export function ContentProjectCreation({ analysis, onNavigate }) {
  const initialId = analysis?.projectId || "";
  const [project, setProject] = useState(null),
    [projects, setProjects] = useState([]),
    [listOffset, setListOffset] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const [config, setConfig] = useState(() => ({
    type: "VIDEO",
    topic: analysis?.title ?? "",
    instructions: "",
    style: "DARK",
    language: "pt-BR",
    targetDurationSeconds: 300,
    ...(analysis?.source === "topic"
      ? { reference: { type: "TOPIC", id: analysis.topicId } }
      : { reference: { type: "MANUAL" } }),
  }));
  const [script, setScript] = useState(null),
    [scenes, setScenes] = useState([]),
    [step, setStep] = useState("config");
  const [busy, setBusy] = useState(initialId ? "restore" : ""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  const inFlight = useRef(false);
  const accept = useCallback((p, move = false) => {
    setProject(p);
    setConfig(p.config);
    setScript(p.script);
    setScenes(p.scenes);
    setSaved("");
    if (move) setStep(projectStep(p));
  }, []);
  const dirty = Boolean(
    project &&
    (JSON.stringify(config) !== JSON.stringify(project.config) ||
      JSON.stringify(script) !== JSON.stringify(project.script) ||
      JSON.stringify(scenes) !== JSON.stringify(project.scenes)),
  );
  useEffect(() => {
    let active = true;
    contentProjects
      .list()
      .then((r) => {
        if (active) {
          setProjects(r.items);
          setListOffset(r.items.length);
          setHasMore(r.items.length === 50);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!initialId) return;
    let active = true;
    contentProjects
      .get(initialId)
      .then((p) => {
        if (active) accept(p, true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, [initialId, accept]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e) => {
      if (
        !window.confirm(
          "Existem alterações não salvas. Deseja sair sem salvar?",
        )
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("content:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("content:before-navigate", navigate);
    };
  }, [dirty]);
  function ensureNavigation(callback) {
    if (
      !dirty ||
      window.confirm("Existem alterações não salvas. Deseja sair sem salvar?")
    )
      callback();
  }
  function remember(p) {
    const url = new URL(window.location.href);
    url.searchParams.set("projectId", p.id);
    window.history.replaceState({}, "", url);
    setProject(p);
  }
  async function run(label, work, move = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label);
    setError("");
    setSaved("");
    try {
      const p = await work();
      if (p) {
        accept(p, move);
        remember(p);
        setProjects((items) => [p, ...items.filter((i) => i.id !== p.id)]);
      }
      setSaved("Alterações salvas");
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  async function persistScript(p) {
    if (JSON.stringify(script) === JSON.stringify(p.script)) return p;
    const confirm = Boolean(p.scenes.length);
    if (
      confirm &&
      !window.confirm(
        "Salvar o roteiro vai desatualizar as cenas existentes. Continuar?",
      )
    )
      throw new Error("Salvamento cancelado.");
    const result = await contentProjects.saveScript(p, script, confirm);
    setProject(result);
    return result;
  }
  async function persistScenes(p) {
    let result = p;
    for (const scene of scenes) {
      const old = result.scenes.find((s) => s.id === scene.id);
      if (JSON.stringify(scene) !== JSON.stringify(old)) {
        result = await contentProjects.saveScene(result, scene);
        setProject(result);
      }
    }
    return result;
  }
  function regenerate(stage) {
    if (
      dirty &&
      !window.confirm(
        "Há alterações não salvas que poderão ser substituídas. Continuar?",
      )
    )
      return;
    const existing =
      stage === "ideas"
        ? project.ideas.length
        : stage === "script"
          ? project.script
          : project.scenes.length;
    if (
      existing &&
      !window.confirm(
        "Regenerar substituirá esta etapa e poderá desatualizar as próximas. Continuar?",
      )
    )
      return;
    void run(
      stage,
      () => contentProjects.generate(project, stage, Boolean(existing)),
      true,
    );
  }
  async function configure(event) {
    event.preventDefault();
    if (project) {
      const confirm = Boolean(
        project.ideas.length || project.script || project.scenes.length,
      );
      if (
        confirm &&
        !window.confirm(
          "Alterar a configuração desatualiza ideias, roteiro e cenas. Continuar?",
        )
      )
        return;
      void run(
        "config",
        () => contentProjects.update(project, config, confirm),
        true,
      );
      return;
    }
    void run(
      "ideas",
      async () => {
        const p = await contentProjects.create(config);
        accept(p);
        remember(p);
        return contentProjects.generate(p, "ideas", false);
      },
      true,
    );
  }
  function choose(idea) {
    if (project.selectedIdea?.ideaId === idea.ideaId) return;
    const confirm = Boolean(project.script || project.scenes.length);
    if (
      (confirm || dirty) &&
      !window.confirm(
        "Alterar a ideia pode invalidar o roteiro e as cenas existentes. Edições não salvas serão descartadas. Continuar?",
      )
    )
      return;
    void run(
      "select",
      () => contentProjects.select(project, idea.ideaId, confirm),
      true,
    );
  }
  const activeSteps = validProjectSteps(project);
  const displayedScript = script;
  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <div className="mb-5 flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-sky-300">
            Estúdio de conteúdo
          </p>
          <h1 className="text-2xl font-semibold">Criação</h1>
        </div>
        <button
          disabled={Boolean(busy)}
          onClick={() => onNavigate("content-creation")}
          className="rounded-xl border border-border px-4 py-2"
        >
          Novo projeto
        </button>
      </div>
      <div className="space-y-4">
        <ContentStudioStepper
          activeStep={step}
          projectSteps={activeSteps}
          hasIdeas={Boolean(project?.selectedIdea)}
          hasScript={canGenerateScenes(project)}
          hasScenes={project?.status === "SCENES_APPROVED"}
          onSelect={(target) => {
            if (busy) return;
            ensureNavigation(() => {
              if (project) accept(project);
              setStep(target);
            });
          }}
        />
        {project && (
          <p className="text-sm text-muted-foreground">
            {project.config.topic} · {projectStatusLabels[project.status]}{" "}
            {dirty ? "· Alterações não salvas" : ""}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sky-200">
            {busy === "restore"
              ? "Retomando projeto…"
              : "Aguarde, concluindo a etapa…"}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-400/30 p-3 text-red-200"
          >
            {error}{" "}
            {project && (
              <button
                disabled={Boolean(busy)}
                onClick={() =>
                  ensureNavigation(
                    () =>
                      void run(
                        "restore",
                        () => contentProjects.get(project.id),
                        true,
                      ),
                  )
                }
                className="ml-2 underline"
              >
                Reabrir versão salva
              </button>
            )}
          </div>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-300">
            {saved}
          </p>
        )}
        {(project?.scriptStale || project?.scenesStale) && (
          <p className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-200">
            {project.scriptStale
              ? "O roteiro está desatualizado. Gere outro para a ideia atual. "
              : " "}
            {project.scenesStale
              ? "As cenas estão desatualizadas. Aprove o roteiro atual e gere novamente."
              : ""}{" "}
            O material anterior continua salvo.
          </p>
        )}
        {step === "config" && busy !== "restore" && (
          <>
            <ProjectConfiguration
              config={config}
              onChange={(k, v) => setConfig((c) => ({ ...c, [k]: v }))}
              onSubmit={configure}
              busy={Boolean(busy)}
              existing={Boolean(project)}
            />
            <VisualReferences project={project} disabled={Boolean(busy) || !config.topic.trim() || (Boolean(project) && dirty)} onBusyChange={value => { inFlight.current = value; setBusy(value ? "upload" : ""); }} ensureProject={async () => {
              const p = await contentProjects.create(config);
              accept(p); remember(p);
              setProjects(items => [p,...items.filter(i => i.id !== p.id)]);
              return p;
            }} />
            {project && (
              <button
                disabled={Boolean(busy) || dirty}
                onClick={() => regenerate("ideas")}
                className="rounded-xl gradient-primary px-4 py-2 disabled:opacity-50"
              >
                Gerar ideias
              </button>
            )}
          </>
        )}
        {step === "idea" && project && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Escolha uma ideia</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {project.ideas.map((idea) => (
                <article
                  key={idea.ideaId}
                  className="rounded-2xl border border-border bg-card p-5 space-y-3"
                >
                  <h3 className="font-semibold">{idea.title}</h3>
                  <p className="text-sky-200">{idea.hook}</p>
                  <p className="text-sm text-muted-foreground">{idea.angle}</p>
                  <p>{idea.summary}</p>
                  {idea.targetAudience && (
                    <p className="text-xs text-muted-foreground">
                      Público: {idea.targetAudience}
                    </p>
                  )}
                  <button
                    disabled={Boolean(busy)}
                    aria-pressed={project.selectedIdea?.ideaId === idea.ideaId}
                    onClick={() => choose(idea)}
                    className="rounded-lg border border-sky-400/40 px-3 py-2"
                  >
                    {project.selectedIdea?.ideaId === idea.ideaId
                      ? "Ideia selecionada"
                      : "Escolher esta ideia"}
                  </button>
                </article>
              ))}
            </div>
            <button
              disabled={Boolean(busy)}
              onClick={() => regenerate("ideas")}
              className="rounded-xl border border-border px-4 py-2"
            >
              Regenerar ideias
            </button>
            <button
              disabled={Boolean(busy) || !project.selectedIdea}
              onClick={() => regenerate("script")}
              className="ml-2 rounded-xl gradient-primary px-4 py-2 disabled:opacity-50"
            >
              Gerar roteiro
            </button>
          </section>
        )}
        {step === "script" && displayedScript && !project?.scriptStale && (
          <ScriptStep
            script={displayedScript}
            selectedIdea={project.selectedIdea}
            onChange={(k, v) => setScript((s) => ({ ...s, [k]: v }))}
            onChangeSection={(index, k, v) =>
              setScript((s) => ({
                ...s,
                sections: s.sections.map((section, i) =>
                  i === index ? { ...section, [k]: v } : section,
                ),
              }))
            }
            onBack={() =>
              ensureNavigation(() => {
                accept(project);
                setStep("idea");
              })
            }
            onRegenerate={() => regenerate("script")}
            onSave={() => void run("save", () => persistScript(project))}
            onApprove={() =>
              void run("approve", async () =>
                contentProjects.approveScript(await persistScript(project)),
              )
            }
            scenesAllowed={canGenerateScenes(project) && !dirty}
            onGenerateScenes={() => regenerate("scenes")}
            busy={Boolean(busy)}
            saveStatus={saved ? "saved" : ""}
          />
        )}
        {step === "scenes" && project && !project.scenesStale && (
          <ScenesStep
            videoPlan={{ scenes }}
            onSceneChange={(index, k, v) =>
              setScenes((items) =>
                items.map((scene, i) =>
                  i === index ? { ...scene, [k]: v } : scene,
                ),
              )
            }
            onBack={() =>
              ensureNavigation(() => {
                accept(project);
                setStep("script");
              })
            }
            onSave={() => void run("save", () => persistScenes(project))}
            onRegenerate={() => regenerate("scenes")}
            onApprove={() =>
              void run(
                "approve",
                async () =>
                  contentProjects.approveScenes(await persistScenes(project)),
                true,
              )
            }
            busy={Boolean(busy)}
            saveStatus={saved ? "saved" : ""}
          />
        )}
        {step === "production" && project && (
          <VisualProduction
            project={project}
            onBack={() => setStep("scenes")}
          />
        )}
      </div>
      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-semibold">Seus projetos</h2>
        {!projects.length && (
          <p className="text-muted-foreground">Nenhum projeto salvo ainda.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <article
              key={p.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <h3 className="font-semibold">{p.config.topic}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Vídeo · Dark · {projectStatusLabels[p.status]}
              </p>
              <p className="text-xs text-muted-foreground">
                Atualizado: {new Date(p.updatedAt).toLocaleString("pt-BR")}
              </p>
              <button
                disabled={Boolean(busy)}
                onClick={() =>
                  onNavigate("content-creation", { projectId: p.id })
                }
                className="mt-3 rounded-lg border border-sky-400/40 px-3 py-2"
              >
                Abrir
              </button>
            </article>
          ))}
        </div>
        {hasMore && (
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              void run("list", async () => {
                const result = await contentProjects.list(listOffset);
                setProjects((items) => [
                  ...items,
                  ...result.items.filter(
                    (p) => !items.some((i) => i.id === p.id),
                  ),
                ]);
                setListOffset((n) => n + result.items.length);
                setHasMore(result.items.length === 50);
              })
            }
            className="rounded-xl border border-border px-4 py-2"
          >
            Carregar mais
          </button>
        )}
      </section>
    </div>
  );
}
