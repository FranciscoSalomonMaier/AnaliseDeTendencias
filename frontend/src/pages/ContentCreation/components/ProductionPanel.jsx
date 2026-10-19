import { ChevronDownIcon } from "@heroicons/react/24/outline";

export function ProductionPanel({ title, description, pending = false, children }) {
  return <details className="group rounded-2xl border border-border bg-card">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 rounded-2xl p-5 focus-visible:outline-2 focus-visible:outline-sky-400 [&::-webkit-details-marker]:hidden">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {pending && <p className="mt-1 text-xs text-amber-200">Alterações não salvas</p>}
      </div>
      <span className="inline-flex items-center gap-2 text-sm text-sky-200"><span className="group-open:hidden">Expandir</span><span className="hidden group-open:inline">Recolher</span><ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" /></span>
    </summary>
    <div className="min-w-0 border-t border-border p-3 md:p-5">{children}</div>
  </details>;
}
