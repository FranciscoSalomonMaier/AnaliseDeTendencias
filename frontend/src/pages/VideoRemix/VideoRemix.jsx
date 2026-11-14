import {
  remixStatusLabels,
  remixAuthorizationLabels,
} from "../../utils/videoRemix";
import { useCallback, useEffect, useState } from "react";
import { videoRemix } from "../../services/videoRemixService";
import { StudioAccess } from "../ContentCreation/components/StudioAccess";

const button =
  "rounded-lg border border-sky-400/40 px-3 py-2 text-sm disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-border bg-theme p-2";
const initial = {
  title: "",
  topic: "",
  description: "",
  mode: "SINGLE_SOURCE",
  narrationLanguage: "pt-BR",
  targetDurationSeconds: 60,
  aspectRatio: "9:16",
};
function readRoute() {
  const q = new URLSearchParams(window.location.search);
  return {
    id: q.get("remixProjectId") ?? "",
    view: q.get("remixView") ?? "list",
  };
}
export function VideoRemix() {
  const [route, setRoute] = useState(readRoute),
    [projects, setProjects] = useState({ items: [], total: 0 }),
    [project, setProject] = useState(null),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (route.id) {
      setProject(await videoRemix.get(route.id));
    } else if (route.view !== "new") {
      setProjects(await videoRemix.list(offset));
    }
  }, [route.id, route.view, offset]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (route.id) {
          const p = await videoRemix.get(route.id);
          if (active) setProject(p);
        } else if (route.view !== "new") {
          const data = await videoRemix.list(offset);
          if (active) setProjects(data);
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [route.id, route.view, offset]);
  useEffect(() => {
    const restore = () => {
      setLoading(true);
      setError("");
      setProject(null);
      setRoute(readRoute());
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function navigate(view = "list", id = "") {
    const q = new URLSearchParams({ page: "video-remix" });
    if (view !== "list") q.set("remixView", view);
    if (id) q.set("remixProjectId", id);
    window.history.pushState({}, "", `${window.location.pathname}?${q}`);
    setLoading(true);
    setProject(null);
    setRoute({ view, id });
    setError("");
  }
  async function run(work) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function remove(p) {
    if (
      !window.confirm(
        `Excluir o projeto “${p.title}” e seus cadastros de fontes? Os arquivos originais serão preservados.`,
      )
    )
      return;
    await run(async () => {
      await videoRemix.remove(p);
      if (route.id) navigate();
      else setProjects(await videoRemix.list(offset));
    });
  }
  return (
    <section className="min-h-screen space-y-5 bg-theme p-4 text-white sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Video Remix</h1>
        {route.view === "list" ? (
          <button
            className={button}
            disabled={busy}
            onClick={() => navigate("new")}
          >
            Criar projeto
          </button>
        ) : (
          <button className={button} disabled={busy} onClick={() => navigate()}>
            Voltar aos projetos
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Cadastre projetos e referências para criar vídeos curtos a partir de
        vídeos existentes. Nesta etapa, os projetos ficam em rascunho.
      </p>
      <StudioAccess />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-400/30 p-3 text-red-200"
        >
          {error}
        </p>
      )}
      {loading && <p role="status">Carregando Video Remix…</p>}
      {!loading && route.view === "list" && !route.id && (
        <>
          <p>{projects.total} projetos</p>
          {projects.items.length === 0 ? (
            <p>Nenhum projeto cadastrado.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {projects.items.map((p) => (
                <article
                  key={p.id}
                  className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-4"
                >
                  <h2 className="break-words text-lg font-semibold">
                    {p.title}
                  </h2>
                  <p className="break-words">{p.topic}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.mode === "SINGLE_SOURCE"
                      ? "Single Source"
                      : "Multi Source"}{" "}
                    · {remixStatusLabels[p.status]} · {p.sourceCount} fontes ·{" "}
                    {p.aspectRatio} · {p.targetDurationSeconds}s
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Atualizado em{" "}
                    {new Date(p.updatedAt).toLocaleString("pt-BR")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={button}
                      onClick={() => navigate("details", p.id)}
                    >
                      Visualizar
                    </button>
                    <button
                      className={button}
                      disabled={busy || p.status !== "DRAFT"}
                      onClick={() => navigate("edit", p.id)}
                    >
                      Editar
                    </button>
                    <button
                      className={button}
                      disabled={busy || p.status !== "DRAFT"}
                      onClick={() => void remove(p)}
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button
              className={button}
              disabled={busy || offset === 0}
              onClick={() => {
                setLoading(true);
                setOffset(Math.max(0, offset - 20));
              }}
            >
              Anterior
            </button>
            <button
              className={button}
              disabled={busy || offset + 20 >= projects.total}
              onClick={() => {
                setLoading(true);
                setOffset(offset + 20);
              }}
            >
              Próxima
            </button>
          </div>
        </>
      )}
      {!loading &&
        (route.view === "new" || (route.view === "edit" && project)) && (
          <RemixProjectForm
            key={project?.id ?? "new"}
            project={project}
            busy={busy}
            onSave={(data) =>
              void run(async () => {
                const saved = project
                  ? await videoRemix.update(project, data)
                  : await videoRemix.create(data);
                navigate("details", saved.id);
              })
            }
          />
        )}
      {!loading && route.view === "details" && project && (
        <>
          <article className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h2 className="break-words text-xl font-semibold">
              {project.title}
            </h2>
            <p className="break-words">Tema: {project.topic}</p>
            <p className="whitespace-pre-wrap break-words">
              {project.description}
            </p>
            <p>
              {project.mode === "SINGLE_SOURCE"
                ? "Single Source"
                : "Multi Source"}{" "}
              · {remixStatusLabels[project.status]}
            </p>
            <p>
              {project.narrationLanguage} · {project.targetDurationSeconds}{" "}
              segundos · {project.aspectRatio}
            </p>
            <p className="text-xs text-muted-foreground">
              Criado: {new Date(project.createdAt).toLocaleString("pt-BR")} ·
              Atualizado: {new Date(project.updatedAt).toLocaleString("pt-BR")}
            </p>
            <div className="flex gap-2">
              <button
                className={button}
                disabled={busy || project.status !== "DRAFT"}
                onClick={() => navigate("edit", project.id)}
              >
                Editar projeto
              </button>
              <button
                className={button}
                disabled={busy || project.status !== "DRAFT"}
                onClick={() => void remove(project)}
              >
                Excluir projeto
              </button>
            </div>
          </article>
          <h2 className="text-xl font-semibold">Fontes do projeto</h2>
          {!project.sources.length && <p>Nenhuma fonte cadastrada.</p>}
          {project.sources.map((source) => (
            <article
              key={source.id}
              className="min-w-0 space-y-2 rounded-xl border border-border p-4"
            >
              <h3 className="break-words font-semibold">{source.title}</h3>
              <p className="text-sm">
                {source.originType === "LOCAL_ASSET"
                  ? "Vídeo local"
                  : "Referência externa"}{" "}
                ·{" "}
                {source.status === "LOCAL_AVAILABLE"
                  ? "Arquivo referenciado"
                  : source.status === "METADATA_ONLY"
                    ? "Somente metadados"
                    : "Indisponível"}{" "}
                ·{" "}
                {source.durationSeconds
                  ? `${source.durationSeconds}s`
                  : "Duração desconhecida"}
              </p>
              {source.originalUrl && (
                <a
                  className="block break-all text-sky-200 underline"
                  href={source.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.originalUrl}
                </a>
              )}
              {source.localAssetId && (
                <p className="break-all text-xs text-muted-foreground">
                  Referência local: {source.localAssetId}
                </p>
              )}
              <p>
                Autorização declarada:{" "}
                {remixAuthorizationLabels[source.licensing.authorization]}
              </p>
              <p className="whitespace-pre-wrap break-words">
                {source.licensing.notes}
              </p>
              {source.licensing.licenseUrl && (
                <a
                  className="block break-all text-sky-200 underline"
                  href={source.licensing.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Licença informada
                </a>
              )}
              <button
                className={button}
                disabled={busy || project.status !== "DRAFT"}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remover esta referência? O vídeo original será preservado.",
                    )
                  )
                    void run(async () => {
                      await videoRemix.removeSource(project, source.id);
                      await refresh();
                    });
                }}
              >
                Remover fonte
              </button>
            </article>
          ))}
          {project.mode === "SINGLE_SOURCE" && project.sources.length >= 1 ? (
            <p className="text-amber-200">
              Single Source permite uma fonte. Remova a referência atual ou
              altere o modo para Multi Source.
            </p>
          ) : (
            <RemixSourceForm
              key={`${project.id}:${project.revision}`}
              busy={busy || project.status !== "DRAFT"}
              onSave={(data) =>
                void run(async () => {
                  await videoRemix.addSource(project, data);
                  await refresh();
                })
              }
            />
          )}
        </>
      )}
    </section>
  );
}
export function RemixProjectForm({ project, busy, onSave }) {
  const [data, setData] = useState(() =>
    project
      ? Object.fromEntries(Object.keys(initial).map((k) => [k, project[k]]))
      : { ...initial },
  );
  const set = (key, value) => setData((d) => ({ ...d, [key]: value }));
  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(data);
      }}
    >
      <h2 className="text-xl font-semibold">
        {project ? "Editar projeto" : "Novo projeto"}
      </h2>
      <fieldset disabled={busy} className="space-y-4">
        {[
          ["title", "Título", 160],
          ["topic", "Tema", 300],
        ].map(([key, label, max]) => (
          <label className="block" key={key}>
            {label}
            <input
              aria-label={label}
              className={input}
              required
              maxLength={max}
              value={data[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
        <label className="block">
          Descrição
          <textarea
            aria-label="Descrição"
            className={input}
            maxLength={4000}
            value={data.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            Modo de criação
            <select
              aria-label="Modo de criação"
              className={input}
              value={data.mode}
              onChange={(e) => set("mode", e.target.value)}
            >
              <option value="SINGLE_SOURCE">Single Source — um vídeo</option>
              <option value="MULTI_SOURCE">Multi Source — vários vídeos</option>
            </select>
          </label>
          <label>
            Idioma da narração
            <select
              aria-label="Idioma da narração"
              className={input}
              value={data.narrationLanguage}
              onChange={(e) => set("narrationLanguage", e.target.value)}
            >
              {!["pt-BR", "en-US", "es-ES"].includes(
                data.narrationLanguage,
              ) && <option>{data.narrationLanguage}</option>}
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en-US">Inglês</option>
              <option value="es-ES">Espanhol</option>
            </select>
          </label>
          <label>
            Duração desejada (segundos)
            <input
              aria-label="Duração desejada"
              className={input}
              type="number"
              required
              min="5"
              max="600"
              step="1"
              value={data.targetDurationSeconds}
              onChange={(e) =>
                set("targetDurationSeconds", Number(e.target.value))
              }
            />
          </label>
          <label>
            Proporção
            <select
              aria-label="Proporção"
              className={input}
              value={data.aspectRatio}
              onChange={(e) => set("aspectRatio", e.target.value)}
            >
              <option value="9:16">9:16 — vertical</option>
              <option value="16:9">16:9 — horizontal</option>
            </select>
          </label>
        </div>
        <button className={button} type="submit">
          {busy ? "Salvando…" : "Salvar projeto"}
        </button>
      </fieldset>
    </form>
  );
}
export function RemixSourceForm({ busy, onSave }) {
  const [data, setData] = useState({
      title: "",
      originType: "EXTERNAL_URL",
      originalUrl: "",
      localAssetId: "",
      duration: "",
      authorization: "UNKNOWN",
      notes: "",
      licenseUrl: "",
    }),
    [assets, setAssets] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (data.originType !== "LOCAL_ASSET") return;
    let active = true;
    videoRemix
      .localAssets()
      .then((r) => {
        if (active) setAssets(r.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.originType]);
  const set = (key, value) => setData((d) => ({ ...d, [key]: value }));
  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title: data.title,
          originType: data.originType,
          ...(data.originType === "EXTERNAL_URL"
            ? { originalUrl: data.originalUrl }
            : { localAssetId: data.localAssetId }),
          ...(data.duration ? { durationSeconds: Number(data.duration) } : {}),
          licensing: {
            authorization: data.authorization,
            notes: data.notes,
            ...(data.licenseUrl ? { licenseUrl: data.licenseUrl } : {}),
          },
        });
      }}
    >
      <h3 className="font-semibold">Cadastrar fonte</h3>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Título da fonte
          <input
            aria-label="Título da fonte"
            className={input}
            required
            maxLength={200}
            value={data.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label className="block">
          Tipo de origem
          <select
            aria-label="Tipo de origem"
            className={input}
            value={data.originType}
            onChange={(e) => set("originType", e.target.value)}
          >
            <option value="EXTERNAL_URL">
              URL externa — somente referência
            </option>
            <option value="LOCAL_ASSET">Vídeo local já armazenado</option>
          </select>
        </label>
        {data.originType === "EXTERNAL_URL" ? (
          <label className="block">
            URL original (HTTPS)
            <input
              aria-label="URL original"
              className={input}
              type="url"
              pattern="https://.*"
              required
              maxLength={2048}
              value={data.originalUrl}
              onChange={(e) => set("originalUrl", e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="block">
              Vídeo local
              <select
                aria-label="Vídeo local"
                className={input}
                required
                value={data.localAssetId}
                onChange={(e) => set("localAssetId", e.target.value)}
              >
                <option value="">Selecione um vídeo</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {new Date(a.createdAt).toLocaleString("pt-BR")}{" "}
                    · {a.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              Mostra vídeos MP4 disponíveis no storage dos seus projetos de
              conteúdo. O arquivo original permanece intacto.
            </p>
            {error && <p role="alert">{error}</p>}
          </>
        )}
        <label className="block">
          Duração conhecida (segundos, opcional)
          <input
            aria-label="Duração da fonte"
            className={input}
            type="number"
            min="0.01"
            max="86400"
            step="any"
            value={data.duration}
            onChange={(e) => set("duration", e.target.value)}
          />
        </label>
        <label className="block">
          Autorização / licenciamento
          <select
            aria-label="Autorização"
            className={input}
            value={data.authorization}
            onChange={(e) => set("authorization", e.target.value)}
          >
            <option value="UNKNOWN">A verificar</option>
            <option value="OWNED">Conteúdo próprio</option>
            <option value="AUTHORIZED">Uso autorizado</option>
            <option value="PUBLIC_DOMAIN">Domínio público</option>
          </select>
        </label>
        <label className="block">
          Informações de autorização
          <textarea
            aria-label="Informações de autorização"
            className={input}
            maxLength={2000}
            value={data.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </label>
        <label className="block">
          URL da licença (opcional)
          <input
            aria-label="URL da licença"
            className={input}
            type="url"
            pattern="https://.*"
            maxLength={2048}
            value={data.licenseUrl}
            onChange={(e) => set("licenseUrl", e.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          O cadastro registra sua declaração de uso. Nenhum vídeo é baixado,
          analisado ou processado nesta etapa.
        </p>
        <button className={button} type="submit">
          Adicionar fonte
        </button>
      </fieldset>
    </form>
  );
}
