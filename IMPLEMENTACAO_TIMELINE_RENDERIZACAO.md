# ETAPA 4 — Timeline e renderização automática de vídeos

Implementado o fluxo Produção → timeline → job persistente → FFmpeg → MP4 → player/download/histórico. A renderização usa os assets selecionados; não chama a OpenAI. Os testes utilizam imagens e áudios locais controlados, sem gerar mídia paga.

## Como usar

A migration foi aplicada ao banco local com `npm run migrate:renders`. Reinicie a API existente e o frontend. Evite iniciar uma segunda API na mesma porta.

Abra um projeto com cenas aprovadas, selecione uma imagem e uma narração para cada cena e entre em Produção. Confira “Montagem do vídeo”, a timeline e os avisos. Clique em “Gerar vídeo”. O processamento continua se a página for fechada. Ao concluir, reproduza ou baixe o MP4. “Gerar nova versão do vídeo” conserva os vídeos anteriores.

Configuração e limites ficam no backend, em `api/.env`, usando `api/.env.example` como referência. Não é possível enviar opções arbitrárias do FFmpeg pelo navegador. FFmpeg e FFprobe vêm nas dependências instaladas; `FFMPEG_PATH` e `FFPROBE_PATH` permitem usar executáveis externos compatíveis. A instalação dessas dependências precisa de rede para baixar os binários.

## 1. Diagnóstico da arquitetura existente

Backend NestJS, PostgreSQL com SQL direto e frontend React/Vite. Reutilizados ContentProjectRepository, ContentAssetRepository, NarrationRepository, StorageProvider/LocalStorageProvider e as seleções persistidas de imagens/narrações. O projeto já tem revisão, bloqueio por projeto, fingerprints e filas de imagem/TTS. Não havia timeline, fila de vídeo, FFmpeg, MP4 ou streaming de vídeo. Não existe autenticação, tabela de usuários ou ownership. O Docker Compose existente fornece PostgreSQL; a API roda como processo Node, sem limites de memória/CPU de container. FFmpeg/FFprobe não estavam disponíveis no PATH antes desta etapa.

## 2. Estratégia de renderização

Cada cena vira um segmento Matroska com imagem animada em H.264 e áudio PCM sem perdas. O concat demuxer une os segmentos, copia o vídeo e codifica áudio AAC uma única vez. O MP4 final usa `+faststart`. Isso evita acumular o atraso inicial de AAC entre cenas. FFprobe valida as características do arquivo antes do registro como asset READY.

## 3. TimelineBuilder

Ordena cenas, exige ordens consecutivas e IDs únicos, valida aprovação e dependências atuais, carrega as seleções e gera snapshot. Valida projeto de origem, status READY, MIME, duração, fingerprints e confirmação explícita de versões antigas. Imagens do mesmo projeto podem ser reutilizadas quando explicitamente selecionadas, conforme o comportamento anterior; narração deve pertencer à cena. Retorna problemas por cena sem iniciar renderização.

Cada cena contém IDs/keys dos assets, MIME, duração real do áudio, quantidade de frames, início/fim/duração e motion preset. Duração de cena = `ceil((duração do áudio + padding) × FPS) / FPS`; timestamps derivam da soma de frames inteiros.

## 4. VideoRenderService

Coordena validação, construção da timeline, checagem de arquivos/executáveis, criação do job, fila, progresso, cancelamento, armazenamento e conclusão. Exige a revisão atual. Um bloqueio por projeto e um índice único impedem jobs ativos duplicados. O controller não executa FFmpeg nem espera a renderização terminar.

## 5. FfmpegRenderer

Prepara arquivos locais isolados, decodifica/normaliza imagens com Sharp, verifica os áudios com FFprobe, gera segmentos, concatena, valida o MP4 e entrega o arquivo ao storage. MediaProcess executa subprocessos com `spawn`, lista de argumentos e `shell: false`, whitelist de protocolos locais, stdout/stderr limitados, timeout e sinais de cancelamento. Detalhes técnicos de erros ficam no log; mensagens públicas orientam o usuário.

## 6. Processamento assíncrono

