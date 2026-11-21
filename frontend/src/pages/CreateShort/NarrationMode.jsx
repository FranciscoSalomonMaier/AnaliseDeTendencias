export function narrationMode(project) {
  return project?.data.narration?.mode ?? "WITH_NARRATION";
}
export function NarrationMode({ project, disabled, onChange }) {
  const modeValue = narrationMode(project);
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend>Narração do vídeo</legend>
      {[
        [
          "WITH_NARRATION",
          "Com narração",
          "O vídeo terá uma voz narrando o conteúdo.",
        ],
        [
          "WITHOUT_NARRATION",
          "Sem narração",
          "O vídeo poderá utilizar o áudio original, música ou efeitos sonoros, sem uma voz narrando.",
        ],
      ].map(([mode, label, description]) => (
        <label key={mode} className="block">
          <input
            type="radio"
            name="narration-mode"
            value={mode}
            checked={modeValue === mode}
            onChange={() => onChange({ version: 1, mode })}
          />{" "}
          {label}
          <span className="block text-sm text-slate-400">{description}</span>
        </label>
      ))}
    </fieldset>
  );
}
