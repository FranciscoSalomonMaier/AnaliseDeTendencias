# Video Remix — Etapa 5: montagem e edição automática

## Funcionalidades

O Video Remix agora monta vídeos reais com FFmpeg a partir dos trechos selecionados na Etapa 3, das referências do roteiro validado e das narrações segmentadas da Etapa 4. A seção **Montagem e Edição** permite criar timelines, editar cortes e produzir prévias ou exportações finais. Esta implementação não inicia a Etapa 6.

- Timelines imutáveis e versionadas em JSONB, incluindo itens, ordem, fontes/arquivos, candidatos, segmentos narrativos, áudios, versão/revisão do roteiro, configurações e hash do contexto autorizado.
- Tempos da fonte separados dos tempos na timeline. Cada segmento mantém a duração real completa de sua narração, arredondada para cima até o próximo frame.
- SINGLE_SOURCE usa as referências da fonte ativa; MULTI_SOURCE usa somente as fontes autorizadas associadas aos segmentos do roteiro. Não há busca ou preenchimento aleatório.
- Cortes limitados aos intervalos selecionados, deduplicação de sobreposições dentro do segmento na montagem automática e aviso bloqueante quando o material visual não cobre a narração.
- Desaceleração opcional limitada a 0,9× e congelamento opcional de até um segundo por corte; ambos exigem configuração explícita. O arredondamento de até um frame é registrado separadamente.
- Recorte central, fundo desfocado ou recorte manual com coordenadas normalizadas X/Y por item. Zoom central suave, de até 3%, opcional.
- Corte seco padrão, fade de entrada/saída e crossfade simples. Os intervalos ocupados pelas transições ficam registrados nos itens. O crossfade mistura o fim do corte com o primeiro frame do próximo trecho, sem encurtar a narração ou consumir o áudio do próximo segmento. No último trecho ele é ignorado, com aviso.
- Prévia 540×960; vídeo final 1080×1920, MP4, H.264, AAC estéreo 48 kHz, 30 FPS padrão ou 24 FPS opcional. Qualidade padrão CRF 23 ou alta CRF 18. As dimensões finais reutilizam `VIDEO_FORMATS`.
- Narração principal, áudio original inicialmente silenciado, volumes independentes, normalização opcional, limitador e fade de áudio até 0,5 segundo. Fontes sem áudio recebem silêncio na trilha original; não é baixada música.
- Legendas tradicionais queimadas no vídeo, com fonte, cor, posição, estilo e ativação configuráveis. Reutiliza libass, fontes locais, exportação ASS, escape de caracteres e validações existentes.
- Fila persistida no PostgreSQL, uma renderização Remix por vez entre instâncias, progresso por cortes/fases e tempo efetivo de codificação, cancelamento, timeout, proteção contra jobs idênticos simultâneos e repetição manual após falha. Uma nova solicitação após conclusão também pode gerar outra versão do arquivo.
- Player e download privados com suporte a HTTP Range; histórico com resolução, duração, andamento e erros. Autenticação e proprietário reutilizam o acesso local já existente.

## Arquitetura e segurança

A análise identificou o renderizador atual de imagens por cena, `MediaProcess`, `RenderSettings`, `StorageProvider`, os formatos/estilos de legendas, o registro privado de arquivos Remix, a fila PostgreSQL das etapas anteriores e a validação de fontes/licenças do roteiro. Esses componentes são reutilizados. O processamento específico de clipes fica no módulo Video Remix; não foram adicionados Redis, serviços externos ou dependências npm.

FFmpeg e FFprobe recebem argumentos separados (`spawn`, sem shell). Caminhos são internos; o usuário não fornece filtros ou comandos arbitrários. O pipeline copia fontes para um diretório privado isolado, corta/reencoda clipes, prepara transições, concatena, monta a narração por segmento, mistura o áudio e gera o MP4 final. FFprobe verifica fontes, narrações e saída, incluindo codecs, resolução, FPS e duração final.

