import { useEffect, useRef, useState } from "react";
import { youtubePublishing } from "../../services/youtubePublishingService";
import {
  localDateTimeToUtc,
  publicationConfirmation,
} from "../../utils/youtubePublication";
import { YoutubePublicationHistory } from "./YoutubePublicationHistory";
const button =
  "rounded border border-sky-400/40 px-3 py-2 text-sm disabled:opacity-50";
const input = "w-full rounded border border-border bg-theme p-2";
export function YoutubePublishPanel({ project, state, target, dirty }) {
  const [config, setConfig] = useState(null),
    [channel, setChannel] = useState(""),
    [privacy, setPrivacy] = useState("private"),
    [kids, setKids] = useState(""),
    [synthetic, setSynthetic] = useState(""),
    [category, setCategory] = useState("22"),
    [license, setLicense] = useState("youtube"),
    [schedule, setSchedule] = useState(false),
    [date, setDate] = useState(""),
    [zone, setZone] = useState("America/Sao_Paulo"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [rule, setRule] = useState(null);
  const [mode, setMode] = useState("DRAFT"),
    [maximum, setMaximum] = useState(1),
    [delay, setDelay] = useState(24),
    [enabled, setEnabled] = useState(false);
  const inFlight = useRef(false),
    idempotency = useRef(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      youtubePublishing.configuration(),
      youtubePublishing.automation(project.id),
    ])
      .then(([c, r]) => {
        if (active) {
          setConfig(c);
          setRule(r);
          setEnabled(r?.enabled ?? false);
          setMode(r?.mode ?? "DRAFT");
          setMaximum(r?.maxPublications ?? 1);
          setDelay(r?.delayHours ?? 24);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  const selectedChannel = config?.channels.find((c) => c.id === channel),
    title = state.data.titles.find(
      (t) => t.id === state.data.selectedTitleId,
    )?.text;
  const selectedRender = state.renders.find(
    (r) => r.id === state.data.renderJobId,
  );
  function body() {
    if (!channel || kids === "" || synthetic === "")
      throw new Error(
        "Selecione o canal e responda às duas declarações de conteúdo.",
      );
    if (!idempotency.current) idempotency.current = crypto.randomUUID();
    return {
      projectId: project.id,
      target,
      preparationRevision: state.revision,
      connectionId: channel,
      idempotencyKey: idempotency.current,
      confirm: true,
      options: {
        privacy: schedule ? "private" : privacy,
        madeForKids: kids === "yes",
        containsSyntheticMedia: synthetic === "yes",
        categoryId: category,
        license,
        scheduledAt: schedule ? localDateTimeToUtc(date, zone) : null,
        timeZone: zone,
      },
    };
  }
  async function run(work) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e.message + (e.issues?.length ? " " + e.issues.join(" ") : ""));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function prepare(send) {
    const data = body();
    await youtubePublishing.validate(data);
    const publication = await youtubePublishing.create(data);
    idempotency.current = null;
    if (!send) {
      setMessage("Rascunho de envio salvo. Nenhum arquivo foi enviado.");
      return;
    }
    if (publication.status !== "DRAFT") {
      setMessage(
        "Já existe uma operação para este vídeo e canal. Confira o histórico; nenhum novo envio foi criado.",
      );
      return;
    }
    const actualChannel = {
      title: publication.snapshot.channelTitle,
      channelId: publication.snapshot.channelId,
    };
    if (
      window.confirm(
        publicationConfirmation(
          actualChannel,
          publication.snapshot.title,
          publication.snapshot.options,
        ),
      )
    ) {
      await youtubePublishing.upload(publication.id);
      setMessage(
        "Envio confirmado e colocado na fila. Acompanhe o progresso abaixo.",
      );
    } else setMessage("Rascunho salvo. Envio não confirmado.");
  }
  return (
    <section
      aria-label="Publicar no YouTube"
      className="min-w-0 space-y-4 rounded-xl border border-sky-400/30 bg-card p-4"
    >
      <h3 className="text-xl font-semibold">Publicar no YouTube</h3>
      <p className="text-sm">
        Reutiliza a preparação salva. Edite título, descrição, tags e thumbnail
        nos campos acima e salve antes de enviar. O arquivo não será regenerado.
      </p>
      <a href="?page=youtube-integration" className="text-sky-300 underline">
        Gerenciar canais em Integrações → YouTube
      </a>
      {error && (
        <p role="alert" className="text-red-200">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {config && !config.configured && (
        <p>
          OAuth ainda não configurado no servidor. Consulte o guia de
          integração.
        </p>
      )}
      {config && !config.uploadsEnabled && (
        <p>
          Uploads desabilitados no servidor. É possível preparar rascunhos;
          nenhum arquivo será enviado.
        </p>
      )}
      <fieldset disabled={busy} className="min-w-0 grid gap-3 md:grid-cols-2">
        <label>
          Canal autorizado
          <select
            aria-label="Canal para publicação"
            className={input}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="">Selecione explicitamente</option>
            {config?.channels
              .filter((c) => c.status === "CONNECTED")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.channelId}
                </option>
              ))}
          </select>
        </label>
        <label>
          Privacidade
          <select
            aria-label="Privacidade YouTube"
            className={input}
            value={privacy}
            disabled={schedule}
            onChange={(e) => setPrivacy(e.target.value)}
          >
            <option value="private">Privado (padrão)</option>
            <option
              value="unlisted"
              disabled={!config?.publicPublicationEnabled}
            >
              Não listado
            </option>
            <option value="public" disabled={!config?.publicPublicationEnabled}>
              Público
            </option>
          </select>
        </label>
        <label>
          Este conteúdo é destinado a crianças?
          <select
            aria-label="Conteúdo destinado a crianças"
            className={input}
            value={kids}
            onChange={(e) => setKids(e.target.value)}
          >
            <option value="">Declaração obrigatória</option>
            <option value="yes">Sim</option>
            <option value="no">Não</option>
          </select>
        </label>
        <label>
          Contém mídia sintética ou alterada realista que requer declaração?
          <select
            aria-label="Declaração de conteúdo sintético"
            className={input}
            value={synthetic}
            onChange={(e) => setSynthetic(e.target.value)}
          >
            <option value="">Revise o conteúdo e declare</option>
            <option value="yes">Sim</option>
            <option value="no">Não</option>
          </select>
        </label>
        <label>
          Categoria do YouTube
          <select
            className={input}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="22">Pessoas e blogs (22)</option>
            <option value="24">Entretenimento (24)</option>
            <option value="27">Educação (27)</option>
            <option value="1">Filmes e animação (1)</option>
          </select>
        </label>
        <label>
          Licença
          <select
            className={input}
            value={license}
            onChange={(e) => setLicense(e.target.value)}
          >
            <option value="youtube">Licença padrão do YouTube</option>
            <option value="creativeCommon">
              Creative Commons — somente se tiver direitos para autorizar
            </option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={schedule}
            disabled={!config?.publicPublicationEnabled}
            onChange={(e) => setSchedule(e.target.checked)}
          />{" "}
          Agendar publicação nativa do YouTube
        </label>
        {schedule && (
          <>
            <label>
              Data e hora no fuso escolhido
              <input
                aria-label="Data da publicação"
                type="datetime-local"
                className={input}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Fuso horário
              <input
                className={input}
                value={zone}
                onChange={(e) => setZone(e.target.value)}
              />
            </label>
            <p className="text-sm">
              O upload começa após a confirmação. O YouTube mantém o arquivo
              privado até a data solicitada. Use pelo menos cinco minutos de
              antecedência; processamento pode levar mais tempo.
            </p>
          </>
        )}
      </fieldset>
      <div className="rounded border border-border p-3 text-sm">
        <p>
          Canal:{" "}
          {selectedChannel
            ? `${selectedChannel.title} (${selectedChannel.channelId})`
            : "Não selecionado"}
        </p>
        <p>Título: {title ?? "Selecione e salve um título"}</p>
        <p>
          Vídeo:{" "}
          {selectedRender
            ? `${selectedRender.snapshot.config.width}×${selectedRender.snapshot.config.height} · ${selectedRender.snapshot.totalDurationSeconds.toFixed(1)} s`
            : "Nenhum vídeo final selecionado"}
        </p>
        <p>Idioma: {state.data.language}</p>
        {target === "YOUTUBE_SHORTS" && (
          <p>
            A classificação como Short depende do YouTube. A capa deve ser
            selecionada no Studio; não será enviada pela API.
          </p>
        )}
      </div>
      {dirty && (
        <p>Salve as alterações da preparação antes de validar ou enviar.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={busy || dirty || !config?.configured}
          onClick={() =>
            void run(async () => {
              const result = await youtubePublishing.validate(body());
              setMessage("Preparação validada. " + result.warnings.join(" "));
            })
          }
        >
          Validar para YouTube
        </button>
        <button
          className={button}
          disabled={busy || dirty || !config?.configured}
          onClick={() => void run(() => prepare(false))}
        >
          Salvar rascunho de envio
        </button>
        <button
          className={button}
          disabled={
            busy || dirty || !config?.uploadsEnabled || !config?.configured
          }
          onClick={() => void run(() => prepare(true))}
        >
          {schedule
            ? "Confirmar agendamento"
            : privacy === "private"
              ? "Enviar como privado"
              : privacy === "public"
                ? "Publicar agora"
                : "Enviar como não listado"}
        </button>
      </div>
      <details className="space-y-3 rounded border border-border p-3">
        <summary>
          Automação controlada — {rule?.enabled ? "ativa" : "desativada"}
        </summary>
        <p className="text-sm">
          Por padrão, nada é enviado. A regra só atua sobre a preparação marcada
          como pronta e seu RenderJob selecionado. Exige o canal e as
          declarações acima; respeita o limite total de registros deste projeto.
          Em caso de falha, não cria outro vídeo.
        </p>
        <label className="block">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Ativar regra explicitamente
        </label>
        <label>
          Ação
          <select
            className={input}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="DRAFT">Criar somente rascunho</option>
            <option value="PRIVATE">Enviar privado</option>
            <option
              value="SCHEDULE"
              disabled={!config?.publicPublicationEnabled}
            >
              Enviar e agendar publicação
            </option>
          </select>
        </label>
        <label>
          Limite total de publicações deste projeto
          <input
            type="number"
            min="1"
            max="10"
            className={input}
            value={maximum}
            onChange={(e) => setMaximum(Number(e.target.value))}
          />
        </label>
        {mode === "SCHEDULE" && (
          <label>
            Publicar após quantas horas da preparação
            <input
              type="number"
              min="1"
              max="720"
              className={input}
              value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
            />
          </label>
        )}
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              let settings;
              if (!enabled && rule) settings = { ...rule, enabled: false };
              else {
                const request = body();
                settings = {
                  enabled,
                  mode,
                  connectionId: channel,
                  target,
                  madeForKids: request.options.madeForKids,
                  containsSyntheticMedia:
                    request.options.containsSyntheticMedia,
                  categoryId: category,
                  delayHours: delay,
                  timeZone: zone,
                  maxPublications: maximum,
                };
              }
              if (
                !window.confirm(
                  `Salvar regra ${enabled ? "ATIVA" : "DESATIVADA"}?\nCanal: ${selectedChannel?.title ?? rule?.connectionId}\nAção: ${mode}\nLimite: ${maximum}`,
                )
              )
                return;
              const r = await youtubePublishing.saveAutomation(
                project.id,
                settings,
              );
              setRule(r);
              setMessage("Regra de automação salva.");
            })
          }
        >
          Salvar regra confirmada
        </button>
      </details>
      <YoutubePublicationHistory
        uploadsEnabled={config?.uploadsEnabled ?? false}
        projectId={project.id}
        channels={config?.channels ?? []}
        refreshKey={refresh}
      />
    </section>
  );
}