POST retorna HTTP 202 com job QUEUED. Worker em processo consulta PostgreSQL, com claim atômico e `SKIP LOCKED`. Um advisory lock limita a operação a uma API worker por banco. Concorrência configurável de 1 a 2 vídeos, padrão 1; cada job processa suas cenas sequencialmente. Progresso vem de `-progress pipe:1`/`out_time_us`, ponderado por duração, com faixas de preparação/finalização; 100% exige conclusão persistida.

Jobs QUEUED sobrevivem ao reinício e são retomados. PREPARING/RENDERING/FINALIZING interrompidos tornam-se FAILED, ou CANCELLED se o cancelamento estava solicitado. Não há retomada parcial de uma cena: gere uma nova versão. O frontend consulta estado a cada 2 segundos; não aciona geração no GET.

## 7. Modelagem de RenderJob

Tabela `content_video_renders`: UUID, project_id, status, progress, snapshot JSONB, output_asset_id, error, cancel_requested, created_at, started_at, completed_at e render_duration_seconds. Estados: QUEUED, PREPARING, RENDERING, FINALIZING, COMPLETED, FAILED, CANCELLED. A duração do processamento é distinta da duração da mídia. FK composta impede associar output de outro projeto.

## 8. Snapshot

Persistido ao criar o job: revisão/título, configuração completa, ordem das cenas, assets selecionados e respectivos arquivos, durações e movimentos. Alterar seleções ou configurações depois não modifica uma renderização em andamento nem versões anteriores. As keys de assets são imutáveis. O teste removeu uma seleção durante o render e o snapshot permaneceu válido.

## 9. Configurações de vídeo

| Opção | Padrão |
| --- | --- |
| Resolução | 1920 × 1080, 16:9 |
| FPS | 30 |
| Vídeo | libx264 / H.264, yuv420p |
| Qualidade/velocidade | CRF 23, preset veryfast |
| Áudio | AAC, 192 kb/s, 48 kHz, estéreo |
| Padding por cena | 300 ms |
| Movimento/normalização | Ativados |
| Transição | CUT |
| Concorrência/threads | 1 job / 2 threads de encoder |
| Capacidade da fila | 20 jobs ativos ou pendentes |
| Duração máxima | 1800 segundos |
| Timeout de processamento | 1800000 ms |
| Espaço livre mínimo inicial | 1024 MiB |
| Limite por arquivo de saída | 2048 MiB |

Configurações inválidas falham na inicialização. Resoluções devem ser pares, 16:9 e até 1080p; FPS entre 24 e 30, CRF entre 18 e 30. Para reduzir consumo, use por exemplo `VIDEO_RENDER_WIDTH=1280`, `VIDEO_RENDER_HEIGHT=720`, `VIDEO_RENDER_FPS=24`, mantendo ambos width/height consistentes. `VIDEO_RENDER_MOTION=false` desativa a animação. Não há custo de API no render; há consumo de CPU, disco e armazenamento.

## 10. Animação das imagens

Alternância determinística de zoom in, pan right, zoom out e pan left. Zoom máximo suave de aproximadamente 5%, calculado pelo número de frames. Antes da animação, resize com contain preserva a proporção e usa barras pretas quando necessário, evitando distorcer a imagem. Não há aleatoriedade ou promessa de enquadramento editorial perfeito.

## 11. Transições

CUT: troca direta entre cenas, sem overlap. Portanto a duração total é a soma das durações de cena. Crossfade/dissolve ficaram fora deste MVP, para preservar sincronização e evitar somas incorretas de duração.

## 12. Sincronização de áudio

Usa a duração medida do asset e confirma a duração física com FFprobe durante a preparação. Divergência acima de 150 ms bloqueia o job. Áudio começa no início da cena; apad/atrim complementam o silêncio até a duração alinhada a frames. Segmentos PCM e codificação AAC única evitam deriva nas fronteiras. O teste real verifica tons diferentes nas três cenas para conferir a sequência sonora.

## 13. Normalização de áudio

Filtro loudnorm por cena, alvo I=-16 LUFS, true peak=-1.5 dBTP, LRA=11; saída reamostrada para 48 kHz/estéreo. Pode ser desativado por `VIDEO_RENDER_NORMALIZE_AUDIO=false`. É normalização de uma passagem, sem análise/ajuste editorial de volume entre falas.