Arquivos originais são preservados. Vídeos são processados em disco; o storage usa cópia/streaming, não buffers de vídeo completos. Diretórios temporários têm permissão 0700, cópias privadas 0600 e resultados privados no storage. A limpeza ocorre em `finally`; diretórios órfãos antigos são removidos sob o lock do worker. Arquivos gravados mas não publicados entram na fila durável de limpeza. A exclusão dos registros de exportação também agenda a remoção física, preservando arquivos ainda referenciados.

São revalidados contexto, revisão e áudios antes/durante o processamento e antes da publicação. Se cenas, fontes, autorizações ou roteiro mudarem, é necessário criar outra timeline. O acesso ao MP4 também verifica a validade atual. O endpoint não revela caminhos de storage ou detalhes internos do FFmpeg.

Limites da montagem: até 36 cortes; duração máxima de 600 segundos ou o limite menor configurado; uma renderização Remix simultânea; fila limitada; timeout global e por processo; codificadores e filtros com uma thread; limite por arquivo; teto de temporários de quatro vezes o limite de arquivo, verificado entre fases; monitoramento periódico de espaço livre. Metadados registram tempo de processamento e pico observado de armazenamento temporário. O limite de concorrência do renderizador anterior continua próprio àquele módulo.

## Legendas e limitações

O TTS atual não entrega timestamps de palavras persistidos. A montagem usa **sincronização aproximada de frases**, baseada nas pausas medidas por `silencedetect` e em pesos do texto. Não executa ASR e não divide igualmente a duração entre palavras. O cache depende do áudio, texto e limites de agrupamento.

**Este método não é um alinhador fonético forçado e não garante precisão por palavra.** A API e a interface o identificam como `AUDIO_PAUSES_APPROXIMATE`. Para exportar com essas legendas, é obrigatório concluir uma prévia da mesma timeline e confirmar a revisão. Também é possível corrigir textos e tempos manualmente, salvando uma nova timeline, ou desativar legendas. Legendas manuais são validadas contra sobreposição e duração total. Não há destaque automático por palavra.

Outras limitações:

- A montagem exige **narração segmentada** atual em todos os segmentos SUPPORTED. Se você gerou somente a narração completa, use “Gerar narração segmentada” na Etapa 4 antes de criar a timeline.
- Não há rastreamento de personagens, detecção de região de interesse ou pan automático. Revise o enquadramento no player.
- Apenas 9:16 está habilitado nesta etapa. A configuração e o catálogo de formatos separam as dimensões para futuras extensões.
- As transições não encurtam os blocos narrativos; o crossfade usa o primeiro frame do próximo corte como referência visual.
- Reordenação mantém os cortes de cada segmento agrupados. Excluir material suficiente bloqueia a renderização em vez de eliminar a narração. Para recuperar a montagem automática após exclusões, crie outra timeline do roteiro.
- Cancelar interrompe processos em andamento; não desfaz arquivos de narração já existentes. Reinícios marcam jobs interrompidos como FAILED, liberando nova solicitação explícita, sem retentativa automática infinita.
- O teste GTA depende de material autorizado real. As fixtures automatizadas são cores e tons sintéticos; não demonstram a presença de easter eggs em gameplays.

## Banco, dependências e configuração

Migration nova: `api/migrations/019_video_remix_assembly.sql`.

Cria `video_remix_timelines`, `video_remix_exports`, `video_remix_caption_alignments`, índices da fila e trigger de limpeza de exportações. Reaplicação idempotente foi incluída no teste de integração. O runner existente agora inclui a migration 019 e o comando:

```bash
cd api
npm run migrate:remix-assembly
```

A migration foi aplicada no PostgreSQL local durante a implementação. Se o banco estiver parado, inicie o serviço do projeto com `docker compose up -d --wait postgres` antes de executar o comando. Em outro ambiente, execute o runner no ambiente da API, com `DATABASE_URL` apontando para o banco correto.

Nenhuma dependência nova e nenhuma chave de IA adicional. A montagem não chama provedores de IA; reutiliza os arquivos já gerados. Análise, roteiro e TTS continuam sujeitos aos provedores/custos das etapas anteriores.

