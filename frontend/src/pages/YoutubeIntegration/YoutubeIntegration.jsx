import { useEffect, useRef, useState } from "react";
import { youtubePublishing } from "../../services/youtubePublishingService";
import { StudioAccess } from "../ContentCreation/components/StudioAccess";
import { YoutubePublicationHistory } from "./YoutubePublicationHistory";
const button = "rounded border border-sky-400/40 px-3 py-2 disabled:opacity-50";
export function YoutubeIntegration() {
  const [config, setConfig] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [operations, setOperations] = useState([]),
    [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      youtubePublishing.configuration(),
      youtubePublishing.operations(),
    ])
      .then(([c, ops]) => {
        if (active) {
          setConfig(c);
          setOperations(ops);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(work) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
      setConfig(await youtubePublishing.configuration());
      setOperations(await youtubePublishing.operations());
    } catch (e) {
      setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const callback = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  ).get("youtubeOAuth");
  return (
    <div
      aria-label="Integrações do YouTube"
      className="min-h-screen min-w-0 space-y-5 bg-theme p-4 text-white md:p-6"
    >
      <h1 className="text-2xl font-semibold">Integrações → YouTube</h1>
      <StudioAccess />
      {callback && (
        <p role="status">
          {callback === "connected"
            ? "Canal autorizado e conectado. Confira a identidade abaixo."
            : "O consentimento foi negado, expirou ou não pôde ser concluído. Verifique a configuração e conecte novamente."}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-200">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Processando…</p>}
      {config && (
        <>
          <p>
            Uploads: {config.uploadsEnabled ? "habilitados" : "desabilitados"} ·
            envio não privado/agendamento:{" "}
            {config.publicPublicationEnabled ? "habilitados" : "desabilitados"}
          </p>
          {!config.configured && (
            <p className="rounded border border-amber-400/30 p-3">
              Configure o cliente OAuth, a URI de retorno e a chave de
              criptografia no backend. Nenhuma credencial deve ser informada
              nesta tela.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Permissões: enviar vídeos (youtube.upload) e consultar o canal e
            seus vídeos (youtube.readonly). O consentimento offline permite
            concluir uploads e consultar processamento com a página fechada.
            Nenhum vídeo é enviado apenas ao conectar.
          </p>
          <button
            className={button}
            disabled={busy || !config.configured}
            onClick={() =>
              void run(async () => {
                const result = await youtubePublishing.authorize();
                const url = new URL(result.url);
                if (url.origin !== "https://accounts.google.com")
                  throw new Error("Destino OAuth inválido.");
                window.location.assign(url.toString());
              })
            }
          >
            Conectar canal Google/YouTube
          </button>
          <section aria-label="Canais conectados" className="space-y-3">
            <h2 className="text-xl">Canais conectados</h2>
            {!config.channels.length && <p>Nenhum canal conectado.</p>}
            {config.channels.map((c) => (
              <article
                key={c.id}
                className="space-y-2 rounded-xl border border-border p-4"
              >
                <div className="flex gap-3">
                  <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky-500/20">
                    {c.title.slice(0, 1) || "Y"}
                    {c.thumbnailUrl && (
                      <img
                        src={c.thumbnailUrl}
                        alt="Imagem do canal"
                        className="absolute inset-0 h-12 w-12 rounded-full"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.hidden = true;
                        }}
                      />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{c.title}</h3>
                    <p className="break-all text-xs">{c.channelId}</p>
                  </div>
                </div>
                <p>
                  {c.status} · Última verificação:{" "}
                  {c.verifiedAt
                    ? new Date(c.verifiedAt).toLocaleString("pt-BR")
                    : "Não verificado"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`https://www.youtube.com/channel/${c.channelId}`}
                    target="_blank"
                    rel="noreferrer"
                    className={button}
                  >
                    Ver canal
                  </a>
                  <button
                    className={button}
                    disabled={busy || c.status !== "CONNECTED"}
                    onClick={() =>
                      void run(() => youtubePublishing.verify(c.id))
                    }
                  >
                    Verificar conexão
                  </button>
                  <button
                    className={button}
                    disabled={busy || c.status === "REVOKED"}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Desconectar ${c.title}? Os envios locais serão interrompidos; vídeos remotos e histórico serão preservados. Agendamentos remotos devem ser alterados no YouTube Studio.`,
                        )
                      )
                        void run(async () => {
                          const r = await youtubePublishing.disconnect(c.id);
                          setMessage(r.message);
                        });
                    }}
                  >
                    Desconectar
                  </button>
                </div>
              </article>
            ))}
          </section>
          <p className="text-sm">
            Para reconectar, use Conectar canal e confirme a identidade no
            Google. Para revogar manualmente:{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              permissões da Conta Google
            </a>
            .
          </p>
          <details className="rounded border border-border p-3">
            <summary>Operações e cotas — últimas 24 horas</summary>
            <p className="my-2 text-sm">
              Contagens locais de tentativas, incluindo falhas. Limites e
              consumo efetivo de cota devem ser conferidos no Google Cloud.
            </p>
            <a
              href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Consultar cotas do projeto Google Cloud
            </a>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Operação</th>
                    <th>Resultado</th>
                    <th>Código</th>
                    <th>Tentativas</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op, i) => (
                    <tr key={i}>
                      <td>{op.operation}</td>
                      <td>{op.result}</td>
                      <td>{op.code}</td>
                      <td>{op.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <YoutubePublicationHistory
            uploadsEnabled={config.uploadsEnabled}
            channels={config.channels}
          />
        </>
      )}
    </div>
  );
}
