# Etapa 8 — Vídeos verticais, versões curtas e preparação por destino

Implementação em 19/10/2026. Sem publicação automática e sem chamadas pagas durante a validação.

## Diagnóstico inicial

O repositório já possuía projetos e cenas, assets selecionados por cena, imagens OpenAI, narração, fila persistente de renderização, movimentos, CUT/FADE/CROSSFADE, mixagem, legendas ASS/SRT e preparação para YouTube. Portanto, esses serviços foram reutilizados.

Os bloqueios encontrados foram: `RenderSettings` aceitava somente resolução horizontal, `TimelineBuilder` usava somente a resolução global, prévias usavam 640×360, prompts de cena escolhiam sempre 16:9, players usavam `aspect-video`, legendas escalavam a fonte pela altura e a preparação mantinha um único conjunto de metadados. O ImageProvider já possuía a opção 9:16; não foi necessário trocar provider ou modelo.

## Formatos e arquitetura

`api/src/video-render/video-formats.ts` centraliza os presets:

| Formato | Resolução final | FPS |
| --- | --- | --- |
| 16:9 | 1920×1080 | 30 |
| 9:16 | 1080×1920 | 30 |

O fluxo permanece `ContentProject → assets → configurações de edição → TimelineBuilder → FfmpegRenderer → RenderJob`. H.264, AAC, yuv420p, qualidade, threads, concorrência, timeout, limites de arquivo e espaço em disco existentes foram preservados. A resolução configurada por ambiente continua sendo utilizada para projetos legados sem seleção explícita. Os presets são aplicados a novas saídas com formato escolhido.

Formato e plataforma são escolhas independentes. O mesmo MP4 pode ser selecionado para mais de um destino; isso não cria outro RenderJob.

## Dados e persistência

- `ProjectConfig.aspectRatio?`: padrão editorial para novas imagens e saída, com fallback horizontal legado.
- `targetDurationSeconds`: agora aceita 30–600 segundos, incluindo 30, 60, 90 e valor personalizado na criação.
- `sourceProjectId?`: relação explícita de um projeto derivado com o original.
- `EditingSettings.aspectRatio?`: formato da próxima saída, independente do roteiro.
- `EditingSettings.variants`: movimentos, fit, amplitude, ponto focal e zoom por formato/cena.
- `EditingSettings.subtitleVariants`: apresentação das legendas por formato, reutilizando os mesmos alinhamentos.
- `TimelineScene.focalX/focalY?`: coordenadas entre 0 e 1; fallback central 0,5.
- `TimelineScene.zoom?`: de 1 a 2; fallback 1.
- Snapshots continuam contendo config, dimensões, FPS, assets, movimentos, enquadramento, transições, mixagem, legendas, revisão e duração. Dados de jobs iniciados ou concluídos não são reescritos.
- `content_publication_destinations`: preparação independente para Shorts e Reels, com revisão otimista e referências compostas ao RenderJob e capa do próprio projeto.
- `content_publication_generations.target`: destino do histórico de sugestões. O bloqueio de geração simultânea e o limite de gerações continuam compartilhados pelo projeto.

A migration aditiva `012_content_vertical.sql` preserva a preparação tradicional na tabela existente. O runner foi atualizado e a migration foi aplicada duas vezes no teste descartável, verificando idempotência. Não há alteração de arquivos ou reprocessamento de vídeos anteriores.

**Banco de desenvolvimento:** a tentativa de aplicação no banco de `api/.env` retornou `ECONNREFUSED`. Quando esse banco estiver disponível, execute em `api`:

```sh
npm run migrate:vertical
```

Depois, reinicie a API. Nenhuma chave ou credencial foi alterada nesta etapa.

## Imagens e enquadramento

Os prompts verticais mantêm as instruções existentes de continuidade de personagens e locais e adicionam composição vertical, assunto dentro da área central e espaço para legendas. A geração explícita usa o formato salvo na montagem ou o padrão do projeto. O formato pedido é congelado no asset enfileirado.

