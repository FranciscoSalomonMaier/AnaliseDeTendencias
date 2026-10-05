import {
  ArrowLeftIcon,
  ChatBubbleBottomCenterTextIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";
import { formatStudioDuration } from "../../../utils/contentStudioTime";

const futureStages = [
  { label: "Geração de imagens", detail: "Criar imagens a partir dos prompts das cenas.", icon: PhotoIcon },
  { label: "Narração", detail: "Transformar a narração em áudio com TTS.", icon: SpeakerWaveIcon },
  { label: "Legendas", detail: "Gerar e sincronizar legendas.", icon: ChatBubbleBottomCenterTextIcon },
  { label: "Trilha sonora", detail: "Adicionar música e efeitos sonoros.", icon: MusicalNoteIcon },
  { label: "Montagem", detail: "Combinar cenas, narração, trilha e legendas.", icon: FilmIcon },
];

export function ProductionStep({ videoPlan, onBack }) {
  const totalSeconds = videoPlan.scenes.reduce((total, scene) => total + scene.estimatedDurationSeconds, 0);
  return (
    <section className="space-y-5">
      <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-300">Etapa futura</p><h2 className="mt-1 text-xl font-semibold text-white">Produção</h2></div>
      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-5">
        <p className="font-semibold text-white">Seu planejamento de conteúdo está pronto.</p>
        <p className="mt-2 text-sm text-muted-foreground">{videoPlan.scenes.length} cenas · {formatStudioDuration(totalSeconds)} de duração estimada</p>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Próximas etapas</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {futureStages.map(({ label, detail, icon: Icon }) => <article key={label} className="flex gap-3 rounded-xl border border-border bg-card p-4 opacity-70">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-muted-foreground"><Icon className="size-5" /></div>
            <div><h4 className="text-sm font-medium text-white">{label}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p><span className="mt-2 inline-block text-[11px] text-sky-300">Em breve</span></div>
          </article>)}
        </div>
      </div>
      <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">Pipeline de produção em desenvolvimento.</p>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-white"><ArrowLeftIcon className="size-4" /> Voltar às cenas</button>
    </section>
  );
}
