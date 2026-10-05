import { CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";

const steps = [
  { id: "idea", label: "Ideia" },
  { id: "script", label: "Roteiro" },
  { id: "scenes", label: "Cenas" },
  { id: "production", label: "Produção" },
];

export function ContentStudioStepper({ activeStep, hasIdeas, hasScript, hasScenes, onSelect }) {
  const complete = { idea: hasIdeas, script: hasScript, scenes: hasScenes, production: false };
  const accessible = { idea: hasIdeas, script: hasScript, scenes: hasScenes, production: false };

  return (
    <nav aria-label="Etapas do Estúdio" className="rounded-2xl border border-border bg-card px-3 py-4 md:px-5">
      <ol className="grid grid-cols-4">
        {steps.map((step, index) => {
          const active = activeStep === step.id;
          const done = complete[step.id] && !active;
          const blocked = !accessible[step.id] && !active;
          return <li key={step.id} className="relative min-w-0 text-center">
            {index > 0 && <span aria-hidden="true" className={`absolute left-0 right-1/2 top-4 h-px ${complete[steps[index - 1].id] ? "bg-sky-400/70" : "bg-border"}`} />}
            {index < steps.length - 1 && <span aria-hidden="true" className={`absolute left-1/2 right-0 top-4 h-px ${complete[step.id] ? "bg-sky-400/70" : "bg-border"}`} />}
            <button type="button" disabled={blocked || step.id === "production"}
              onClick={() => onSelect(step.id)} aria-current={active ? "step" : undefined}
              title={step.id === "production" ? "Etapa de produção disponível em breve" : undefined}
              className="relative z-10 inline-flex flex-col items-center gap-2 disabled:cursor-not-allowed">
              <span className={`grid size-8 place-items-center rounded-full border text-xs font-semibold ${active ? "border-sky-300 bg-sky-400/15 text-sky-200" : done ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300" : "border-border bg-card text-muted-foreground"}`}>
                {step.id === "production" ? <LockClosedIcon className="size-4" /> : done ? <CheckIcon className="size-4" /> : index + 1}
              </span>
              <span className={`text-[11px] font-medium uppercase tracking-wide sm:text-xs ${active ? "text-white" : done ? "text-emerald-300" : "text-muted-foreground"}`}>{step.label}</span>
            </button>
          </li>;
        })}
      </ol>
    </nav>
  );
}
