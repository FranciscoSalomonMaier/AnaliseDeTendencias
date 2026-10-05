import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, FolderOpenIcon } from "@heroicons/react/24/outline";
import {
  generateContentIdeas,
  generateContentScenes,
  generateContentScript,
  getContentGeneration,
  saveReviewedContentScript,
  saveReviewedContentPlan,
  selectContentIdea,
} from "../../services/contentGenerationService";
import { ContentReferenceCard } from "./components/ContentReferenceCard";
import { ContentStudioStepper } from "./components/ContentStudioStepper";
import { IdeaStep } from "./components/IdeaStep";
import { ScriptStep } from "./components/ScriptStep";
import { ScenesStep } from "./components/ScenesStep";
import { ProductionStep } from "./components/ProductionStep";

const LEGACY_DRAFTS_KEY = "trend-analyzer-content-drafts";

function readLegacyDrafts() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LEGACY_DRAFTS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function addGenerationIdToUrl(generationId) {
  const url = new URL(window.location.href);
  url.searchParams.set("generationId", generationId);
  window.history.replaceState({}, "", url);
}

export function ContentCreation({ onNavigate, analysis }) {
  const [initialGenerationId] = useState(() => analysis?.generationId || new URLSearchParams(window.location.search).get("generationId") || "");
  const [generationId, setGenerationId] = useState(initialGenerationId);
  const [step, setStep] = useState("idea");
  const [ideas, setIdeas] = useState([]);
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [script, setScript] = useState(null);
  const [scriptBaseline, setScriptBaseline] = useState("");
  const [videoPlan, setVideoPlan] = useState(null);
  const [planBaseline, setPlanBaseline] = useState("");
  const [settings, setSettings] = useState({
    language: "pt-BR",
    durationPreference: "8-10",
    additionalInstructions: "",
  });
  const [busy, setBusy] = useState(initialGenerationId ? "restore" : "");
  const [selectingIdeaId, setSelectingIdeaId] = useState("");
  const [scriptSaveStatus, setScriptSaveStatus] = useState("");
  const [planSaveStatus, setPlanSaveStatus] = useState("");
  const [error, setError] = useState("");
  const [legacyDrafts] = useState(readLegacyDrafts);
  const requestInFlight = useRef(false);
  const scriptSaveTimer = useRef(null);
  const pendingScriptSave = useRef(Promise.resolve());
  const planSaveTimer = useRef(null);
  const pendingPlanSave = useRef(Promise.resolve());

  useEffect(() => {
    if (!initialGenerationId) return undefined;
    let active = true;
    getContentGeneration(initialGenerationId)
      .then((context) => {
        if (!active) return;
        setIdeas(context.ideas ?? []);
        setSelectedIdea(context.selectedIdea ?? null);
        if (context.selectedIdea) {
          setSettings((current) => ({
            ...current,
            language: context.selectedIdea.language,
            durationPreference: context.selectedIdea.durationPreference ?? current.durationPreference,
            additionalInstructions: context.selectedIdea.additionalInstructions ?? current.additionalInstructions,
          }));
        }
        if (context.script && context.selectedIdea) {
          const restoredScript = {
            ...context.script,
            generationId: initialGenerationId,
            ideaId: context.selectedIdea.ideaId,
            language: context.selectedIdea.language,
          };
          setScript(restoredScript);
          setScriptBaseline(JSON.stringify(restoredScript));
        }
        if (context.videoPlan) {
          const restoredPlan = { ...context.videoPlan, generationId: initialGenerationId };
          setVideoPlan(restoredPlan);
          setPlanBaseline(JSON.stringify(restoredPlan));
        }
        setStep(context.productionApproved ? "production" : context.videoPlan ? "scenes" : context.script ? "script" : "idea");
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Não foi possível retomar esta geração.");
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => { active = false; };
  }, [initialGenerationId]);

  const reference = useMemo(() => analysis ? {
    ...analysis,
    referenceTitle: analysis.referenceTitle || analysis.title,
  } : null, [analysis]);
  const scriptChanged = Boolean(script && scriptBaseline !== JSON.stringify(script));
  const videoPlanChanged = Boolean(videoPlan && planBaseline !== JSON.stringify(videoPlan));

  useEffect(() => {
    if (!scriptChanged || !script || !generationId) return undefined;
    let active = true;
    scriptSaveTimer.current = window.setTimeout(() => {
      const saveRequest = pendingPlanSave.current
        .catch(() => {})
        .then(() => saveReviewedContentScript(generationId, script));
      pendingScriptSave.current = saveRequest;
      saveRequest
        .then(() => {
          if (active) setScriptSaveStatus("saved");
        })
        .catch((saveError) => {
          if (!active) return;
          setScriptSaveStatus("error");
          setError(saveError.message || "Não foi possível salvar as alterações do roteiro.");
        });
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(scriptSaveTimer.current);
    };
  }, [generationId, script, scriptChanged]);

  useEffect(() => {
    if (!videoPlanChanged || !videoPlan || !script || !generationId) return undefined;
    let active = true;
    const planSnapshot = videoPlan;
    const timer = window.setTimeout(() => {
      const saveRequest = saveReviewedContentPlan(generationId, script, planSnapshot, false);
      pendingPlanSave.current = saveRequest;
      saveRequest
        .then(() => {
          if (!active) return;
          setPlanBaseline(JSON.stringify(planSnapshot));
          setPlanSaveStatus("saved");
        })
        .catch((saveError) => {
          if (!active) return;
          setPlanSaveStatus("error");
          setError(saveError.message || "Não foi possível salvar as alterações das cenas.");
        });
    }, 600);
    planSaveTimer.current = timer;
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [generationId, script, videoPlan, videoPlanChanged]);

  function updateSettings(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleGenerateIdeas() {
    if (!analysis?.trendId) {
      setError("Esta referência não está associada a uma trend analisável.");
      return;
    }
    if ((selectedIdea || script || videoPlan) && !window.confirm(
      "Gerar novas ideias cria uma nova geração. O trabalho atual continuará salvo, mas sairá deste workspace. Continuar?",
    )) return;
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy("ideas");
    setError("");
    try {
      const result = await generateContentIdeas({
        trendId: analysis.trendId,
        referenceVideoId: analysis.videoId || undefined,
        regionCode: analysis.regionCode || "BR",
        ...settings,
      });
      if (!result.length) throw new Error("A API não retornou ideias para esta trend.");
      const nextGenerationId = result[0].generationId;
      setGenerationId(nextGenerationId);
      addGenerationIdToUrl(nextGenerationId);
      setIdeas(result);
      setSelectedIdea(null);
      setScript(null);
      setScriptBaseline("");
      setVideoPlan(null);
      setPlanBaseline("");
      setStep("idea");
    } catch (generationError) {
      setError(generationError.message || "Não foi possível gerar ideias. Tente novamente.");
    } finally {
      requestInFlight.current = false;
      setBusy("");
    }
  }

  async function handleSelectIdea(idea) {
    if (!generationId || selectingIdeaId) return;
    if (selectedIdea?.ideaId === idea.ideaId) return;
    if ((script || videoPlan) && !window.confirm(
      "Trocar a ideia removerá o roteiro e as cenas desta geração. Deseja continuar?",
    )) return;
    if (scriptSaveTimer.current) window.clearTimeout(scriptSaveTimer.current);
    if (planSaveTimer.current) window.clearTimeout(planSaveTimer.current);
    setSelectingIdeaId(idea.ideaId);
    setError("");
    try {
      await Promise.all([
        pendingScriptSave.current.catch(() => {}),
        pendingPlanSave.current.catch(() => {}),
      ]);
      const savedIdea = await selectContentIdea(generationId, idea);
      setSelectedIdea(savedIdea);
      setScript(null);
      setScriptBaseline("");
      setVideoPlan(null);
      setPlanBaseline("");
      setScriptSaveStatus("");
      setStep("idea");
    } catch (selectionError) {
      setError(selectionError.message || "Não foi possível salvar a seleção da ideia.");
    } finally {
      setSelectingIdeaId("");
    }
  }

  async function handleGenerateScript() {
    if (!selectedIdea || requestInFlight.current) return;
    if ((scriptChanged || videoPlan) && !window.confirm(
      "Gerar novamente substituirá as edições atuais do roteiro e removerá o plano de cenas. Continuar?",
    )) return;
    requestInFlight.current = true;
    if (scriptSaveTimer.current) window.clearTimeout(scriptSaveTimer.current);
    if (planSaveTimer.current) window.clearTimeout(planSaveTimer.current);
    await Promise.all([
      pendingScriptSave.current.catch(() => {}),
      pendingPlanSave.current.catch(() => {}),
    ]);
    setBusy("script");
    setError("");
    try {
      const result = await generateContentScript(selectedIdea);
      setScript(result);
      setScriptBaseline(JSON.stringify(result));
      setScriptSaveStatus("");
      setVideoPlan(null);
      setPlanBaseline("");
      setStep("script");
    } catch (generationError) {
      setError(generationError.message || "Não foi possível gerar o roteiro. Tente novamente.");
    } finally {
      requestInFlight.current = false;
      setBusy("");
    }
  }

  function updateScript(field, value) {
    if (videoPlan && !window.confirm("Editar o roteiro removerá as cenas atuais. Continuar?")) return;
    setScript((current) => ({ ...current, [field]: value }));
    setVideoPlan(null);
    setPlanBaseline("");
    setScriptSaveStatus("saving");
    setError("");
  }

  function updateScriptSection(index, field, value) {
    if (videoPlan && !window.confirm("Editar o roteiro removerá as cenas atuais. Continuar?")) return;
    setScript((current) => ({
      ...current,
      sections: current.sections.map((section, sectionIndex) => sectionIndex === index
        ? { ...section, [field]: value }
        : section),
    }));
    setVideoPlan(null);
    setPlanBaseline("");
    setScriptSaveStatus("saving");
    setError("");
  }

  async function handleGenerateScenes() {
    if (!script || requestInFlight.current) return;
    if (videoPlan && !window.confirm("Gerar cenas novamente substituirá as cenas atuais. Continuar?")) return;
    requestInFlight.current = true;
    if (scriptSaveTimer.current) window.clearTimeout(scriptSaveTimer.current);
    if (planSaveTimer.current) window.clearTimeout(planSaveTimer.current);
    setBusy("scenes");
    setError("");
    try {
      await Promise.all([
        pendingScriptSave.current.catch(() => {}),
        pendingPlanSave.current.catch(() => {}),
      ]);
      if (scriptChanged) {
        const saveRequest = saveReviewedContentScript(generationId, script);
        pendingScriptSave.current = saveRequest;
        await saveRequest;
      }
      const result = await generateContentScenes(script);
      const nextPlan = { ...result, generationId };
      setVideoPlan(nextPlan);
      setPlanBaseline(JSON.stringify(nextPlan));
      setPlanSaveStatus("");
      setStep("scenes");
    } catch (generationError) {
      setError(generationError.message || "Não foi possível gerar as cenas. Tente novamente.");
    } finally {
      requestInFlight.current = false;
      setBusy("");
    }
  }

  function updateScene(index, field, value) {
    setPlanSaveStatus("saving");
    setError("");
    setVideoPlan((current) => {
      const scenes = current.scenes.map((scene, sceneIndex) => sceneIndex === index
        ? { ...scene, [field]: value }
        : scene);
      return {
        ...current,
        scenes,
        totalEstimatedDurationSeconds: scenes.reduce((total, scene) => total + scene.estimatedDurationSeconds, 0),
      };
    });
  }

  async function handleApproveScenes() {
    if (!generationId || !script || !videoPlan || requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy("save-plan");
    setError("");
    try {
      if (planSaveTimer.current) window.clearTimeout(planSaveTimer.current);
      await pendingPlanSave.current.catch(() => {});
      if (videoPlanChanged) {
        const saveRequest = saveReviewedContentPlan(generationId, script, videoPlan, false);
        pendingPlanSave.current = saveRequest;
        await saveRequest;
      }
      const savedPlan = await saveReviewedContentPlan(generationId, script, videoPlan, true);
      const approvedPlan = { ...savedPlan, generationId };
      setVideoPlan(approvedPlan);
      setPlanBaseline(JSON.stringify(approvedPlan));
      setPlanSaveStatus("saved");
      setStep("production");
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar as cenas revisadas.");
    } finally {
      requestInFlight.current = false;
      setBusy("");
    }
  }

  const canReturnTo = (target) => ({
    idea: ideas.length > 0,
    script: Boolean(script),
    scenes: Boolean(videoPlan),
    production: false,
  })[target];

  function navigateToStep(target) {
    if (canReturnTo(target)) {
      setError("");
      setStep(target);
    }
  }

  return (
    <div className="min-h-screen bg-theme p-4 text-white md:p-6">
      <button type="button" onClick={() => onNavigate("youtube-list")} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-white">
        <ArrowLeftIcon className="size-4" /> Voltar para o YouTube
      </button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs uppercase tracking-[0.2em] text-sky-300">Estúdio de conteúdo</p>
        <h1 className="mt-1 text-2xl font-semibold">Criar conteúdo</h1></div>
        <button type="button" onClick={() => onNavigate("content-library")} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-white"><FolderOpenIcon className="size-4" /> Biblioteca de conteúdos</button>
      </div>

      <div className="space-y-4">
        <ContentReferenceCard reference={reference} />
        <ContentStudioStepper
          activeStep={step}
          hasIdeas={ideas.length > 0}
          hasScript={Boolean(script)}
          hasScenes={Boolean(videoPlan)}
          onSelect={navigateToStep}
        />

        {busy === "restore" && <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Retomando seu workspace salvo…</p>}
        {busy !== "restore" && step === "idea" && <IdeaStep
          settings={settings}
          onSettingsChange={updateSettings}
          ideas={ideas}
          selectedIdea={selectedIdea}
          onSelectIdea={handleSelectIdea}
          onGenerateIdeas={handleGenerateIdeas}
          onGenerateScript={handleGenerateScript}
          busy={busy === "ideas" || busy === "script" || Boolean(selectingIdeaId)}
          canGenerate={Boolean(analysis?.trendId)}
          selectingIdeaId={selectingIdeaId}
          error={error}
        />}
        {busy !== "restore" && step === "script" && script && selectedIdea && <ScriptStep
          script={script}
          selectedIdea={selectedIdea}
          onChange={updateScript}
          onChangeSection={updateScriptSection}
          onBack={() => navigateToStep("idea")}
          onRegenerate={handleGenerateScript}
          onGenerateScenes={handleGenerateScenes}
          busy={busy === "script" || busy === "scenes"}
          saveStatus={scriptSaveStatus}
          error={error}
        />}
        {busy !== "restore" && step === "scenes" && videoPlan && <ScenesStep
          videoPlan={videoPlan}
          onSceneChange={updateScene}
          onBack={() => navigateToStep("script")}
          onApprove={handleApproveScenes}
          busy={busy === "save-plan"}
          saveStatus={planSaveStatus}
          error={error}
        />}
        {busy !== "restore" && step === "production" && videoPlan && <ProductionStep
          videoPlan={videoPlan}
          onBack={() => navigateToStep("scenes")}
        />}
      </div>

      {legacyDrafts.length > 0 && <details className="mt-6 rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Rascunhos salvos anteriormente neste navegador ({legacyDrafts.length})</summary>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {legacyDrafts.map((draft) => <article key={draft.id} className="rounded-xl border border-border p-3">
            <h3 className="text-sm font-medium text-white">{draft.title}</h3>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{draft.text}</p>
            <p className="mt-2 text-[11px] text-sky-300">{draft.type} · {new Date(draft.createdAt).toLocaleDateString("pt-BR")}</p>
          </article>)}
        </div>
      </details>}
    </div>
  );
}