FFmpeg e FFprobe reutilizam os pacotes `ffmpeg-static` e `ffprobe-static` existentes. Para executáveis próprios, configure `FFMPEG_PATH` e `FFPROBE_PATH`; a instalação deve suportar libx264, AAC, libass e os filtros utilizados. As fontes locais são as de `api/assets/fonts`.

Variáveis existentes reutilizadas:

| Variável | Uso na montagem |
| --- | --- |
| `DATABASE_URL` | Timeline e fila persistidas |
| `CONTENT_ACCESS_KEY`, `CONTENT_OWNER_ID` | Sessão local e isolamento por proprietário |
| `CONTENT_STORAGE_PATH` | Fontes, áudios e MP4 privados |
| `VIDEO_RENDER_TEMP_DIR` | Diretórios temporários isolados |
| `VIDEO_RENDER_TIMEOUT_MS` | Timeout global e de codificação; padrão 30 minutos |
| `VIDEO_RENDER_MAX_QUEUED` | Limite da fila; padrão 20 |
| `VIDEO_RENDER_MAX_DURATION_SECONDS` | Limite de duração; aplicado junto ao teto Remix de 600 s |
| `VIDEO_RENDER_MAX_FILE_MB` | Limite de arquivo; padrão 2048 MB |
| `VIDEO_RENDER_MIN_FREE_MB` | Espaço livre mínimo; padrão 1024 MB |
| `VITE_API_URL` | Endereço da API no frontend, conforme configuração existente |

Não foram alterados `.env`, chaves ou configurações privadas.

## Operação pela interface

1. Abra o projeto Video Remix com a sessão local autenticada.
2. Complete a seleção dos trechos, a validação do roteiro e a narração segmentada.
3. Em **Montagem e Edição**, clique em **Atualizar montagem e roteiros** se acabou de gerar o roteiro nessa página.
4. Selecione o roteiro e clique em **Criar timeline**.
5. Confira fonte, texto narrado, tempos originais, posição na timeline e avisos. Ajuste cortes, recorte, transições e configurações; clique em **Salvar nova versão da timeline**.
6. Resolva os avisos de material insuficiente na seleção/associação de trechos ou na narração. O sistema mantém a voz completa.
7. Clique em **Gerar prévia**. Acompanhe a fila; o player aparece ao concluir. Revise enquadramento, som e legendas.
8. Se necessário, abra **Legendas**, habilite edição manual e corrija texto/tempos. Salve e gere outra prévia.
9. Confirme a revisão das legendas aproximadas quando aplicável e clique em **Renderizar vídeo final**.
10. Reproduza ou use **Baixar MP4**. O histórico mantém as exportações. Após uma falha ou conclusão, é possível solicitar outra renderização.

## API

Prefixo: `/video-remix/projects/:projectId/assembly`.

| Método e caminho | Operação |
| --- | --- |
| `GET /timelines` | Histórico de versões |
| `POST /timelines` | Criar com `{scriptId, config}` |
| `GET /timelines/:id` | Timeline, itens, sincronização, avisos e legendas |
| `PATCH /timelines/:id` | Nova versão com `{items, config, subtitles?}` |
| `POST /timelines/:id/render` | Enfileirar com `{kind: "PREVIEW" ou "FINAL", confirm: true, confirmApproximateSubtitles?}` |
| `GET /renders` | Histórico, status, progresso e metadados |
| `POST /renders/:id/cancel` | Cancelar job pendente/ativo |
| `GET /renders/:id/file` | Reprodução privada, com Range |
| `GET /renders/:id/file?download=1` | Download autorizado |

## Arquivos

Criados:

- `api/migrations/019_video_remix_assembly.sql`
- `api/src/video-remix/remix-assembly.schema.ts`
- `api/src/video-remix/remix-timeline.builder.ts`
- `api/src/video-remix/remix-captions.ts`
- `api/src/video-remix/remix-assembly.service.ts`
- `api/src/video-remix/remix-assembly.renderer.ts`
- `api/src/video-remix/remix-assembly.worker.ts`
- `api/src/video-remix/remix-assembly.controller.ts`
- `api/src/video-remix/remix-assembly.spec.ts`
- `api/test/video-remix/remix-assembly.integration.cjs`
- `api/test/video-remix/remix-assembly.browser.cjs`
- `frontend/src/pages/VideoRemix/RemixAssemblyPanel.jsx`
- `frontend/test/remixAssembly.test.mjs`
- Este relatório.