O provider existente utiliza `OPENAI_IMAGE_MODEL`, sem mudança de modelo. Seu mapeamento já solicita 864×1536 para 9:16 e 1536×864 para 16:9. O modelo configurável aceito pelo código é da família GPT Image 2/2.5, com dimensões flexíveis. A imagem vertical é ajustada pelo pipeline para 1080×1920, sem distorção. Não foi enviada requisição real ao provider.

Imagens horizontais existentes podem ser usadas diretamente na saída vertical:

| Modo | Resultado |
| --- | --- |
| CONTAIN | Imagem inteira com faixas |
| COVER | Crop que preenche o quadro, com ponto focal e zoom |
| BLURRED_BACKGROUND | Imagem inteira sobre fundo ampliado e desfocado |

Em COVER, Sharp calcula o retângulo de crop na imagem normalizada e limita suas coordenadas ao tamanho da fonte. O frontend oferece posição horizontal/vertical, zoom, centralização e restauração. Uma prévia em canvas reproduz a geometria de crop; a prévia animada usa o renderizador existente. Nenhum desses ajustes chama IA.

As configurações visuais são guardadas por orientação. Os assets selecionados continuam sendo compartilhados no mesmo projeto; escolher outro formato não gera imagens, áudio ou narração automaticamente.

## Movimentos, transições, timeline e áudio

São reutilizados STATIC, SLOW_ZOOM_IN, SLOW_ZOOM_OUT, PAN_LEFT, PAN_RIGHT, PAN_UP e PAN_DOWN. O ponto focal determina a imagem preparada, e zoompan usa a resolução e o FPS do snapshot. O movimento permanece limitado à imagem preparada. CONTAIN e BLURRED_BACKGROUND mantêm o primeiro plano estático, como na etapa 4, para preservar a imagem inteira.

CUT, FADE e CROSSFADE continuam no mesmo grafo. A duração permanece baseada nos áudios reais e na pausa existente. Não há aceleração de narração nem remoção de cenas para atingir uma duração planejada. Divergências relevantes entre duração real e planejada são exibidas na montagem.

A mixagem continua usando AudioTimelineBuilder e AudioMixService: narração, música, loop, ducking, fades e efeitos conservam seus tempos. O FFprobe valida resolução do snapshot, FPS, codecs H.264/AAC, pixel format, duração e pixels quadrados.

## Legendas

ASS usa as dimensões reais e escala fonte/contorno/sombra pela menor dimensão, evitando letras excessivamente grandes em 9:16. A largura disponível orienta a quebra de linhas. Foram acrescentadas margem horizontal e áreas seguras superior/inferior configuráveis, além de BOLD_SHORTS. CLASSIC e DYNAMIC continuam disponíveis; destaque por palavra usa somente os timestamps existentes.

Há prévia aproximada de legenda vertical no navegador e apresentação por formato na montagem. Nenhum alinhamento pago é iniciado ao trocar formato ou estilo. Segmentos excessivamente longos continuam exigindo divisão manual ou ajuste de fonte; não são criados timestamps fictícios.

A prévia animada de câmera continua silenciosa, acelerada e sem legendas, conforme o fluxo anterior. Para conferir sincronização e composição completas, use o player do MP4 final; a prévia de estilo das legendas é separada.

## Projetos derivados e roteiros curtos

Os fluxos são distintos:

1. **Versão vertical:** selecione 9:16 na montagem, ajuste e salve a edição, gere prévia ou novo MP4. Mantém roteiro, cenas, narração e duração; versões antigas permanecem no histórico.
2. **Versão curta:** abra “Criar versão curta independente”, escolha a duração e confirme a adaptação com IA. O servidor gera um roteiro editável em outro projeto, mantendo `sourceProjectId`. O original não é alterado. O derivado precisa passar por revisão, aprovação, cenas e produção próprias.

O prompt de roteiro para metas de até 90 segundos pede gancho honesto, contexto breve, desenvolvimento conectado e desfecho, com extensão proporcional à duração. Isso não força cortes ou tempos artificiais.

