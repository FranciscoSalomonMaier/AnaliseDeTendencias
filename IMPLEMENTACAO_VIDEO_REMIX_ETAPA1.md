# Video Remix — Etapa 1: projetos e referências de fontes

Implementação em 12/11/2026. Entrega limitada à estrutura e ao gerenciamento de projetos/fontes. A Etapa 2 não foi iniciada.

## Diagnóstico inicial

A aplicação usa React 19/Vite/Tailwind/Heroicons no frontend, NestJS/TypeScript/Zod no backend e PostgreSQL com `pg` e migrations SQL. A navegação existente usa query parameters e histórico do navegador, sem nova biblioteca de rotas.

A criação atual de vídeos passa por `content-projects` (ideias, roteiro e cenas), `content-assets` (imagens/storage), `content-narration` (TTS), `content-audio`, `content-subtitles`, `video-render`, `content-publication` e `youtube-publishing`. Há filas PostgreSQL para processamento, RenderJobs com snapshots e FFmpeg compartilhado. Os arquivos ficam no StorageProvider/LocalStorageProvider com referências imutáveis a assets. A sessão local usa CONTENT_ACCESS_KEY, cookie HttpOnly/bearer e proprietário CONTENT_OWNER_ID.

O Video Remix reutiliza essa navegação, componentes visuais, StudioAccess, ContentAccessGuard, PostgresDatabaseService e a instância existente de StorageProvider. O módulo importa AiModule para acessar o provider de banco já exportado; não faz chamadas aos providers de IA. Não modifica o pipeline de criação, renderização, narração ou publicação.

## O que foi implementado

- Projetos independentes em `video_remix_projects`: ID, proprietário, título, tema, descrição, SINGLE_SOURCE/MULTI_SOURCE, idioma, duração desejada, proporção, status, revisão e datas.
- Fontes em `video_remix_sources`: ID/projeto, título, origem, URL ou asset local, duração opcional, status, declaração/licenciamento e data.
- CRUD de projetos, cadastro/listagem/remoção de fontes e catálogo de vídeos locais do proprietário.
- Interface Video Remix na navegação principal, com listagem paginada, criação, detalhes, edição, exclusão e cadastro de fontes.
- URL navegável com `?page=video-remix`, `remixView` e `remixProjectId`, incluindo recarga e histórico do navegador.
- Controle de revisão para impedir sobrescritas entre janelas; transações e bloqueio da linha do projeto nas mutações.

## Regras e limites

Os projetos são criados exclusivamente em DRAFT. Os demais estados estão declarados e há uma matriz de transições para as próximas etapas:

```text
DRAFT → SOURCES_PENDING
SOURCES_PENDING → DRAFT | ANALYZING | FAILED
ANALYZING → SCRIPTING | FAILED
SCRIPTING → RENDERING | FAILED
RENDERING → COMPLETED | FAILED
FAILED → DRAFT
COMPLETED → estado final
```

Nenhum endpoint desta etapa inicia essas transições. O cliente não pode fornecer `status` ou proprietário em criação/edição. Edição, exclusão e alterações de fontes são limitadas a DRAFT, preparando o bloqueio durante processamento futuro.

- Título: 1–160 caracteres; tema: 1–300; descrição: até 4.000.
- Duração desejada: inteiro de 5–600 segundos; formato 16:9 ou 9:16.
- Idioma: código no formato de idioma/região; interface oferece pt-BR, en-US e es-ES. Isso é metadado para o pipeline futuro, sem geração de narração.
- Fontes: até 100 por projeto; título até 200; duração conhecida positiva e finita, até 86.400 segundos.
- URLs: HTTPS, até 2.048 caracteres, sem credenciais embutidas. São somente referências: o servidor não visita, valida a existência ou baixa a URL.
- Licenciamento: UNKNOWN, OWNED, AUTHORIZED ou PUBLIC_DOMAIN, notas até 2.000 caracteres e URL opcional de licença. A declaração do usuário não equivale à verificação jurídica do material.
- Single Source permite apenas uma fonte. A mudança de Multi para Single exige remover as fontes excedentes.
- A regra Single Source é conferida no serviço e reforçada por triggers PostgreSQL. A transação e a revisão do projeto também protegem alterações concorrentes.

