# Video Remix — Etapa 2: descoberta e importação

## Entrega

A página de detalhes do Video Remix permite pesquisar no YouTube, selecionar candidatos e importar arquivos autorizados. A integração reutiliza `YoutubeService`, autenticação, PostgreSQL, storage privado e `MediaProcess` existentes. Não foram adicionadas dependências npm nem chamadas de IA.

- Pesquisa explícita por termo, idioma, quantidade (até 25 por página), relevância/data/visualizações, duração e Creative Commons, com paginação.
- Cards com título, descrição, canal, thumbnail, data, duração, visualizações, origem e licença. Disponibilidade pública e Creative Commons não autorizam automaticamente o uso.
- Candidatos sem download: `DISCOVERED`, `SELECTED`, `IMPORTED` e `UNAVAILABLE`, preservando os estados legados. Single Source exige confirmação para substituir; Multi Source admite múltiplas fontes sem duplicidade.
- Upload MP4, MOV, WebM e MKV para disco, com progresso e cancelamento. Validação de extensão, MIME, assinatura do contêiner e FFprobe, incluindo presença de pacotes de vídeo, duração, resolução, codec e FPS.
- Declaração obrigatória de direitos, autor, licença, evidência, observações e data de verificação. O registro é uma declaração do usuário, não prova automática de licenciamento.
- Associação posterior de arquivo a uma referência do YouTube; reutilização de arquivos dentro do mesmo projeto; desvinculação, retirada de autorização e exclusão.
- Arquivos privados com controle de proprietário e streaming com Range. Nomes internos gerados, sem caminhos fornecidos pelo usuário.
- Limpeza de temporários, cancelamentos e falhas de storage; fila persistente de exclusões com tentativa posterior. Excluir uma referência preserva o arquivo para reutilização; excluir o arquivo remove suas associações.
- Cache de pesquisas de 15 minutos, reaproveitamento dos detalhes, trava de pesquisas simultâneas equivalentes e limite por proprietário. Metadados da API armazenados em fontes expiram após 30 dias; arquivos importados e declarações permanecem.

## Configuração e migration

Novas variáveis em `api/.env.example`:

```dotenv
VIDEO_REMIX_UPLOAD_MAX_MB=250
VIDEO_REMIX_UPLOAD_TEMP_DIR=storage/remix-upload-tmp
VIDEO_REMIX_SEARCH_PER_MINUTE=10
```

O tamanho admite de 1 a 2048 MB; o limite de pesquisas admite de 1 a 30 por minuto. O diretório temporário deve ser gravável e privado. Preserve também o volume do storage existente. Ajuste limites do proxy, se houver, para aceitar o upload configurado.

Reutilizadas: `YOUTUBE_V3_API_KEY`, configuração do banco/storage, `CONTENT_ACCESS_KEY`, `CONTENT_OWNER_ID` e `FFPROBE_PATH`. Sem `FFPROBE_PATH`, utiliza-se `ffprobe-static`, já instalado. O processo de validação tem timeout de 30 segundos e concorrência local máxima de dois arquivos.

No Google Cloud, habilite YouTube Data API v3 e configure uma chave de servidor em `api/.env`, restrita à API e ao ambiente apropriado. A chave permanece no backend. OAuth não é necessário para esta pesquisa pública.

Migration nova: `api/migrations/016_video_remix_import.sql`. Cria arquivos, cache, limite de pesquisas, fila de limpeza e campos de origem/importação; mantém compatibilidade com a etapa 1. O runner existente foi atualizado:

```bash
cd api
npm run migrate:video-remix
```

O Compose atual contém somente PostgreSQL. Se estiver parado, inicie-o com `docker compose up -d postgres` na raiz e confira a conexão do backend (porta publicada 5433). A tentativa de migration no banco configurado nesta sessão retornou `ECONNREFUSED`; a aplicação nesse banco permanece pendente. Não foram alteradas credenciais nem o `.env`. No banco descartável, as migrations 004–016 foram aplicadas duas vezes com sucesso, verificando repetibilidade.

## API

Base: `/video-remix/projects/:projectId`. Todas as operações exigem a sessão/chave e propriedade existentes. Mutações usam a revisão do projeto para evitar sobrescritas concorrentes.

| Método | Caminho | Uso |
| --- | --- | --- |
| GET | `/import-settings` | Limites e formatos |
| POST | `/discovery/search` | Pesquisa com filtros e pageToken |
| GET | `/discovery/videos/:videoId` | Detalhes do vídeo |
| GET / POST | `/candidates` | Listar/adicionar candidatos |
| DELETE | `/sources/:sourceId` | Remover candidato, endpoint existente |
| POST | `/files` | Multipart: file, revision, rights em JSON e sourceId opcional |
| GET | `/files` | Listar arquivos |
| GET | `/files/:fileId` | Metadados |
| GET | `/files/:fileId/file` | Streaming privado |
| POST / DELETE | `/sources/:sourceId/file` | Associar/desvincular arquivo |
| PATCH | `/sources/:sourceId/authorization` | Atualizar/retirar declaração |
| DELETE | `/files/:fileId` | Excluir arquivo e associações |

## Teste manual

