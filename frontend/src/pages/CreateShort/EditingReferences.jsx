import { useState } from "react";
const labels = {
  speechSpeed: "Velocidade da narração",
  speechStyle: "Estilo da narração",
  cutPace: "Ritmo dos cortes",
  captions: "Legendas",
  overlays: "Textos informativos",
  zoom: "Zoom",
  transitions: "Transições",
  soundEffects: "Efeitos sonoros",
  music: "Música de fundo",
};
const field =
  "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-white";
const button =
  "rounded-lg border border-sky-400/40 px-4 py-2 text-sm disabled:opacity-40";
export function EditingReferences({
  project,
  options,
  locked,
  dirty,
  onDirty,
  onSave,
  onUpload,
  onRemove,
  onAnalyze,
  onSkip,
}) {
  const [rights, setRights] = useState(false),
    [config, setConfig] = useState(project.data.editing?.config ?? null);
  const selection = project.data.editing?.features ?? Object.keys(labels);
  const change = (key, value) => {
    setConfig({ ...config, [key]: value });
    onDirty();
  };
  const nested = (key, property, value) =>
    change(key, { ...config[key], [property]: value });
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Referências de Edição</h2>
      <p>
        Envie exemplos para analisar o ritmo, a fala e a apresentação visual.
        Seus trechos e áudios não serão usados no Short final.
      </p>
      <p className="text-sm text-muted-foreground">
        Etapa opcional · até {options?.referenceMaxFiles ?? 3} vídeos ·{" "}
        {options?.referenceMaxSeconds ?? 90}s por arquivo. A análise usa sua API
        e amostras limitadas.
      </p>
      <p className="text-sm text-muted-foreground">
        Música, efeitos sonoros e entonação permanecem desconhecidos nesta
        versão. A voz pode ser ajustada manualmente. O áudio das referências
        nunca é copiado.
      </p>
      <p className="text-sm text-muted-foreground">
        Entonação exige revisão manual. Música e efeitos sonoros não são
        identificados nem aplicados nesta versão; os áudios das referências não
        são copiados.
      </p>
      <fieldset disabled={locked} className="space-y-2">
        <legend className="mb-2 font-medium">
          O que deseja analisar e aplicar?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(labels).map(([key, label]) => (
            <label key={key} className="flex gap-2">
              <input
                type="checkbox"
                checked={selection.includes(key)}
                onChange={(e) =>
                  onSave({
                    referenceFeatures: Object.keys(labels).filter((k) =>
                      k === key ? e.target.checked : selection.includes(k),
                    ),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={rights}
          disabled={locked}
          onChange={(e) => setRights(e.target.checked)}
        />
        Tenho autorização para enviar estes vídeos para análise do estilo de
        edição.
      </label>
      <label className="block">
        Enviar referências
        <input
          className={field}
          aria-label="Enviar referências de edição"
          type="file"
          multiple
          accept=".mp4,.mov,.webm"
          disabled={locked || !rights}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            onUpload(files);
          }}
        />
      </label>
      <ul className="divide-y divide-border">
        {(project.references ?? []).map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div>
              <p>{f.original_name}</p>
              <p className="text-sm text-muted-foreground">
                {f.duration.toFixed(1)}s · {(f.bytes / 1024 ** 2).toFixed(1)} MB
                · Somente referência
              </p>
            </div>
            <button
              className={button}
              disabled={locked}
              onClick={() => onRemove(f.id)}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      <button
        className={button}
        disabled={
          locked ||
          dirty ||
          !selection.length ||
          !project.references?.length ||
          !options?.aiEnabled
        }
        onClick={onAnalyze}
      >
        Analisar referências
      </button>
      {project.data.editing?.profiles?.map((profile) => (
        <div
          key={profile.fileId}
          className="space-y-1 border-t border-border pt-3"
        >
          <p className="font-medium">
            {profile.name}
            {profile.cached ? " · análise reutilizada" : ""}
          </p>
          <p>
            Medições · Fala média:{" "}
            {profile.speech.averageWpm === null
              ? "desconhecida"
              : `${Math.round(profile.speech.averageWpm)} palavras/min`}
            ; durante a fala:{" "}
            {profile.speech.activeWpm === null
              ? "desconhecida"
              : `${Math.round(profile.speech.activeWpm)} palavras/min`}
          </p>
          <p>
            Pausas: {profile.speech.pauseCount ?? "desconhecidas"}; duração
            média:{" "}
            {profile.speech.meanPause === null
              ? "desconhecida"
              : `${profile.speech.meanPause.toFixed(2)}s`}
          </p>
          <p>
            Cortes: {profile.cuts.count}; plano médio:{" "}
            {profile.cuts.mean.toFixed(2)}s; mediana:{" "}
            {profile.cuts.median.toFixed(2)}s · {profile.cuts.pace}
          </p>
          <p>
            Observações estimadas pela IA · Legendas:{" "}
            {profile.visual.captions.present === null
              ? "desconhecido"
              : profile.visual.captions.present
                ? "observadas"
                : "não observadas"}{" "}
            · textos informativos:{" "}
            {profile.visual.overlays.present === null
              ? "desconhecido"
              : profile.visual.overlays.present
                ? "observados"
                : "não observados"}
          </p>
          <details>
            <summary>Limitações e características não confirmadas</summary>
            <ul>
              {[...profile.limitations, ...profile.visual.unknown].map(
                (text, i) => (
                  <li key={i}>{text}</li>
                ),
              )}
            </ul>
          </details>
        </div>
      ))}
      {config && (
        <fieldset
          disabled={locked}
          className="space-y-4 border-t border-border pt-4"
        >
          <legend className="font-medium">Revisar e ajustar a edição</legend>
          <p className="text-sm text-muted-foreground">
            Estes são parâmetros de aplicação. Valores sugeridos para
            características desconhecidas não são medições das referências.
          </p>
          <label className="block">
            Palavras por minuto (opcional)
            <input
              className={field}
              type="number"
              min="80"
              max="240"
              value={config.wordsPerMinute ?? ""}
              onChange={(e) =>
                change(
                  "wordsPerMinute",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <label className="block">
            Estilo da narração
            <select
              className={field}
              value={config.narrationStyle}
              onChange={(e) => change("narrationStyle", e.target.value)}
            >
              {Object.entries({
                NEUTRAL: "Natural",
                DYNAMIC: "Dinâmico",
                INFORMATIVE: "Informativo",
                DOCUMENTARY: "Documental",
                DRAMATIC: "Dramático",
                RELAXED: "Descontraído",
                INVESTIGATIVE: "Investigativo",
                EXPLANATORY: "Explicativo",
              }).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Duração de referência dos planos (segundos)
            <input
              className={field}
              type="number"
              min="1"
              max="12"
              step="0.1"
              value={config.shotSeconds ?? ""}
              onChange={(e) =>
                change(
                  "shotSeconds",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={config.captions.enabled}
              onChange={(e) => nested("captions", "enabled", e.target.checked)}
            />
            Legendas
          </label>
          {config.captions.enabled && (
            <div className="space-y-3">
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={config.captions.highlightWord}
                  onChange={(e) =>
                    nested("captions", "highlightWord", e.target.checked)
                  }
                />
                Destacar a palavra narrada (exige timestamps de palavras)
              </label>
              <label className="block">
                Palavras por grupo
                <input
                  className={field}
                  type="number"
                  min="1"
                  max="8"
                  value={config.captions.wordsPerGroup}
                  onChange={(e) =>
                    nested("captions", "wordsPerGroup", Number(e.target.value))
                  }
                />
              </label>
              <label className="block">
                Tamanho da fonte
                <input
                  className={field}
                  type="number"
                  min="24"
                  max="80"
                  value={config.captions.fontSize}
                  onChange={(e) =>
                    nested("captions", "fontSize", Number(e.target.value))
                  }
                />
              </label>
              <label className="block">
                Posição
                <select
                  className={field}
                  value={config.captions.position}
                  onChange={(e) =>
                    nested("captions", "position", e.target.value)
                  }
                >
                  <option value="TOP">Superior</option>
                  <option value="CENTER">Central</option>
                  <option value="BOTTOM">Inferior</option>
                </select>
              </label>
              <div className="flex gap-4">
                <label>
                  Cor
                  <input
                    aria-label="Cor das legendas"
                    type="color"
                    value={config.captions.primaryColor}
                    onChange={(e) =>
                      nested("captions", "primaryColor", e.target.value)
                    }
                  />
                </label>
                <label>
                  Destaque
                  <input
                    aria-label="Cor do destaque"
                    type="color"
                    value={config.captions.highlightColor}
                    onChange={(e) =>
                      nested("captions", "highlightColor", e.target.value)
                    }
                  />
                </label>
              </div>
            </div>
          )}
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={config.overlays.enabled}
              onChange={(e) => nested("overlays", "enabled", e.target.checked)}
            />
            Gerar textos informativos do meu roteiro
          </label>
          <label className="block">
            Zoom
            <select
              className={field}
              value={config.zoom}
              onChange={(e) => change("zoom", e.target.value)}
            >
              <option value="NONE">Sem zoom</option>
              <option value="IN">Aproximação suave ocasional</option>
              <option value="OUT">Afastamento suave ocasional</option>
            </select>
          </label>
          <label className="block">
            Transições
            <select
              className={field}
              value={config.transition}
              onChange={(e) => change("transition", e.target.value)}
            >
              <option value="CUT">Cortes secos</option>
              <option value="FADE">Cortes com fade de entrada e saída</option>
            </select>
          </label>
          <button
            className={button}
            disabled={!dirty}
            onClick={() => onSave({ editingConfig: config })}
          >
            Salvar ajustes
          </button>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {project.data.editing.notes?.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </fieldset>
      )}
      <button className={button} disabled={locked} onClick={onSkip}>
        Pular etapa
      </button>
    </div>
  );
}