## Fontes locais e armazenamento

LOCAL_ASSET aceita o UUID de um asset VIDEO/READY/MP4 pertencente a um projeto de conteúdo autorizado. O backend verifica a existência do arquivo via StorageProvider.stat e utiliza a duração registrada no asset quando disponível.

O catálogo lista até os 100 vídeos locais mais recentes. O cadastro não aceita caminhos arbitrários do filesystem nem storage keys enviadas pelo cliente. Não há upload de arquivos novos nesta etapa; referências locais reutilizam vídeos que já existem no storage do sistema. O conteúdo/codec do MP4 não é reanalisado nesta fase de metadados.

A exclusão de uma fonte remove apenas a associação. A exclusão do projeto remove seus cadastros de fontes por cascade. Os assets e arquivos originais são preservados. Uma referência local existente protege a linha do asset contra exclusão por FK.

## Segurança

As rotas `/video-remix` entram no ContentAccessGuard existente, exigindo CONTENT_ACCESS_KEY, autenticação via cookie/bearer e validação do Origin nas mutações do navegador. Na ausência da chave, o módulo retorna 503, sem criar endpoints públicos.

Todos os acessos a projetos filtram pelo proprietário configurado no servidor. IDs de outros proprietários retornam 404. A leitura/cadastro de assets locais verifica o proprietário do projeto de conteúdo, respeitando também a convenção existente de projetos legados com owner_id nulo. IDs de projeto/fonte e payloads são validados. Queries usam parâmetros.

O DTO público não inclui proprietário, credenciais ou caminhos físicos. URLs e textos não são interpretados como comandos. Não há downloader ou requisição do servidor para as URLs informadas.

## Endpoints

| Método/rota | Operação |
| --- | --- |
| POST /video-remix/projects | Criar projeto DRAFT. |
| GET /video-remix/projects?limit=20&offset=0 | Listar projetos do proprietário. Limite máximo 100. |
| GET /video-remix/projects/:projectId | Consultar projeto com fontes. |
| PATCH /video-remix/projects/:projectId | Atualizar com `{revision, data}`. |
| DELETE /video-remix/projects/:projectId | Excluir com `{revision, confirm:true}`. |
| POST /video-remix/projects/:projectId/sources | Adicionar fonte com revisão atual do projeto. |
| GET /video-remix/projects/:projectId/sources | Listar fontes autorizadas. |
| DELETE /video-remix/projects/:projectId/sources/:sourceId | Remover referência com `{revision, confirm:true}`. |
| GET /video-remix/local-assets | Catálogo de vídeos locais autorizados, sem caminhos físicos. |

Adicionar ou remover uma fonte incrementa a revisão e atualiza a data do projeto. Conflitos retornam 409 e a interface oferece os dados atuais. A paginação usa até 20 projetos por página na interface.

## Arquivos criados

- `api/migrations/015_video_remix.sql`
- `api/src/video-remix/video-remix.module.ts`
- `api/src/video-remix/video-remix.controller.ts`
- `api/src/video-remix/video-remix.service.ts`
- `api/src/video-remix/video-remix.repository.ts`
- `api/src/video-remix/video-remix.schema.ts`
- `api/src/video-remix/video-remix.spec.ts`
- `api/test/video-remix/video-remix.integration.cjs`
- `api/test/video-remix/video-remix.browser.cjs`
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`
- `frontend/src/services/videoRemixService.js`
- `frontend/src/utils/videoRemix.js`
- `frontend/src/types/videoRemix.d.ts`
- `frontend/test/videoRemix.test.mjs`
- `IMPLEMENTACAO_VIDEO_REMIX_ETAPA1.md`

## Arquivos modificados

- `api/src/app.module.ts`: registra VideoRemixModule.
- `api/src/content-assets/content-assets.module.ts`: exporta a instância existente de StorageProvider para reutilização.
- `api/src/content-publication/content-access.ts`: protege o novo prefixo e verifica Origin.
- `api/scripts/migrate-assets.cjs`: inclui migration 015 no runner já existente.
- `api/package.json`: comandos de migration e testes do módulo. Sem novas dependências.
- `frontend/src/App.jsx`: rota/navegação Video Remix.
- `frontend/src/layouts/Aside/Aside.jsx`: item da navegação principal.
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`: referência a esta entrega.

