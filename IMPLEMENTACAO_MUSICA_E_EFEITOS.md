# ETAPA 5 — Música de fundo, efeitos e mixagem automática

Produção agora permite enviar MP3/WAV, selecionar uma música, definir volume/fades/loop/ducking e associar efeitos às cenas. O renderizador FFmpeg existente gera MP4 com áudio mixado, preservando o histórico e as configurações usadas em cada versão. Não há geração de música por IA ou chamadas pagas nesta etapa.

## Uso

A migration `008_project_audio_mix.sql` foi aplicada ao banco local com `npm run migrate:audio-mix`. Reinicie a API existente e o frontend; não inicie outra API na porta já ocupada.

Abra um projeto em Produção. Envie música e efeitos; opcionalmente informe origem, licença e observações antes do upload. Selecione a música, ajuste o ganho/fades e as opções de loop/ducking. Adicione efeitos nas cenas, escolha arquivos e ajuste offset/volume. Clique em **Salvar mixagem** e depois em **Gerar vídeo**. Upload não seleciona música nem associa efeitos automaticamente. O preview individual não simula o resultado final. Alterações não salvas bloqueiam o botão de gerar vídeo.

Para retirar a música, selecione “Sem música” ou clique em “Remover música” e salve. Efeitos podem ser desativados ou removidos da configuração. Os arquivos originais e vídeos anteriores permanecem no storage.

## 1. Diagnóstico existente

NestJS + PostgreSQL com SQL direto, React/Vite e StorageProvider local. Etapas anteriores fornecem projetos, cenas, imagens, narrações com duração real, TimelineBuilder, FfmpegRenderer, MediaProcess, snapshots, jobs persistentes, cancelamento, histórico e streaming de MP4. Não havia música, efeitos ou configuração de mixagem. Não há autenticação/ownership nem Redis/BullMQ; o worker de vídeo tem exclusividade por banco e concorrência limitada. Essas características foram preservadas.

## 2. Arquitetura escolhida

ProjectAudioService valida uploads/configurações e reutiliza os repositories, AudioFileValidator, StorageProvider e MediaProcess. ProjectAudioRepository persiste uma configuração por projeto. AudioTimelineBuilder deriva a timeline sonora da timeline efetiva do vídeo. AudioMixService constrói os filtros/inputs; FfmpegRenderer os executa dentro do job atual. Nenhum segundo renderizador ou novo tipo de RenderJob foi criado.

## 3. Assets de música e efeitos

Continuam sendo ContentAsset `type=AUDIO`, `source=USER_UPLOAD`, `status=READY`, `usage=OPTIONAL`. `metadata.audioRole` diferencia BACKGROUND_MUSIC e SOUND_EFFECT; ausência desse campo mantém o significado NARRATION para assets antigos. A biblioteca usa assets sem sceneId, permitindo reutilizar um efeito em várias cenas sem duplicar arquivo.

Metadados: MIME, duração medida, codec, sample rate, canais, key imutável, originalName sanitizado, bytes, origem, licença e observações informadas. Upload valida assinatura real, extensão/MIME, parser de duração, FFprobe e decodificação completa com FFmpeg. Inicialmente MP3 e WAV PCM, até 20 MiB/600 s, até dois canais. M4A não foi habilitado para uploads. Música/efeitos não aparecem nas versões ou seleções de narração.

## 4. Configurações de áudio

Uma linha em `content_project_audio` guarda settings JSONB, sem duplicar tabelas de arquivos. Schema Zod centraliza defaults e validação.

| Configuração | Padrão / limites |
| --- | --- |
| Música | Opcional, um asset por projeto |
| Ganho da música | 0,15 / de 0 a 0,5 (0–50%) |
| Fade-in / fade-out | 2 s / 3 s; cada um de 0 a 30 s |
| Loop | Ativado |
| Ducking | Ativado |
| Ganho de efeito | 0,25 / de 0 a 1 (0–100%) |
| Offset | Não negativo, relativo à cena; menor que sua duração real |
| Efeitos | Até 32 no projeto, 8 por cena; IDs únicos |
| Scope | SCENE; continuidade para outra cena não implementada |

