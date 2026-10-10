# Produção — assets visuais das cenas

Implementação analisada e validada em 09/10/2026. Escopo: imagens persistentes por cena, geração, upload, variações e seleção. A geração real depende do acesso e saldo da conta OpenAI; as validações automatizadas e no Chrome usam provider simulado.

## 1. Diagnóstico e reaproveitamento

O projeto possui NestJS, React/Vite/Tailwind, PostgreSQL com `pg`, migrations SQL e um `LlmProvider` de texto/embeddings. `ContentProject`, ideias, roteiro, seções e cenas já são validados por Zod. Cenas têm UUID, ordem, narração, descrição visual, prompt e duração estimada. Os estados terminam em `SCENES_APPROVED`; configuração, seleção e edições possuem revisão e lock por projeto.

Não existiam OpenAI Images, Firefly, uploads, storage, arquivos de mídia ou assets reais; apenas tipos de assets para evolução futura. Não há TypeORM, Redis/BullMQ, autenticação ou usuários/workspaces. A produção anterior era um placeholder.

Reutilizados: projetos e cenas, PostgreSQL, `ContentProjectRepository`, locks/revisões, `OPENAI_API_KEY`, SDK OpenAI instalado, editores de roteiro/cenas, timestamps, aprovação e visual do Estúdio. `ContentProjectModule` exporta o repository para o novo módulo. O fluxo legado permanece disponível; seu `ProductionStep` continua separado do novo fluxo de projetos.

## 2–5. ImageProvider, modelo e configuração

`ContentAssetsService` depende da abstração `ImageProvider`. O adapter concreto `OpenAiImageProvider` usa `openai.images.generate`, com o SDK **7.15.0** instalado no início da tarefa. Não chama o provider textual para gerar imagens nem envia a chave ao frontend.

Padrões centralizados em `ImageSettings`:

| Configuração | Padrão | Regra |
| --- | --- | --- |
| `IMAGE_PROVIDER` | `openai` | Único adapter implementado |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare` | GPT Image 2/2.5 com dimensões flexíveis |
| `IMAGE_QUALITY` | `medium` | low, medium ou high |
| `IMAGE_CONCURRENCY` | `2` | Entre 1 e 3 chamadas em execução |
| `IMAGE_MAX_QUEUED` | `200` | Limite de admissão da fila local |
| `IMAGE_TIMEOUT_MS` | `180000` | Entre 30 e 300 segundos |
| `CONTENT_STORAGE_PATH` | `storage` | Raiz relativa ao diretório de execução da API, ou absoluta |
| `OPENAI_API_KEY` | Chave existente | Exclusivamente no backend |

O adapter solicita uma imagem PNG por chamada, background opaco, sem retries automáticos do SDK. O resultado contém bytes, provider, modelo, metadata e usage quando disponível. GPT Image retorna base64, convertido em bytes e validado antes de salvar; URL temporária não é aceita como arquivo permanente.

Endpoint, modelos, dimensões e parâmetros foram conferidos na [referência oficial Images](https://developers.openai.com/api/reference/resources/images/methods/generate) e no [guia oficial](https://developers.openai.com/api/docs/guides/image-generation). Não são utilizados `response_format`, `style` legados ou DALL-E. O estilo é aplicado no prompt.

## 6. Storage

`StorageProvider` define `save`, `delete`, `read` e `getUrl`. `LocalStorageProvider` mantém arquivos fora do código e não depende da OpenAI.

```text
storage/content-projects/{projectId}/scenes/{sceneId}/{assetId}.png
storage/content-projects/{projectId}/references/{assetId}.png
```

JPEG usa `.jpg`; WEBP usa `.webp`. Os nomes originais não compõem o caminho. O storage valida keys e a raiz, cria arquivos exclusivos, remove gravações parciais e usa permissão 0600. `/storage` está no `.gitignore` da API.

Imagens são servidas por uma rota que valida projeto e asset antes de ler os bytes. A resposta inclui MIME verificado, `nosniff`, disposição inline e cache privado. O diretório inteiro não é exposto como conteúdo estático.

Para deploy futuro, persistir/montar e fazer backup dessa raiz. S3/R2 podem implementar o mesmo contrato; não foram adicionados.

## 7–9. Modelagem, vínculo e seleção

`content_assets` armazena:

- UUID, projectId e sceneId opcional;
- tipo IMAGE e origem AI_GENERATED/USER_UPLOAD;
- status PENDING/GENERATING/READY/FAILED;
- usage REQUIRED/REFERENCE/OPTIONAL;
- storageKey, MIME, largura e altura;
- provider, modelo, prompt original e prompt final;
- fingerprint da cena, metadata, usage de tokens e erro seguro;
- createdAt/updatedAt.

`content_scene_visuals` mantém uma seleção por `(project_id, scene_id)`, com assetId e fingerprint aceito. Uma FK composta exige que o asset selecionado pertença ao mesmo projeto. Assets não são salvos como uma simples URL na cena.

Como cenas continuam em JSONB, o pertencimento e a existência da cena são validados no service; não foi criada uma tabela duplicada de cenas. `/assets` retorna assets, seleções, prontidão/desatualização por cena e contagens. O progresso considera selecionado + READY.

Uma cena pode ter várias imagens. Imagens enviadas ao projeto e assets de cenas antigas podem ser reutilizados explicitamente em cenas atuais. Nenhuma seleção chama a IA. Assets de outro projeto, mesmo com UUID válido, são rejeitados.

## 10. Regeneração, concorrência e falhas

Cada tentativa cria um novo asset. Não apaga nem sobrescreve a imagem anterior. A seleção automática só ocorre após validação, storage e persistência bem-sucedidos, com a cena ainda aprovada e o fingerprint atual compatível.

Se o usuário selecionou outra imagem ou fez upload enquanto a geração estava em andamento, essa seleção explícita prevalece. Falha de provider/storage mantém a seleção anterior; a tentativa fica FAILED e pode ser repetida. Metadata/usage retornadas pelo provider são preservadas inclusive quando o storage falha.

Reservas de trabalho usam lock curto do projeto e conferem sua revisão. Um índice parcial impede duas gerações ativas para a mesma cena. Chamadas ao provider ocorrem fora da conexão/transação de projeto, numa fila local compartilhada pelo módulo com concorrência limitada. Projetos diferentes usam a mesma limitação de chamadas.

Geração retorna HTTP 202. O frontend consulta o estado enquanto há PENDING/GENERATING. O lote reserva somente cenas sem uma seleção READY e sem tentativa ativa; falhas são individuais, sem desfazer as cenas que deram certo.

Um advisory lock de sessão identifica o único worker local por banco. Outra API não pode assumir a fila e marcar o trabalho da primeira como interrompido. No restart, PENDING/GENERATING antigos viram FAILED, sem repetir automaticamente chamadas potencialmente cobradas. O usuário decide repetir. A seleção final usa transação, com breve retry para conclusões simultâneas; se o projeto permanecer ocupado, a imagem pode ficar READY e disponível para seleção manual.

## 11–12. Upload e validações

Uploads multipart usam `FileInterceptor`, mecanismo já disponível no Nest/Express. Campo `file`, revisão do projeto e usage opcional. Sem infraestrutura de upload anterior para duplicar.

Limites centralizados: **10 MB**, **24 milhões de pixels**, uma imagem estática por envio. PNG/JPEG/WEBP apenas. MIME declarado, extensão, formato detectado, dimensões e conteúdo decodificado precisam ser compatíveis. Arquivos vazios, truncados, SVG, HTML, scripts/executáveis, MIME falso e dimensões excessivas são rejeitados. Imagens animadas identificadas pelo decoder são rejeitadas.

`sharp` é a única nova dependência de runtime: decodifica todos os pixels, aplica orientação e reencoda a imagem, removendo metadata/conteúdo extra. O arquivo salvo possui UUID gerado pelo backend. Nenhum nome original ou secret é usado como storage key.

Não há autenticação no sistema atual. A implementação verifica pertencimento ao projeto e valida UUIDs; não fornece isolamento entre usuários inexistentes. O contexto continua compartilhado, como na etapa anterior.

## 13–15. Dark, PromptBuilder e formato

`VISUAL_STYLE_PRESETS.DARK` centraliza cinematografia documental, atmosfera, composição e iluminação coerentes. Explicita que cenas diurnas devem permanecer claras e legíveis. Dark não vira um filtro que escurece todas as imagens.

`SceneImagePromptBuilder` combina tema do projeto, preset, proporção, narração como contexto, descrição visual, imagePrompt e descrição das cenas próximas. Pede um frame sem legendas/texto sobreposto e continuidade de linguagem visual. Não há seed, identidade complexa de personagens ou garantia de continuidade perfeita.

`scene.imagePrompt` permanece editável e não é sobrescrito pelo prompt final. Para usar uma edição: voltar às cenas, editar, salvar, aprovar novamente e gerar. Não há geração automática ao digitar.

VIDEO solicita **16:9**, traduzido pelo adapter para **1536×864**. O provider recebe aspectRatio no contrato; o adapter também tem tradução para 9:16 e 1:1, sem expor novos tipos de projeto nesta etapa. Uploads mantêm sua proporção e aparecem com `object-contain`; não são cortados silenciosamente.

## 16. Endpoints

Base: `/content-projects/:projectId`.

| Método | Caminho | Retorno/ação |
| --- | --- | --- |
| GET | `/assets` | Estado visual completo do projeto |
| GET | `/scenes/:sceneId/assets` | Estado/variações da cena |
| POST | `/scenes/:sceneId/images/generate` | 202, queued e assetIds |
| POST | `/images/generate-missing` | 202, somente faltantes; exige confirm |
| POST | `/scenes/:sceneId/images/upload` | Salva e seleciona upload |
| POST | `/references/upload` | Salva imagem do projeto com usage |
| PATCH | `/scenes/:sceneId/assets/:assetId/select` | Seleção sem chamada ao provider |
| GET | `/assets/:assetId/file` | Bytes permanentes do storage |

Mutações exigem `revision`; lote recebe `confirm: true`. Multipart recebe revisão em string numérica. IDs passam por `ParseUUIDPipe`. Geração/seleção de imagens de cena exige SCENES_APPROVED e artefatos atuais. Referências podem ser enviadas ainda em rascunho.

## 17. Migration

`005_content_visual_assets.sql` cria duas tabelas e índices numa transação, sem remover dados ou modificar os documentos de cenas existentes. É repetível. `npm run migrate:assets` aplica 004 e 005, também para um banco que ainda não recebeu a etapa anterior.

Foi aplicada ao PostgreSQL local. A integração aplica cada migration duas vezes e verifica que os conteúdos legados permanecem. **Foi mantida a infraestrutura de migrations SQL/pg existente; não foi introduzido TypeORM nem synchronize.**

## 18–19. Arquivos backend

Criados em `api/src/content-assets/`:

- `content-asset.ts`
- `content-asset.repository.ts`
- `content-assets.service.ts`
- `content-assets.controller.ts`
- `content-assets.module.ts`
- `image.provider.ts`
- `openai-image.provider.ts`
- `image-settings.ts`
- `image-generation.queue.ts`
- `image-file.validator.ts`
- `storage.provider.ts`
- `local-storage.provider.ts`
- `scene-image-prompt.builder.ts`
- `content-assets.service.spec.ts`
- `openai-image.provider.spec.ts`

Também criados: migration 005, `api/scripts/migrate-assets.cjs` e `api/test/content/assets.integration.cjs`.

Alterados nesta etapa: `api/src/app.module.ts`, `api/src/content-projects/content-project.module.ts`, `api/src/database/postgres-database.service.ts`, `api/package.json`, `api/package-lock.json`, `api/.env.example`, `api/.gitignore` e `api/test/content/projects.integration.cjs`. O teste anterior acompanha a nova tela de produção usando estado visual simulado. Em `api/trends/content-generation.service.spec.ts`, o mock recebeu o método de embeddings já requerido pelo `LlmProvider`, para a checagem TypeScript completa dos specs.

O workspace já continha alterações da etapa anterior; elas foram preservadas. Esta lista descreve o escopo adicional, não toda a diferença do workspace em relação ao último commit.

## 20–21. Arquivos frontend

Criados:

- `frontend/src/services/contentAssetService.js`
- `frontend/src/utils/contentVisualState.js`
- `frontend/src/pages/ContentCreation/components/VisualProduction.jsx`
- `frontend/src/pages/ContentCreation/components/VisualReferences.jsx`
- `frontend/test/contentAssets.test.mjs`

Alterados: `ContentProjectCreation.jsx`, `components/ProjectConfiguration.jsx`, `components/ContentStudioStepper.jsx` e `frontend/src/types/contentProject.d.ts`.

A produção de projetos usa `VisualProduction`; o placeholder legado permanece em `ProductionStep`. A configuração inclui imagens REQUIRED/REFERENCE/OPTIONAL; enviar antes das ideias salva um rascunho. No stepper, Produção fica acessível após aprovação das cenas. Os cards mostram preview, variações, imagem selecionada, prompt original, erros/retry e progresso X/Y. Lote pede confirmação pelo mecanismo `window.confirm` já utilizado no projeto.

## 22–23. Validação

Resultados: **28 suites e 155 testes Jest aprovados**; os **quatro arquivos de testes do frontend aprovados**. Builds Nest e Vite, checagem `tsc --noEmit` e ESLint de backend/frontend aprovados. A migration foi aplicada no banco local e repetida nos bancos isolados de integração.

Backend: suites de assets cobrem geração, persistência, seleção, regeneração sem exclusão, erros de provider/storage, uploads nos três formatos, MIME/extensão/tamanho/conteúdo inválidos, dimensões excessivas, referências, projeto/cena/asset inexistentes, revisão/status incompatíveis, batch, concorrência, invalidação e seleção feita durante geração. O adapter OpenAI é mockado e seus parâmetros são verificados.

Frontend: renderização de previews, upload, variações, selecionada, erros/retry, loading, bloqueios, imagem anterior, progresso, referências e navegação para Produção; requests verificam revisão, confirmação e multipart. Sem framework novo.

Integração PostgreSQL descartável + HTTP + filesystem: migrations repetidas, isolamento por projeto, arquivos/imagens válidos, falhas preservando seleção, upload inválido/limite multipart, batch ignorando prontos, duas chamadas simultâneas no máximo, geração duplicada rejeitada, revisão, cenas desatualizadas, recuperação e proteção contra segundo worker.

Chrome: abrir projeto aprovado → gerar → regenerar → selecionar anterior → selecionar nova → upload → preview selecionado → gerar faltantes → 3/3 → sair → reabrir → confirmar seleções e previews. Larguras 1440/768/390 conferidas sem overflow. Screenshot: `/tmp/trends-visual-production.png`. Provider de imagens simulado; nenhuma geração real OpenAI nos testes. A integração anterior também verifica tema → ideias → roteiro → cenas → aprovação e reabertura.

Comandos:

```sh
cd api
npm run migrate:assets
npm run build
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint 'src/**/*.ts' 'trends/**/*.ts'
./node_modules/.bin/jest --config jest.ai-cache.config.cjs --runInBand
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:assets:integration
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:content:integration
cd ../frontend
npm run build
npm run lint
npm test
```

Integrações exigem PostgreSQL de testes com permissão de criar/remover bancos e Google Chrome. Cada execução cria e remove um banco isolado. Arquivos de conferência usam `/tmp`; não apontar o teste ao banco operacional.

## 24. Limitações

- Fila em memória, com estado persistido e recuperação por falha no restart; não é um scheduler distribuído. Apenas um worker local por banco.
- Referências persistidas/exibidas/selecionáveis, mas não enviadas ao provider. Image-to-image não está implementado nem anunciado como funcional.
- REQUIRED significa que a imagem deve ser selecionada numa cena; a UI avisa quando ainda falta. Não existe render final para garantir sua aparição num MP4.
- Regenerar cenas mantém os assets antigos e permite reutilizá-los; não tenta associar automaticamente UUIDs de cenas diferentes.
- Mudanças de tema/estilo, narração, descrição visual ou imagePrompt alteram o fingerprint. Duração isolada não o altera. A seleção desatualizada pode ser mantida explicitamente depois de reaprovar.
- Sem garbage collection de variações; sem exclusão pelo usuário nesta etapa. Limpeza técnica de arquivos de tentativas falhas não apaga imagens anteriores.
- Sem autenticação/isolamento por usuário, storage remoto, TTS, música, efeitos, legendas, timeline, FFmpeg, vídeo, MP4 ou publicação.
- Geração real não foi executada nesta validação; permissões/saldo/limites e qualidade do modelo dependem da conta configurada.

## 25. Chamadas e custos

Somente Gerar imagem/Gerar novamente/Gerar imagens faltantes chama a OpenAI. Aprovar cenas, salvar um prompt, consultar progresso, reabrir, selecionar e fazer upload não chamam o provider de imagens. Cada tentativa explícita gera `n=1`; sem retry automático e sem fallback silencioso para outro modelo. O lote informa quantas cenas faltam e pede confirmação.

Usage retornada pelo provider fica no asset, incluindo falha posterior de storage. Valores em dinheiro não são calculados. Limites ou recusas retornam mensagem segura e não quebram os assets existentes.

## 26. Uso e próximos passos

Reinicie o backend no terminal habitual, sem executar uma segunda instância na mesma porta. Abra YouTube → Criação → projeto com cenas aprovadas → Produção. Teste uma imagem por ação explícita; confira as variações e então gere as faltantes. Uploads e seleções são salvos imediatamente. Para editar prompt, volte às cenas, salve e aprove conforme o fluxo existente.

Próximas etapas: adapter de storage remoto e autenticação conforme necessidade de deploy; depois TTS a partir de `scene.narration`, assets de áudio e duração real. Timeline/render poderão consumir as seleções e identidades de assets existentes. `estimatedDurationSeconds` continua como base de planejamento, sem misturar narração e descrição visual.