## Instalação e início

Com PostgreSQL disponível e DATABASE_URL correta no ambiente da API:

```bash
cd api
npm run migrate:video-remix
npm run start:dev
```

Em outro terminal:

```bash
cd frontend
npm run dev
```

Abra `http://localhost:5173/?page=video-remix` ou o item Video Remix no menu. Se solicitado, entre pelo componente Acesso ao estúdio com a chave local já configurada no servidor.

A tentativa de aplicar a migration no banco configurado da aplicação retornou **28P01 (falha de autenticação PostgreSQL)**. Portanto, a aplicação nesse banco ficou pendente: corrija as credenciais de DATABASE_URL e execute o comando acima. Não foram alteradas as chaves ou senhas do `.env`. A migration foi validada duas vezes em banco descartável, incluindo as migrations anteriores.

## Testes executados e resultados

- Backend: build Nest e TypeScript sem emissão aprovados; lint dos arquivos alterados aprovado.
- Suíte completa backend: **48 suites, 492 testes aprovados**, incluindo **36 testes unitários do Video Remix**.
- Frontend: build Vite e lint aprovados; suíte completa com **85 testes aprovados**. Declarações TypeScript conferidas.
- Integração PostgreSQL/Nest HTTP: CRUD, Single/Multi Source, status DRAFT, revisão otimista, fontes externas, catálogo/referência local, isolamento entre proprietários, acesso sem chave/sessão, Origin, tentativa de trocar Multi→Single com duas fontes, triggers, fontes de outro projeto, concorrência, persistência e exclusão sem apagar o original.
- Chrome real na aplicação: login local, criação nos dois modos, edição, cadastro de referência externa e vídeo local, bloqueio visual Single Source, recarga da página, remoção de fonte, exclusão de projeto e responsividade em 1440/768/390 sem overflow.
- `git diff --check` aprovado.

Comandos para repetir:

```bash
cd api
npm run test:video-remix
npm run build
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55444/postgres npm run test:video-remix:integration
```

Use somente um PostgreSQL descartável na variável de teste: o script cria e remove um banco próprio. O teste de navegador precisa do Chrome e usa portas locais 33873/33874. O teste não importa o AppModule completo, evitando iniciar coletores ou workers de produção.

```bash
cd frontend
npm test
npm run build
npm run lint
```

Evidências locais em `/tmp/trends-video-remix-AG5tsj/`: `video-remix-ui.png` e `result.json`. São temporárias e não precisam ser versionadas. O arquivo de vídeo de teste contém somente uma fixture de referência de storage e não é decodificado/processado.

O build frontend emite aviso de chunk principal com aproximadamente 501 kB, sem falha de compilação. Não foram introduzidas bibliotecas novas. A divisão dos demais módulos em chunks pode ser tratada separadamente.

## Limites e próximas etapas

Esta entrega não descobre vídeos, não baixa fontes externas, não importa novos arquivos, não analisa imagens/vídeos com IA, não gera roteiro ou narração, não seleciona timestamps, não renderiza, não exporta e não publica vídeos. Nenhum comando desta implementação fez chamadas pagas à IA.

As referências, IDs, modos e estados ficam persistidos para o pipeline futuro. Não existe job de processamento do Remix nesta etapa. A inclusão dessas funções depende da autorização da Etapa 2.