Salvamento exige a revisão atual, usa o mesmo bloqueio por projeto e grava configuração + incremento de revisão em transação. Não altera texto, seleções ou configuração de TTS. Arquivos enviados permanecem disponíveis depois de fechar/reabrir.

## 5. Alterações na timeline

TimelineBuilder mantém duração da narração + padding e os timestamps alinhados a frames. VideoRenderService carrega configurações sob o bloqueio do projeto e incorpora o resultado de AudioTimelineBuilder. Música/efeitos não modificam a duração das cenas. Ganhos, fades, referências, roles e durações são validados; referências explicitamente escolhidas e inválidas bloqueiam a geração.

## 6. Alterações no FfmpegRenderer

Prepara cópias locais únicas dos assets musicais/efeitos e verifica seus arquivos/durações. Mantém os segmentos H.264/PCM e a timeline anteriores. Quando há fontes adicionais, renderiza primeiro a mixagem em WAV PCM temporário; depois copia o vídeo dos segmentos e codifica o áudio mixado em AAC no MP4 final. Sem fontes adicionais, mantém o caminho anterior de narração.

A mixagem é validada como áudio completo antes de copiar o vídeo. O loop usa filtro de áudio em vez de seek do demuxer, pois testes repetidos detectaram interrupção prematura com a estratégia inicial. A etapa de áudio tem duração validada antes do mux; o MP4 verifica também duração do stream de áudio. Todos os subprocessos respeitam timeout/cancelamento, progressos e diretório temporário do job.

## 7. Estratégia de mixagem

A narração dos segmentos é a base. Música e efeitos são reamostrados para 48 kHz/estéreo e processados com ganhos próprios. `amix` soma as fontes com `normalize=0` e duração da narração. A saída passa por `alimiter`, sem auto-level, com compensação de latência e teto linear 0,85; depois é limitada à duração final. AAC é codificado uma única vez. O arquivo mixado temporário é removido com os demais temporários.

## 8. Volume

Percentuais representam ganho linear relativo, não proporção perceptiva garantida. Voz mantém seu ganho principal e a normalização já existente, configurável por VIDEO_RENDER_NORMALIZE_AUDIO. Música e efeitos não recebem loudnorm individual que anularia os ganhos definidos pelo usuário. Não há controle de ganho de voz novo nesta etapa. Defaults conservadores e ducking favorecem a narração; escolhas extremas e fontes muito diferentes ainda precisam de avaliação auditiva.

## 9. Fades

Fades aplicados exclusivamente à música. A soma de fade-in e fade-out não pode ultrapassar a duração efetivamente disponível: duração total do vídeo com loop; menor entre música/vídeo sem loop. Música longa é cortada no fim do vídeo. Sem loop, música curta recebe fade no seu próprio fim e silêncio depois. Efeitos recebem rampas curtas de até 10 ms para suavizar início e truncamento; a voz não recebe esses fades.

## 10. Loop

FFmpeg usa `aloop`, sem gerar cópias físicas repetidas do arquivo. O buffer é PCM de 16 bits/48 kHz/estéreo e limitado à duração da faixa, de até 600 s (aproximadamente 110 MiB de áudio no limite máximo por job). Timestamps da música são recalculados pelo número de amostras, e `atrim` corta na duração efetiva. Loop pode ser desativado; nesse caso, o resto do vídeo conserva voz/efeitos. Não há crossfade entre as emendas do arquivo musical; uma fonte com bordas abruptas pode produzir junções audíveis.

## 11. Ducking

Implementado realmente via sidechaincompress: voz dividida em caminho principal e sidechain; somente a música é comprimida. Threshold 0,03, ratio 6, attack 20 ms, release 350 ms, makeup 1. Opção “Reduzir música durante narração” ativada por padrão; pode ser desativada. Efeitos e voz principal não passam por esse compressor.

## 12. Posicionamento de efeitos

Cada associação tem UUID, sceneId, assetId, startOffsetSeconds, volume, enabled e scope=SCENE. Início absoluto = início efetivo da cena + offset. Duração utilizada = menor entre duração do arquivo e tempo restante da cena. O filtro atrim impede invasão da próxima cena; adelay posiciona em amostras, com o mesmo atraso nos canais. O mesmo arquivo é copiado apenas uma vez por job mesmo quando usado em várias associações.

