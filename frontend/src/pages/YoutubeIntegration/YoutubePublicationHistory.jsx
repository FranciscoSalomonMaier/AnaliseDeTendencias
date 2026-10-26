import { useCallback, useEffect, useRef, useState } from "react";
import { youtubePublishing } from "../../services/youtubePublishingService";
import { publicationStatusLabels } from "../../utils/youtubePublication";
const button =
  "rounded border border-sky-400/40 px-3 py-2 text-sm disabled:opacity-50";
export function YoutubePublicationHistory({
  projectId,
  refreshKey = 0,
  channels = [],
  uploadsEnabled = false,
}) {
  const [items, setItems] = useState([]),
    [channel, setChannel] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [events, setEvents] = useState({});
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const result = await youtubePublishing.list({
      project: projectId,
      channel,
      status,
    });
    setItems(result.publications);
  }, [projectId, channel, status]);
  useEffect(() => {
    let active = true,
      timer;
    const poll = async () => {
      try {
        const r = await youtubePublishing.list({
          project: projectId,
          channel,
          status,
        });
        if (active) setItems(r.publications);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) timer = setTimeout(poll, 15000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, channel, status, refreshKey]);
  async function action(work) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Histórico de publicações no YouTube"
      className="min-w-0 space-y-3 rounded-xl border border-border p-4"
    >
      <h3 className="font-semibold">Publicações no YouTube</h3>
      <div className="flex flex-wrap gap-3">
        <label>
          Canal
          <select
            className="rounded border bg-theme p-2"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">Todos</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            className="rounded border bg-theme p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(publicationStatusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-red-200">
          {error}
        </p>
      )}
      {!items.length && <p>Nenhum envio registrado com esses filtros.</p>}
      {items.map((p) => (
        <article
          key={p.id}
          className="min-w-0 space-y-2 rounded border border-border p-3"
        >
          <h4>{p.snapshot.title}</h4>
          <p className="text-sm">
            Canal: {p.snapshot.channelTitle} ·{" "}
            {publicationStatusLabels[p.status] ?? p.status}
          </p>
          <p className="text-sm">
            {p.snapshot.width}×{p.snapshot.height} ·{" "}
            {p.snapshot.durationSeconds.toFixed(1)} s ·{" "}
            {p.snapshot.options.privacy}
          </p>
          {["QUEUED", "UPLOADING"].includes(p.status) && (
            <>
              <progress max="100" value={p.progress} className="w-full" />
              <p>
                {p.progress}% · {p.confirmedBytes.toLocaleString("pt-BR")} de{" "}
                {p.snapshot.bytes.toLocaleString("pt-BR")} bytes confirmados.
                Processamento é uma etapa separada.
              </p>
            </>
          )}
          {p.snapshot.options.scheduledAt && (
            <p>
              Publicação solicitada:{" "}
              {new Date(p.snapshot.options.scheduledAt).toLocaleString(
                "pt-BR",
                { timeZone: p.snapshot.options.timeZone },
              )}{" "}
              · {p.snapshot.options.timeZone}. O estado confirmado aparece
              acima.
            </p>
          )}
          {p.youtubeUrl && (
            <a
              href={p.youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline"
            >
              Abrir no YouTube (pode estar privado)
            </a>
          )}
          {p.errorMessage && (
            <p role="alert" className="text-amber-200">
              {p.errorMessage} · {p.errorCode}
            </p>
          )}
          {p.cancelRequested && !p.youtubeVideoId && (
            <p role="status">
              Interrupção solicitada. O trecho em trânsito pode precisar ser
              confirmado pelo servidor; nenhum novo trecho será enviado depois
              da interrupção.
            </p>
          )}
          <p className="text-xs">
            Thumbnail:{" "}
            {p.thumbnailStatus === "UNSUPPORTED"
              ? "Configure a capa do Short no YouTube Studio"
              : p.thumbnailStatus}
          </p>
          <div className="flex flex-wrap gap-2">
            {p.status === "DRAFT" && (
              <button
                className={button}
                disabled={busy || !uploadsEnabled}
                onClick={() => {
                  if (
                    window.confirm(
                      `Enviar este rascunho real?\nCanal: ${p.snapshot.channelTitle}\nTítulo: ${p.snapshot.title}\nPrivacidade: ${p.snapshot.options.privacy}\nAgendamento: ${p.snapshot.options.scheduledAt ?? "Sem agendamento"}`,
                    )
                  )
                    void action(() => youtubePublishing.upload(p.id));
                }}
              >
                Confirmar envio do rascunho
              </button>
            )}
            {p.canResume && !p.youtubeVideoId && (
              <button
                className={button}
                disabled={busy || !uploadsEnabled}
                onClick={() => {
                  if (
                    window.confirm(
                      p.sessionStarted
                        ? "Consultar e retomar somente a sessão existente? Nenhum novo upload será criado."
                        : "Tentar o envio após a correção? A tentativa anterior foi recusada antes de aceitar uma sessão de arquivo.",
                    )
                  )
                    void action(() => youtubePublishing.retry(p.id));
                }}
              >
                {p.sessionStarted
                  ? "Retomar sessão existente"
                  : "Tentar envio após correção"}
              </button>
            )}
            {!p.youtubeVideoId &&
              (["DRAFT", "QUEUED", "UPLOADING"].includes(p.status) ||
                (!p.sessionStarted &&
                  ["FAILED", "NEEDS_ATTENTION"].includes(p.status))) && (
                <button
                  className={button}
                  disabled={busy || p.cancelRequested}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Interromper o envio local? Isso não exclui vídeos nem cancela agendamentos já recebidos pelo YouTube.",
                      )
                    )
                      void action(() => youtubePublishing.cancel(p.id));
                  }}
                >
                  Interromper envio local
                </button>
              )}
            {p.youtubeVideoId && (
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void action(() => youtubePublishing.status(p.id))
                }
              >
                Consultar estado remoto
              </button>
            )}
            {!p.youtubeVideoId && p.status === "NEEDS_ATTENTION" && (
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  const id = window.prompt(
                    "Após conferir o YouTube Studio, informe o ID de 11 caracteres do vídeo que já foi enviado a este canal:",
                  );
                  if (
                    id &&
                    window.confirm(
                      "Vincular esse vídeo existente ao histórico? Nenhum arquivo será enviado.",
                    )
                  )
                    void action(() =>
                      youtubePublishing.status(p.id, id.trim()),
                    );
                }}
              >
                Reconciliar vídeo existente
              </button>
            )}
            {p.youtubeVideoId &&
              p.target !== "YOUTUBE_SHORTS" &&
              p.thumbnailStatus === "FAILED" && (
                <button
                  className={button}
                  disabled={busy || !uploadsEnabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Reenviar somente a thumbnail? O MP4 não será reenviado.",
                      )
                    )
                      void action(() => youtubePublishing.thumbnail(p.id));
                  }}
                >
                  Repetir somente thumbnail
                </button>
              )}
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await youtubePublishing.get(p.id);
                  setEvents((current) => ({ ...current, [p.id]: r.events }));
                })
              }
            >
              Ver histórico de operações
            </button>
          </div>
          {events[p.id] && (
            <ul className="text-xs">
              {events[p.id].map((event, i) => (
                <li key={i}>
                  {new Date(event.created_at).toLocaleString("pt-BR")} ·{" "}
                  {event.operation} · {event.result}
                  {event.code ? ` · ${event.code}` : ""}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