## 14. Armazenamento

StorageProvider ganhou suporte opcional a stat, cópia para arquivo, saveFile e openRead. LocalStorageProvider usa criação exclusiva e pipelines de arquivos para MP4, sem carregar o vídeo inteiro em Buffer. Key final: `content-projects/{projectId}/renders/{renderId}/{assetId}.mp4`. Asset VIDEO/RENDERED/READY guarda duração, resolução e metadata de render. Registro do asset e conclusão do job ocorrem na mesma transação.

Temporários ficam em `VIDEO_RENDER_TEMP_DIR/render-{jobId}-{suffix}` e são removidos após sucesso, erro ou cancelamento. Na inicialização, diretórios próprios de jobs interrompidos são limpos. Uma falha de persistência remove o arquivo final órfão quando possível. Preserve e faça backup do storage e do PostgreSQL juntos.

## 15. Histórico de renderizações

Cada execução recebe UUID e output próprios. Histórico por projeto, mais recente primeiro; inclui falhas e cancelamentos. Player e download de versões concluídas continuam disponíveis ao gerar outras versões e ao reabrir a página. Nenhuma versão anterior é sobrescrita.

## 16. Endpoints implementados

Prefixo: `/content-projects/:projectId`.

| Método | Caminho | Comportamento |
| --- | --- | --- |
| GET | `/timeline` | Timeline, pendências e readiness |
| POST | `/renders` | `{ revision }`, cria job, HTTP 202 |
| GET | `/renders` | Histórico e configuração |
| GET | `/renders/:renderId` | Estado e progresso |
| POST | `/renders/:renderId/cancel` | Cancelamento persistido; interrompe subprocesso ativo |
| GET | `/renders/:renderId/video` | Streaming inline para player |
| GET | `/renders/:renderId/download` | Streaming com attachment |

Streaming aceita Range único, inclusive sufixo, com 206/416 e Content-Length; MP4 não passa pelo endpoint antigo que lê assets em Buffer. Todos os IDs de rota são UUIDs e as consultas exigem a associação projeto/job/asset. Isso não substitui autenticação de usuários.

## 17. Migrations

Nova `007_video_renders.sql`: amplia assets para VIDEO/RENDERED, adapta a constraint READY, cria jobs, FK, índices de histórico e unicidade de job ativo. Não apaga dados existentes. Runner `scripts/migrate-assets.cjs` ganhou journal `content_schema_migrations`, advisory lock e adoção de schemas anteriores já instalados. Isso impede reaplicar constraints antigas IMAGE/AUDIO depois de existirem vídeos. Os comandos migrate:assets, migrate:narration e migrate:renders usam o mesmo runner.

Migration aplicada no banco local. Repetição de SQL e duas execuções do runner com VIDEO existente foram verificadas no banco descartável.

## 18. Backend criado/alterado

Criados em `api/src/video-render/`: render-settings.ts, render-job.ts, timeline.builder.ts, render.repository.ts, video-render.service.ts, ffmpeg.renderer.ts, media-process.ts, video-render.controller.ts, external-tools.d.ts e três arquivos de testes. Criados `api/migrations/007_video_renders.sql` e `api/test/content/renders.integration.cjs`.

Alterados ContentAsset/type/repository/service/module, StorageProvider, LocalStorageProvider, migration runner, package.json/package-lock e .env.example. Dependências adicionadas: ffmpeg-static e ffprobe-static. Projeto/TTS/imagens reutilizam a infraestrutura anterior.

## 19. Frontend criado/alterado

Criados VideoProduction.jsx, videoRenderService.js e videoRenders.test.mjs. Alterados VisualProduction.jsx para integrar a montagem; NarrationProduction.jsx para atualizar o aviso de etapas futuras; contentProject.d.ts para VIDEO/RENDERED e os contratos de timeline/jobs/configuração. A tela mostra sequência, duração total, imagem/áudio selecionados, problemas por cena, ação bloqueada quando necessário, progresso, cancelamento, player e histórico/download.

## 20. Resultado dos testes