A resposta de adaptação é validada antes da criação do derivado. Falhas do provider não deixam um derivado incompleto nem modificam o projeto original. A narração e os assets do original não são copiados automaticamente para novas cenas, evitando associações incorretas. Reaproveitamento de imagens entre orientações ocorre no mesmo projeto; no derivado, o usuário pode enviar imagens existentes ou gerar outras explicitamente.

## Preparação para publicação

O seletor de destino possui YouTube tradicional, YouTube Shorts e Instagram Reels. Cada destino mantém descrição, títulos, hashtags, tags, vídeo selecionado, capa, capítulos, revisão e status próprios. Sugestões usam o destino no prompt e têm histórico separado. Capas e vídeos existentes podem ser compartilhados sem duplicar geração.

A composição existente exporta JPEG horizontal 1280×720 ou capa vertical 720×1280, abaixo de 2 MiB. Upload, texto, versões imutáveis e download continuam no mesmo serviço. A seleção ou envio efetivo de capa depende da plataforma/aplicativo e não é prometida pela preparação.

O checklist exige saída vertical para os destinos verticais. Para Shorts, verifica duração real de até 180 segundos, conforme a documentação oficial consultada em 19/10/2026. Isso não garante classificação, aceitação ou ausência de restrições de direitos autorais. As páginas do Instagram consultadas retornaram HTTP 429; por isso, limites de duração/caption do Instagram não foram codificados como universais: a interface pede confirmação no aplicativo. O checklist do Reels valida formato, arquivos e preparação local.

## Frontend e endpoints

Foram adaptados os componentes existentes, sem substituir a tela ou o renderizador: ProjectConfiguration, ContentProjectCreation, VideoEditingControls, VideoProduction, SubtitleProduction e PublicationPreparation. SceneFramingPreview é a nova prévia local de crop.

Players e histórico usam a proporção do snapshot. Players verticais têm largura máxima de 400 pixels no desktop e preservam a proporção no celular. O histórico permite assistir e baixar ambos os formatos.

Endpoints reutilizados:

- `GET/PATCH /content-projects/:projectId/render-settings`: formato, variantes visuais e apresentação das legendas.
- `GET /content-projects/:projectId/timeline`, `POST .../render-preview`, `POST .../renders`: a mesma pipeline para as duas orientações.
- `POST /content-projects/:id/create-short-version`: novo endpoint explícito com revisão, confirmação e duração.
- `GET/PATCH .../publication?target=YOUTUBE_VIDEO|YOUTUBE_SHORTS|INSTAGRAM_REELS`.
- `POST .../publication/generate|chapters|validate?target=...`.
- Upload/composição de capas reutilizam os endpoints existentes; `overlay.aspectRatio` define a proporção.

## Segurança, custos e desempenho

A chave local e o proprietário configurados no servidor continuam protegendo projetos, assets e RenderJobs. Identificadores são UUIDs; cenas de todas as variantes são verificadas contra o projeto. Destinos e formatos são enumerados; ponto focal/zoom/margens têm limites; caminhos arbitrários não são aceitos. FFmpeg continua recebendo argumentos separados, sem interpolação em shell.

Revisões otimistas e locks existentes previnem gravações concorrentes e operações duplicadas. Troca de formato, enquadramento, preview e composição local não usam APIs pagas. Adaptação de roteiro e novas imagens exigem ações explícitas; a interface informa consumo potencial. O provider e os registros de uso existentes são reutilizados.

Não foram aumentadas concorrência, threads ou memória permitida. A preparação e as cenas continuam sequenciais dentro de cada job, com limpeza de temporários, limites de duração/arquivo, timeout e verificação de espaço. Foram validadas fixtures curtas reais; não foi executado benchmark de vídeos longos em produção.

## Arquivos principais