Efeitos em cenas removidas são identificados; a interface oferece removê-los. Uma referência inválida não é silenciosamente descartada. Efeitos desativados permanecem na configuração, mas não entram no grafo.

## 13. Snapshot do RenderJob

Campo opcional audioMix preserva compatibilidade com jobs antigos. Inclui settings completos, música selecionada com key/MIME/duração/metadados e efeitos ativos com IDs, ganho, offsets relativos/absolutos, duração original e duração truncada. Mudanças após iniciar o job não alteram esse snapshot. Cada nova execução registra sua própria configuração; saídas anteriores continuam disponíveis.

## 14. Endpoints

Prefixo `/content-projects/:projectId`.

| Método | Caminho | Uso |
| --- | --- | --- |
| POST | `/music/upload` | Multipart file/revision e license/origin/notes opcionais |
| POST | `/sound-effects/upload` | Mesmo formato para efeito |
| GET | `/audio-settings` | Projeto/revisão, configuração, assets de biblioteca e limites |
| PATCH | `/audio-settings` | `{ revision, settings }`, substituição completa da configuração |
| GET | `/audio-library/:assetId/file` | Preview por streaming e Range (206/416) |

Inclusão/edição/remoção de associações usa o array de efeitos no PATCH único, com revisão e transação. Rotas de timeline/renders/player/download anteriores permanecem. Preview da biblioteca usa streams, sem ler o arquivo inteiro em Buffer. Multipart permanece limitado a 20 MiB em memória, reutilizando a infraestrutura de upload anterior.

## 15. Migration

`008_project_audio_mix.sql` cria `content_project_audio` com FK de projeto, settings JSONB e updated_at. É aditiva e repetível, sem apagar/reescrever assets ou vídeos. Runner `scripts/migrate-assets.cjs` inclui 008 no journal existente. Novo comando `npm run migrate:audio-mix`; migrate:renders também aplica a cadeia completa. Aplicada ao banco local; repetição do runner com vídeos/configurações existentes testada em banco descartável.

## 16. Backend criado/alterado

Criados `api/src/content-audio/`: project-audio.schema.ts, project-audio.repository.ts, project-audio.service.ts, project-audio.controller.ts, audio-timeline.builder.ts, audio-mix.service.ts e dois arquivos de testes. Criados migration 008 e `api/test/content/audio-mix.integration.cjs`.

Alterados ContentAssetsModule, ContentAssetRepository (URLs de preview), ContentNarrationService (isolamento de papéis), TimelineBuilder, RenderSnapshot, VideoRenderService, FfmpegRenderer, package.json e migration runner. Sem novas dependências externas.

## 17. Frontend criado/alterado

Criados AudioMixProduction.jsx, projectAudioService.js e audioMix.test.mjs. Alterados VisualProduction.jsx, VideoProduction.jsx, NarrationProduction.jsx e contentProject.d.ts. Tema dark preservado, controles simples e players HTML5 existentes. A tela mostra metadados, ganho, fades, loop, ducking, efeitos por cena, salvamento explícito e resumo da mixagem salva. Histórico informa música/quantidade de efeitos de cada versão. Rascunho não é descartado por alteração de revisão de outros controles do projeto.

## 18. Testes

Backend: 35 suites e 237 testes aprovados, incluindo 34 novos testes de timeline sonora, configuração, ganhos/fades/loop/ducking, fontes opcionais, snapshot, associações, upload, revisão, falhas e streaming. Frontend: 48 testes aprovados.

Integração nova: uploads WAV/MP3, MIME/extensão/conteúdo inválidos, licença/origem, assets estrangeiros, revisão antiga, configuração persistida, offsets/truncamento, snapshot durante alterações, streaming/Range, loop, fades, ducking, efeito no instante correto, sequência de voz, análise de clipping, segunda versão sem loop, histórico, arquivo ausente, limpeza e migrations repetidas.

Chrome: upload de música/efeito, licença, preview, seleção, ganho/offset, bloqueio com rascunho, salvamento, render real/player/download, nova versão com ganho diferente, reabertura/configuração/histórico, remoção de efeito e layouts 1440/768/390. Regressão da narração passou em PostgreSQL/HTTP e Chrome; render sem música/efeitos passou nos testes reais existentes. Nenhuma chamada a API paga.

## 19. Build/lint

