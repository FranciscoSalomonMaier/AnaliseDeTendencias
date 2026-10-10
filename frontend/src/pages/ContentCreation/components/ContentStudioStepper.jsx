import { CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";

const steps = [
  { id: "idea", label: "Ideia" },
  { id: "script", label: "Roteiro" },
  { id: "scenes", label: "Cenas" },
  { id: "production", label: "Produção" },
];

export function ContentStudioStepper({ activeStep, hasIdeas, hasScript, hasScenes, onSelect, projectSteps }) {
  const displayedSteps = projectSteps ? [{ id: "config", label: "Configuração" }, ...steps] : steps;
  const complete = { idea: hasIdeas, script: hasScript, scenes: hasScenes, production: false };
  const accessible = { idea: hasIdeas, script: hasScript, scenes: hasScenes, production: false };

  if (projectSteps) Object.assign(accessible, projectSteps);
  return (
    <nav aria-label="Etapas do Estúdio" className="rounded-2xl border border-border bg-card px-3 py-4 md:px-5">
      <ol className={`grid ${projectSteps ? "grid-cols-5" : "grid-cols-4"}`}>
        {displayedSteps.map((step, index) => {
          const active = activeStep === step.id;
          const done = projectSteps ? displayedSteps.findIndex(s => s.id === activeStep) > index : complete[step.id] && !active;
          const blocked = !accessible[step.id] && !active;
          return <li key={step.id} className="relative min-w-0 text-center">
            {index > 0 && <span aria-hidden="true" className={`absolute left-0 right-1/2 top-4 h-px ${complete[displayedSteps[index - 1].id] ? "bg-sky-400/70" : "bg-border"}`} />}
            {index < displayedSteps.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 right-0 top-4 h-px ${complete[step.id] ? "bg-sky-400/70" : "bg-border"}`} />}
            <button type="button" disabled={blocked || (step.id === "production" && !projectSteps)}
              onClick={() => onSelect(step.id)} aria-current={active ? "step" : undefined}
              title={step.id === "production" && !projectSteps ? "Etapa de produção disponível em breve" : undefined}
              className="relative z-10 inline-flex w-full min-w-0 flex-col items-center gap-2 disabled:cursor-not-allowed">
              <span className={`grid size-8 place-items-center rounded-full border text-xs font-semibold ${active ? "border-sky-300 bg-sky-400/15 text-sky-200" : done ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : "border-border bg-card text-muted-foreground"}`}>
                {blocked || (step.id === "production" && !projectSteps) ? <LockClosedIcon className="size-4" /> : done ? <CheckIcon className="size-4" /> : index + 1}
              </span>
              <span className={`text-[9px] font-medium uppercase tracking-wide sm:text-xs ${active ? "text-white" : done ? "text-emerald-300" : "text-muted-foreground"}`}>{projectSteps && step.id === "config" ? <><span className="sm:hidden">Config.</span><span className="hidden sm:inline">{step.label}</span></> : step.label}</span>
            </button>
          </li>;
        })}
      </ol>
    </nav>
  );
}