Backend: 33 suites / 203 testes aprovados; 28 verificam timeline, coordenação de vídeo, Range, configuração e subprocessos. Frontend: 41 testes aprovados. PostgreSQL/HTTP/FFmpeg: jobs reais, snapshot, duplicidade, revisão, arquivos ausentes/corrompidos, falhas de storage, cancelamento, isolamento por projeto, histórico, Range/download, migrations repetidas, recuperação após reinício e limpeza de temporários.

Chrome: geração real, reprodução com avanço de currentTime, download, nova versão e histórico depois de reabrir; layouts 1440/768/390 sem overflow. Regressões de imagens e TTS passaram nos respectivos testes PostgreSQL/HTTP e Chrome. Nenhum teste chamou a OpenAI.

## 21. Resultado de build/lint

Build Nest/TypeScript, ESLint backend, build Vite e ESLint frontend aprovados. Frontend é JavaScript/JSX; não há um build TypeScript da aplicação. Os contratos .d.ts foram conferidos com tsc --noEmit. git diff --check aprovado.

## 22. Teste real com FFmpeg

Executado com três cenas, PNGs de proporções diferentes e WAVs de 3, 4 e 5 segundos. Além de FFprobe, o MP4 foi totalmente decodificado pelo FFmpeg; frames em instantes diferentes confirmaram movimento, e amostras de áudio confirmaram sincronização por cena. Cabeçalho moov antes de mdat confirmou faststart. Reprodução real validada no Chrome.

## 23. MP4 gerado

Arquivo de conferência: `/tmp/trends-first-project-video.mp4`.

| Característica | Resultado |
| --- | --- |
| Duração | 12,9 s = 3,3 + 4,3 + 5,3 |
| Resolução / FPS | 1920 × 1080 / 30 |
| Vídeo | H.264, yuv420p |
| Áudio | AAC, estéreo, 48 kHz |
| Tamanho | 487623 bytes |
| Container / reprodução | MP4, faststart; decode e Chrome aprovados |

Screenshot de conferência: `/tmp/trends-render-production.png`. Esses arquivos são artefatos de teste locais; o banco dos testes é descartável. Projetos reais usam o storage configurado e conservam seus registros.

## 24. Limitações

Sem login/ownership: isolamento por projeto não garante autorização entre usuários; não expor este módulo como serviço multiusuário sem implementar autenticação. Uma API worker por banco; não há Redis/Bull nem distribuição horizontal. Render interrompido não continua do frame anterior. Não há música, legendas, crossfade, editor avançado, 4K ou geração de vídeo por IA. Histórico não tem paginação/retention automática nesta etapa.

Limites de threads, fila, duração, timeout, tamanho por arquivo e espaço inicial reduzem uso de recursos, mas não constituem quotas rígidas de CPU/RAM/disco agregado. A API existente não roda em container com cgroups. Remoção de arquivo órfão depende de storage acessível; cancelamento pode aguardar uma operação de arquivo/Sharp já iniciada antes de concluir a limpeza. Timeout controla o processamento de mídia, não uma indisponibilidade indefinida de um futuro storage remoto. O teste real não certifica qualidade editorial das imagens/narrações pagas nem desempenho em todos os projetos longos.

## 25. Próximos passos

Aplicar autenticação/ownership antes de hospedagem multiusuário; medir tempo/CPU/memória com projetos reais e definir quotas/retention/backup de storage; avaliar worker independente se a demanda crescer. Música, legendas e transições com overlap exigem uma etapa própria e novos testes de sincronização.

## Comandos de validação

```sh
cd api
npm run migrate:renders
npm run build
node node_modules/eslint/bin/eslint.js 'src/**/*.ts' 'trends/**/*.ts'
node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:renders:integration
```

O teste de integração requer PostgreSQL descartável com CREATE DATABASE e Google Chrome. Cria/remove banco isolado e usa portas 33552–33554; não usa a porta 3000. Para executar somente a integração backend, defina `CONTENT_RENDER_SKIP_BROWSER=true`.

```sh
cd frontend
npm run build
npm run lint
npm test
```

Referências usadas: [FFmpeg — progress, concat e opções de saída](https://ffmpeg.org/ffmpeg.html) e [FFmpeg — zoompan, loudnorm, apad e atrim](https://www.ffmpeg.org/ffmpeg-filters.html).
