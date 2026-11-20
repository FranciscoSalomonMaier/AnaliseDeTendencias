import { useState } from "react";
import { EditingAdvancedPreferences } from "./EditingAdvancedPreferences";
import {
  editorialDraft,
  editorialCatalogState,
  editorialPayload,
} from "./editorialConfiguration";
const field =
  "mt-2 block w-full rounded-lg border border-border bg-background p-3 text-white";
const button =
  "rounded-lg border border-sky-400/40 px-4 py-2 text-sm disabled:opacity-40";
const axes = [
  ["videoType", "videoTypes", "Tipo de vídeo"],
  ["videoTopic", "videoTopics", "Tema"],
  ["editingStyle", "editingStyles", "Estilo de edição"],
];
export function EditingConfiguration({
  project,
  options,
  loading,
  error,
  locked,
  dirty,
  onDirty,
  onSave,
  onRetry,
}) {
  const [draft, setDraft] = useState(() =>
    editorialDraft(project, options?.editorialPreferences),
  );
  const [validation, setValidation] = useState("");
  const catalogs = options?.classifications;
  const catalogState = editorialCatalogState(catalogs, draft.classification);
  const preferenceOptions = options?.editorialPreferences;
  const preferencesReady =
    preferenceOptions?.version === 1 &&
    Array.isArray(preferenceOptions.resources) &&
    Array.isArray(preferenceOptions.states) &&
    Array.isArray(preferenceOptions.cutRhythms);
  const ready = catalogState.ready && preferencesReady;
  const change = (next) => {
    setDraft(next);
    setValidation("");
    onDirty();
  };
  async function save(approve) {
    if (!catalogState.valid) {
      setValidation("Selecione o tipo de vídeo, o tema e o estilo de edição.");
      return;
    }
    if (
      draft.preferences.additionalInstructions.length >
      preferenceOptions.maxInstructionsLength
    ) {
      setValidation("Reduza o tamanho das instruções adicionais.");
      return;
    }
    await onSave(
      editorialPayload(draft.classification, draft.preferences, approve),
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Configuração de edição</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Defina como a inteligência artificial deverá editar o seu vídeo.
        </p>
      </div>
      <p role="status" className="rounded-lg border border-border p-3 text-sm">
        A execução da nova configuração ainda está em desenvolvimento. Por
        enquanto, suas escolhas serão salvas como intenção editorial.
      </p>
      {loading ? (
        <p role="status">Carregando opções de edição…</p>
      ) : !ready ? (
        <div role="alert" className="space-y-3">
          <p>
            {error ||
              "As opções de edição estão indisponíveis. Tente carregar novamente."}
          </p>
          <button className={button} disabled={locked} onClick={onRetry}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <fieldset disabled={locked} className="grid gap-5 sm:grid-cols-2">
            {axes.map(([axis, key, label]) => {
              const selected = catalogs[key].find(
                (item) => item.id === draft.classification[axis],
              );
              const unknown = Boolean(draft.classification[axis]) && !selected;
              return (
                <label
                  className={
                    axis === "editingStyle" ? "block sm:col-span-2" : "block"
                  }
                  key={axis}
                >
                  {label} <span aria-hidden="true">*</span>
                  <select
                    className={field}
                    required
                    value={draft.classification[axis]}
                    aria-invalid={unknown || undefined}
                    aria-describedby={`${axis}-description`}
                    onChange={(e) =>
                      change({
                        ...draft,
                        classification: {
                          ...draft.classification,
                          version: catalogs.version,
                          [axis]: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Selecione uma opção</option>
                    {unknown && (
                      <option value={draft.classification[axis]} disabled>
                        Seleção anterior indisponível — escolha outra opção
                      </option>
                    )}
                    {catalogs[key].map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.available ? "" : " · Em desenvolvimento"}
                      </option>
                    ))}
                  </select>
                  <span
                    id={`${axis}-description`}
                    className="mt-2 block text-sm text-muted-foreground"
                  >
                    {selected?.description ??
                      (unknown
                        ? "A classificação salva não está mais disponível no catálogo."
                        : "Escolha uma opção para ver a descrição.")}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {draft.classification.version !== catalogs.version && (
            <p role="alert">
              A versão da configuração salva mudou. Selecione novamente as
              opções antes de salvar.
            </p>
          )}
          <label className="block">
            Instruções adicionais
            <textarea
              className={`${field} min-h-28`}
              maxLength={preferenceOptions.maxInstructionsLength}
              disabled={locked}
              value={draft.preferences.additionalInstructions}
              placeholder="Descreva alguma preferência específica de edição..."
              onChange={(e) =>
                change({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    additionalInstructions: e.target.value,
                  },
                })
              }
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {draft.preferences.additionalInstructions.length}/
              {preferenceOptions.maxInstructionsLength} caracteres · Opcional
            </span>
          </label>
          <EditingAdvancedPreferences
            value={draft.preferences}
            options={preferenceOptions}
            disabled={locked}
            onChange={(preferences) => change({ ...draft, preferences })}
          />
          {catalogState.valid && (
            <div
              className="space-y-1 text-sm text-muted-foreground"
              aria-label="Resumo da configuração"
            >
              {axes.map(([axis, key, label]) => (
                <p key={axis}>
                  {label}:{" "}
                  {
                    catalogs[key].find(
                      (item) => item.id === draft.classification[axis],
                    )?.name
                  }
                </p>
              ))}
              {!dirty && project.editorialStatus?.knowledgeStatus && (
                <p>
                  {project.editorialStatus.knowledgeStatus === "COMPLETE"
                    ? "As escolhas salvas possuem orientações editoriais definidas."
                    : "As orientações editoriais para estas escolhas ainda estão incompletas."}
                </p>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            A configuração poderá exigir uma revisão posterior do roteiro. O
            roteiro atual será preservado.
          </p>
          <p role="status" className="text-sm">
            {dirty
              ? "Configuração com alterações não salvas."
              : project.editorialStatus?.approved
                ? "Configuração salva e aprovada por você. A execução permanece em desenvolvimento."
                : project.editorialStatus?.saved
                  ? "Configuração salva, ainda não aprovada por você."
                  : "Preencha os três campos obrigatórios para salvar."}
          </p>
          {validation && (
            <p role="alert" className="text-red-200">
              {validation}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              disabled={locked}
              onClick={() => void save(false)}
            >
              Salvar configuração
            </button>
            <button
              className={`${button} bg-sky-500/15`}
              disabled={locked}
              onClick={() => void save(true)}
            >
              Salvar e continuar
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Salvar e continuar registra sua aprovação, mas mantém esta etapa
            enquanto a execução estiver em desenvolvimento. Para produzir agora,
            utilize o fluxo legado abaixo.
          </p>
        </>
      )}
    </div>
  );
}