1. Aplique a migration, configure a chave do YouTube e inicie API/frontend pelos comandos habituais.
2. Acesse Video Remix, autentique-se e crie/abra um projeto em rascunho.
3. Em **Pesquisar vídeos**, informe o termo e clique em pesquisar. Digitar não dispara chamadas. Teste filtros e próxima página.
4. Selecione um candidato. Em Single Source, selecionar outro exige confirmação. Em Multi Source, adicione vários e tente repetir um resultado.
5. Escolha um arquivo local, informe os direitos e a evidência, confirme a declaração e envie. Confira duração, resolução e FPS.
6. Associe o arquivo a uma referência, teste sua abertura autenticada, desvincule e associe novamente. Retire a autorização e confira o estado indisponível.
7. Teste cancelamento, arquivo inválido e exclusão. Recarregue a página para verificar persistência.

## Validação automatizada

- API: **49 suítes e 524 testes passaram**, comando `node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand` em `api`.
- Frontend: **90 testes passaram**, `npm test` em `frontend`.
- Integração: PostgreSQL 17 descartável, HTTP real, mocks da API oficial e FFprobe real nos quatro formatos. Inclui cache, filtros, paginação, quota/falhas, duplicidade, Single/Multi Source, propriedade, direitos, Range, cancelamento antes/depois do recebimento, arquivos inválidos, falhas de armazenamento, repetição de limpeza e persistência.
- Chrome real: pesquisa explícita, paginação, substituição Single Source, upload, associação, persistência, retirada de autorização, exclusão, arquivo inválido e larguras 1440/768/390.
- API e frontend compilados; lint de ambos passou. Frontend mantém aviso de bundle acima de 500 kB.
- Nenhuma chamada real ao YouTube ou a modelos de IA. Pequenos vídeos sintéticos foram gerados somente como fixtures dos testes.
- Evidências locais: `/tmp/trends-remix-import-A5dgSh`. Logs: `/tmp/remix-final-integration.log`, `/tmp/remix-final-unit.log`, `/tmp/remix-final-front.log`.

Reexecutar a integração requer `CONTENT_TEST_DATABASE_URL` apontando para PostgreSQL de teste com permissão de criar banco e Chrome instalado. Execute `npm run test:remix-import:integration` em `api`; o script cria e remove seu banco isolado. Não use credenciais de produção.

## Quota e limitações

Cada pesquisa não atendida pelo cache utiliza `search.list`, seguida de `videos.list` em lote para os detalhes; paginação é outra pesquisa. A documentação consultada informa um limite separado padrão de 100 chamadas diárias para `search.list` e custo de uma unidade para `videos.list`. Confira os limites efetivos no Google Cloud do projeto, pois podem variar. Referências oficiais: [search.list](https://developers.google.com/youtube/data/reference/rest/v3/search/list), [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list) e [quota](https://developers.google.com/youtube/data/determine_quota_cost).

O idioma é uma preferência de relevância do YouTube, não garantia do idioma falado. Licenças e disponibilidade refletem os dados retornados pela plataforma. A verificação por FFprobe não equivale a uma decodificação integral nem garante reprodução em todos os navegadores. O limite de upload e os codecs aceitos são conservadores; arquivos incompatíveis precisam de conversão externa. O rate limit é por proprietário e o cache usa PostgreSQL; não há fila distribuída de upload.

Não há download do YouTube, scraping ou extração de streams. A plataforma guarda referências e recebe arquivos obtidos legitimamente pelo usuário. Não foram implementados análise visual, transcrição, extração de melhores momentos, roteiro, narração, edição ou renderização: a etapa 3 permanece fora do escopo.

## Arquivos criados e modificados

Criados:

- `api/migrations/016_video_remix_import.sql`
- `api/src/video-remix/discovery.schema.ts`
- `api/src/video-remix/youtube-discovery.provider.ts`
- `api/src/video-remix/remix-discovery.service.ts`
- `api/src/video-remix/remix-discovery.spec.ts`
- `api/src/video-remix/remix-import.settings.ts`
- `api/src/video-remix/remix-video.validator.ts`
- `api/src/video-remix/remix-files.service.ts`
- `api/src/video-remix/remix-import.service.ts`
- `api/src/video-remix/remix-import.controller.ts`
- `api/src/video-remix/remix-upload.interceptor.ts`
- `api/src/video-remix/remix-url.ts`
- `api/src/video-remix/multer.d.ts`
- `api/test/video-remix/remix-import.integration.cjs`
- `api/test/video-remix/remix-import.browser.cjs`
- `frontend/src/pages/VideoRemix/RemixImportPanel.jsx`
- `frontend/test/remixImport.test.mjs`
- Este relatório.

Modificados:

- `api/.env.example`, `api/package.json`, `api/scripts/migrate-assets.cjs`
- `api/src/content-assets/local-storage.provider.ts`
- `api/src/sources/youtube/youtube.service.ts` e `.spec.ts`
- `api/src/video-remix/video-remix.module.ts`, `.repository.ts`, `.schema.ts` e `.service.ts`
- `api/test/video-remix/video-remix.integration.cjs` (URLs distintas na fixture para respeitar a deduplicação)
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`
- `frontend/src/services/videoRemixService.js`
- `frontend/src/types/videoRemix.d.ts`
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`