Backend Nest/TypeScript e ESLint aprovados. Frontend Vite/ESLint e contratos .d.ts com tsc --noEmit aprovados. Frontend da aplicação continua em JavaScript/JSX. git diff --check sem problemas.

## 20. Teste real de mixagem

Três cenas de 5 s, total 15 s no teste com padding zero. Narração com tons distintos e intervalos de silêncio; música de 6 s, efeito de 1 s no instante 5 s e outra associação truncada no fim da cena. MP4 1920 × 1080, 30 FPS, H.264/yuv420p, AAC/48 kHz/estéreo. Arquivo: `/tmp/trends-audio-mix.mp4`; screenshot: `/tmp/trends-audio-mix-production.png`.

O teste decodifica um canal original e mede componentes do sinal: voz nas cenas corretas, efeito presente na janela prevista e ausente antes/depois, música após a emenda do loop, redução durante a voz e fades inicial/final. A música deve permanecer audível também nos últimos instantes do fade; retorno zero do FFmpeg sozinho não é suficiente. Também soma fontes fortes para forçar a atuação do limiter e verifica o pico após codificação AAC. A segunda versão sem loop deve ficar sem música depois de 6 s, mantendo voz/efeito e a primeira versão intacta.

Medições do MP4 final: 577925 bytes; componente musical de 0,04308 em intervalo sem voz e 0,01008 durante voz (redução aproximada de 4,3×); componente do efeito de 0,12083 na janela prevista e abaixo de 0,000002 antes/depois; pico por canal de 0,31579 e zero amostras com clipping. O fade final conserva música até sua última janela medida (componente 0,00215). No teste de fontes fortes, o pico AAC após limiter foi 0,87557, abaixo de full scale. O loop foi também verificado em oito execuções consecutivas com resultado idêntico no trecho final.

Os artefatos são de testes com mídia controlada; não certificam qualidade perceptiva/ editorial de todas as músicas ou narrações reais. Banco de teste é descartável; assets dos projetos reais usam storage persistente configurado.

## 21. Limitações

Não há autenticação/ownership no projeto: rotas exigem associação projeto/asset/job, mas isso não autoriza usuários diferentes. Não expor como serviço multiusuário privado sem implementar autenticação. Sem M4A em upload, biblioteca externa, geração musical/efeitos por IA, múltiplas músicas simultâneas, editor avançado, keyframes, legendas ou masterização profissional. Não há paginação, exclusão física ou política de retenção da biblioteca; remover uma seleção não apaga o arquivo.

Limites de upload, efeitos, duração, timeout, concorrência e tamanho continuam válidos; não são quotas rígidas de RAM/CPU/disco de container. A validação completa de upload pode ocupar a requisição por até o timeout de mídia; a renderização permanece assíncrona. Licença é apenas informação do usuário; o sistema não verifica copyright ou concede direitos. Loop sem crossfade pode ter emendas perceptíveis. A mixagem usa um arquivo PCM temporário adicional, aumentando o uso de disco durante o render; o loop guarda a faixa em um buffer PCM limitado, aumentando a memória do FFmpeg em até aproximadamente 110 MiB por job no caso máximo.

## 22. Próximos passos

Avaliar a mixagem com projetos reais e ajustar defaults conservadores conforme o conteúdo. Implementar autenticação/ownership antes de uso privado multiusuário. Medir recursos com muitas cenas/efeitos e definir retenção/backup. Avaliar crossfade das emendas musicais e controles de ducking em etapa futura, com novos testes de sinal. Legendas e geração de mídia adicional continuam fora desta entrega.

## Validação reproduzível

```sh
cd api
npm run migrate:audio-mix
npm run build
node node_modules/eslint/bin/eslint.js 'src/**/*.ts' 'trends/**/*.ts'
node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:audio-mix:integration
```

Integração requer PostgreSQL descartável com CREATE DATABASE e Google Chrome. Usa portas 33652–33654 e cria/remove um banco isolado. Não apontar o teste ao banco operacional.

```sh
cd frontend
npm run build
npm run lint
npm test
```

Filtros e compensação de latência foram conferidos na [documentação oficial do FFmpeg](https://ffmpeg.org/ffmpeg-filters.html). Os testes reais validam os binários instalados no projeto.
