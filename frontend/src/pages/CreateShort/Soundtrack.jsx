import { useState } from "react";
import { shortMediaUrl } from "../../services/shortCreationService";
const defaults = {
  volume: 0.15,
  fadeIn: true,
  fadeInSeconds: 1,
  fadeOut: true,
  fadeOutSeconds: 0.5,
  loop: true,
  ducking: true,
};
const button =
  "rounded-lg border border-sky-400/40 px-4 py-2 text-sm disabled:opacity-40";
const field =
  "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-white";
export function validateMusicUpload(file, maxBytes = 50 * 1024 ** 2) {
  if (!file || !/\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(file.name))
    throw Error("Selecione MP3, WAV, AAC, M4A, OGG ou FLAC.");
  if (!file.size || file.size > maxBytes)
    throw Error(
      `O áudio deve ter até ${Math.round(maxBytes / 1024 ** 2)} MB e não pode estar vazio.`,
    );
  const allowed = [
    "",
    "application/octet-stream",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/aac",
    "audio/x-aac",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/ogg",
    "application/ogg",
    "audio/opus",
    "audio/flac",
    "audio/x-flac",
  ];
  if (!allowed.includes(file.type))
    throw Error("O tipo do arquivo não é compatível com áudio.");
  return file;
}
export function Soundtrack({
  project,
  options,
  locked,
  dirty,
  onDirty,
  onSave,
  onUpload,
  onRemove,
  onSkip,
}) {
  const [settings, setSettings] = useState(
      project.data.musicSettings ?? defaults,
    ),
    [rights, setRights] = useState(false),
    [dragging, setDragging] = useState(false),
    [error, setError] = useState("");
  const change = (key, value) => {
    setSettings({ ...settings, [key]: value });
    onDirty();
  };
  const upload = (files) => {
    setError("");
    try {
      if (locked) return;
      if (dirty) throw Error('Salve as configurações antes de enviar outra música.');
      if (!rights)
        throw Error("Confirme sua autorização para utilizar a música.");
      if (files.length !== 1)
        throw Error("Envie somente uma música por Short.");
      onUpload(validateMusicUpload(files[0], options?.musicMaxBytes));
    } catch (e) {
      setError(e.message);
    }
  };
  const music = project.data.music;
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Trilha sonora</h2>
      <p>
        Adicione uma música de fundo opcional. A narração terá prioridade na
        mixagem.
      </p>
      <p className="text-sm text-muted-foreground">
        MP3, WAV, AAC, M4A, OGG ou FLAC · até{" "}
        {Math.round((options?.musicMaxBytes ?? 50 * 1024 ** 2) / 1024 ** 2)} MB
        · até {Math.round((options?.musicMaxSeconds ?? 3600) / 60)} minutos. O
        vídeo mantém a duração real da narração.
      </p>
      {error && (
        <p role="alert" className="text-red-200">
          {error}
        </p>
      )}
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={rights}
          disabled={locked}
          onChange={(e) => setRights(e.target.checked)}
        />
        Confirmo que tenho autorização para utilizar o áudio enviado.
      </label>
      <div
        className={`rounded-lg border border-dashed p-5 ${dragging ? "border-sky-400 bg-sky-500/10" : "border-border"}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(Array.from(e.dataTransfer.files));
        }}
      >
        <p>Arraste uma música para cá ou escolha um arquivo.</p>
        <label className="mt-3 block">
          {music ? "Substituir música" : "Selecionar música"}
          <input
            aria-label="Selecionar música de fundo"
            className={field}
            type="file"
            accept=".mp3,.wav,.aac,.m4a,.ogg,.flac"
            disabled={locked || dirty || !rights}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) upload(files);
            }}
          />
        </label>
      </div>
      {music && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <p className="break-all font-medium">{music.originalName}</p>
          <p>
            {music.duration.toFixed(1)} segundos ·{" "}
            {(music.bytes / 1024 ** 2).toFixed(1)} MB
          </p>
          <audio
            controls
            preload="metadata"
            className="w-full"
            src={shortMediaUrl(music.url)}
          />
          <p className="text-sm text-muted-foreground">
            Prévia do arquivo original. Volume, fades e ducking serão aplicados
            no vídeo renderizado.
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={project.data.musicEnabled !== false}
              disabled={locked || dirty}
              onChange={(e) => onSave({ musicEnabled: e.target.checked })}
            />
            Usar esta música no vídeo
          </label>
          <button
            className={button}
            disabled={locked || dirty}
            onClick={onRemove}
          >
            Remover música
          </button>
        </section>
      )}
      <fieldset disabled={locked} className="space-y-4">
        <legend className="mb-3 font-medium">Configurações da música</legend>
        <label className="block">
          Volume da música: {Math.round(settings.volume * 100)}%
          <input
            aria-label="Volume da música"
            className="mt-2 block w-full"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(settings.volume * 100)}
            onChange={(e) => change("volume", Number(e.target.value) / 100)}
          />
        </label>
        {[
          ["fadeIn", "Fade in", "fadeInSeconds"],
          ["fadeOut", "Fade out", "fadeOutSeconds"],
        ].map(([key, label, duration]) => (
          <div className="space-y-2" key={key}>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => change(key, e.target.checked)}
              />
              {label}
            </label>
            <label className="block">
              Duração do {label.toLowerCase()} (segundos)
              <input
                className={field}
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={settings[duration]}
                disabled={!settings[key]}
                onChange={(e) => change(duration, Number(e.target.value))}
              />
            </label>
          </div>
        ))}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={settings.loop}
            onChange={(e) => change("loop", e.target.checked)}
          />
          Repetição automática até o fim do vídeo
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={settings.ducking}
            onChange={(e) => change("ducking", e.target.checked)}
          />
          Audio ducking: reduzir a música durante a narração
        </label>
        <button
          className={button}
          disabled={!dirty}
          onClick={() => onSave({ musicSettings: settings })}
        >
          Salvar configurações
        </button>
      </fieldset>
      <button className={button} disabled={locked} onClick={onSkip}>
        Continuar sem música
      </button>
    </div>
  );
}