| Área | Arquivos |
| --- | --- |
| Formatos e renderização | `api/src/video-render/video-formats.ts`, `render-settings.ts`, `editing-settings.ts`, `timeline.builder.ts`, `render-job.ts`, `ffmpeg.renderer.ts`, `video-render.service.ts` |
| Projetos/roteiros | `api/src/content-projects/content-project.schema.ts`, `content-project.service.ts`, `content-project.controller.ts`, `api/src/ai/content-generation/prompts/content-project.prompt.ts` |
| Imagens | `api/src/content-assets/content-assets.service.ts`, `scene-image-prompt.builder.ts` |
| Legendas | `api/src/content-subtitles/subtitle.schema.ts`, `subtitle.formats.ts` |
| Publicação | `api/src/content-publication/publication.schema.ts`, `publication.repository.ts`, `publication.service.ts`, `publication.controller.ts`, `publication-thumbnail.service.ts` |
| Banco/scripts | `api/migrations/012_content_vertical.sql`, `api/scripts/migrate-assets.cjs`, `api/package.json` |
| Interface | `frontend/src/pages/ContentCreation/ContentProjectCreation.jsx`, componentes ProjectConfiguration, VideoEditingControls, SceneFramingPreview, VideoProduction, SubtitleProduction, PublicationPreparation |
| Contratos | `frontend/src/services/contentProjectService.js`, `publicationService.js`, `frontend/src/types/contentProject.d.ts` |
| Testes | `vertical.spec.ts`, testes de timeline/projetos/assets, `api/test/content/vertical.integration.cjs`, integração/browser de publicação, `frontend/test/vertical.test.mjs` |

## Validação e evidências

Resultados dos comandos efetivamente executados e suas evidências: As imagens e respostas de texto das integrações foram simuladas; os testes de FFmpeg, FFprobe, Sharp, HTTP, PostgreSQL e Chrome foram reais. Nenhuma API paga foi consumida.

- Backend: build Nest, TypeScript e lint dos arquivos alterados.
- Suíte Jest completa: 45 suítes / 373 testes.
- Frontend: build Vite, lint, TypeScript dos contratos e 69 testes, incluindo o novo arquivo vertical.
- PostgreSQL/Nest/Sharp/Chrome: migration idempotente, autenticação, proprietário, rascunhos independentes, capa vertical, derivado independente, revisão, erros e preservação do original.
- Chrome: login, navegação, edição/salvamento/reabertura, READY, imagens reais, download e layout em 1440/768/390 pixels.
- FFmpeg: MP4 real horizontal 1920×1080 e vertical 1080×1920, 30 FPS, H.264/AAC. Sete movimentos, três fits, três pontos focais e três transições verticais. Verificação de narração por frequência, efeito em 2,4 s, música até o final e legenda na área segura. Os cenários extensivos usam 180×320 para reduzir custo computacional; os dois exports Full HD têm dois segundos.
- Snapshot legado sem formato continua horizontal. Temporários foram removidos pelo renderizador.

Evidências reais da versão final do renderizador: `/tmp/trends-vertical-IacuMX/evidence.json`, `vertical-full-hd.mp4`, `horizontal-full-hd.mp4`, `vertical-subtitles.png`. Integração completa: `/tmp/trends-publication-0IpeAr/evidence.json` e `publication-ui.png`.

## Limitações e próximos passos

- Aplicar a migration no banco de desenvolvimento quando ele estiver disponível e reiniciar a API.
- Testar qualidade editorial e consistência visual com o provider real somente mediante geração explícita; essas características não foram certificadas por mocks.
- Preview de crop/legendas no navegador é aproximado; o MP4 renderizado é a referência final.
- Sem reconhecimento automático de rosto/objetos e sem remapeamento automático de imagens do projeto longo para novas cenas curtas.
- Regras e disponibilidade de capas do destino devem ser conferidas no fluxo de publicação. A etapa não publica, agenda ou garante elegibilidade de conta/conteúdo.
- A futura etapa de publicação poderá integrar OAuth/upload e validação específica do fluxo de cada plataforma, mantendo os RenderJobs e rascunhos já persistidos.

Fontes oficiais consultadas: [dimensões flexíveis de GPT Image 2/2.5](https://developers.openai.com/api/reference/resources/images/methods/generate), [regras de Shorts de até três minutos](https://support.google.com/youtube/answer/15424877?hl=en). As páginas `help.instagram.com/1038071743007909` e `help.instagram.com/225190788256708` retornaram 429 na consulta.