Modificados:

- `api/package.json`: comandos de migration e integração.
- `api/scripts/migrate-assets.cjs`: inclui 019.
- `api/src/content-assets/content-assets.module.ts`: exporta `RenderSettings` para reutilização.
- `api/src/video-remix/video-remix.module.ts`: registra montagem, controlador e worker.
- `api/src/video-remix/remix-files.service.ts`: limpeza protege exportações referenciadas.
- `frontend/src/services/videoRemixService.js`: operações da montagem e URLs privadas.
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`: seção de montagem após roteiro/narração.
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`: link para esta etapa.

## Validação automatizada

Os testes utilizam PostgreSQL descartável, FFmpeg/FFprobe reais, arquivos pequenos e provedores de IA substituídos apenas no ambiente de teste. Nenhuma API externa paga é utilizada. A produção sempre processa os arquivos reais associados ao projeto.

- API: 577 testes em 52 suítes.
- Frontend: 104 testes.
- Builds da API/frontend e lint dos arquivos alterados.
- Integração: migrations aplicadas duas vezes; SINGLE_SOURCE e MULTI_SOURCE; recortes e timestamps; prévia e final reais; codecs/resolução/FPS/duração; áudio audível e completo; três enquadramentos; crossfade/fade/zoom; legendas automáticas/manuais; bloqueio por material insuficiente; deduplicação; cancelamento pendente/ativo; falha real do executável FFmpeg e liberação para nova solicitação; autorização/proprietário, revogação, Range/download; integridade dos originais e limpeza de temporários/storage.
- Chrome: criar timeline, editar recorte, salvar versão, gerar/reproduzir prévia, exigir revisão das legendas, gerar vídeo final; larguras 1440, 768 e 390 pixels.

Comandos:

```bash
cd api
npm run build
node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55444/postgres npm run test:remix-assembly:integration
```

O último comando exige um PostgreSQL **descartável** que permita criar/remover bancos. Não use a URL do banco de produção. Ele cria seu próprio banco e o remove ao terminar. O teste de navegador requer `google-chrome` local e portas 33873/33874 livres. As evidências e vídeos ficam em `/tmp/trends-remix-assembly-*`.

No frontend: `npm test`, `npm run build`, `npm run lint`.

## Cenário manual GTA Vice City

A consulta ao banco local não encontrou projetos do proprietário configurado com material para executar esse cenário durante esta entrega. Não foram gerados gameplays ou resultados GTA simulados.

**Teste A — SINGLE_SOURCE:** crie/abra um projeto com tema “GTA Vice City — Easter Egg do ovo de Páscoa”, pt-BR, Curiosidade, alvo 35 s. Importe um gameplay autorizado e registre a autorização. Analise, confira os frames e selecione trechos que mostrem o acontecimento. Associe esses trechos aos segmentos do roteiro, valide e gere a narração segmentada. Crie a timeline, ajuste a cobertura visual para a duração real, confira recorte vertical, gere prévia com legendas e revise os tempos. Exporte em 1080×1920/30 FPS.

**Teste B — MULTI_SOURCE:** repita em um projeto MULTI_SOURCE com dois ou mais gameplays autorizados. Associe cada trecho ao segmento narrativo correspondente; confira a continuidade entre as fontes, a identidade do local/acontecimento e os intervalos originais. Gere prévia e final nas mesmas configurações.

Compare clareza do acontecimento, continuidade, cortes, enquadramento de elementos essenciais, compreensão da voz, margens e sincronização das legendas. A duração final acompanha o áudio real; se diferir de 35 s, revise o roteiro/narração em vez de completar com cenas aleatórias. Preserve os registros de autorização e os MP4 exportados para comparação.
