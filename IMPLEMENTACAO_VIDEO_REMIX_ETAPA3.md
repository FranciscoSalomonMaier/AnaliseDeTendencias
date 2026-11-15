# Video Remix — Etapa 3: análise inteligente de vídeos

## Implementação

A seção **Análise Inteligente** permite estimar e confirmar uma análise de uma fonte importada ou de todas as fontes autorizadas do projeto. O backend enfileira o trabalho e retorna sem aguardar FFmpeg ou IA. Single Source permite selecionar vários intervalos de um arquivo; Multi Source permite analisar e comparar fontes distintas.

O pipeline real:

1. Verifica proprietário, autorização, existência e tamanho do arquivo.
2. Copia o arquivo para diretório privado e valida metadados por FFprobe. Reutiliza FPS cadastrado; complementa os dados com codec de áudio, presença de áudio, proporção e SHA-256. A nova leitura de metadados também confere duração e dimensões contra o cadastro.
3. Detecta cortes com o filtro `scene` do FFmpeg em resolução reduzida. Combina cortes com segmentação temporal, limita a quantidade e une intervalos pequenos.
4. Extrai frames próximos do início, meio e final de cada segmento, reduz resolução, comprime JPEG e remove frames quase idênticos dentro do segmento. Cada frame mantém o timestamp de amostragem.
5. Envia os frames e seus timestamps ao `LlmProvider` multimodal existente. A implementação OpenAI usa Responses API e Structured Outputs, sem criar outro cliente ou provedor paralelo.
6. Valida descrições, ambiente, personagens, objetos, ações, eventos, textos, mudanças, palavras-chave, incerteza, confiança e relevância semântica. Eventos diretamente observados precisam referenciar timestamps dos frames. Inferências e eventos não confirmados recebem classificação própria.
7. Usa as descrições estruturadas para sugerir sequências de cenas consecutivas. A aplicação valida IDs e continuidade e determina os limites usando os timestamps originais, sem confiar em intervalos inventados pelo modelo.
8. Persiste cenas, frames, sugestões e uso reportado. A interface lista cenas cronologicamente, ordena candidatos por relevância ou tempo, permite selecionar/desmarcar, ajustar intervalos e visualizar o trecho no player original.

A relevância de 0 a 100 é separada da confiança visual de 0 a 1. Faixas configuráveis classificam correspondência fraca, parcial, relevante e forte. O modelo também atribui papéis narrativos (contexto, ação, detalhe, resultado ou outro); a comparação de fontes pode destacar papéis complementares. Essas combinações são sugestões editoriais, não prova de continuidade ou causalidade entre gravações.

Nenhuma análise paga é iniciada ao abrir a página. Não há transcrição, reconhecimento de áudio, edição, montagem ou renderização final nesta etapa.

## Arquitetura reutilizada

- `VideoRemixService` e `VideoRemixRepository`: projetos, fontes, proprietário e PostgreSQL.
- `RemixFilesService` e `StorageProvider`: arquivos privados já importados; nenhuma URL externa é baixada.
- `MediaProcess`, `ffmpeg-static`, `ffprobe-static` e `sharp`: processos limitados, canceláveis e sem shell; extração e comparação de frames.
- `AiModule` / `LlmProvider`: interface existente, incluindo imagens, respostas estruturadas, sinal de cancelamento e uso de tokens.
- `ContentAccessGuard`: mesma chave/sessão local e controles de origem do restante do Video Remix.
- Padrão existente de filas em PostgreSQL e workers Nest com lifecycle hooks: não foram adicionados Redis, Bull ou serviços externos.

## Fila, cache, falhas e segurança

- Estados persistentes `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED` e `CANCELLED`.
- Um worker global por banco mediante advisory lock de sessão; até 20 trabalhos ativos/pendentes. Cada chamada de FFmpeg usa uma thread e há um vídeo em processamento por vez.
- Deduplicação transacional e índice único para fonte/configuração/contexto. Uma análise concluída idêntica é reutilizada sem nova chamada paga. Alterar arquivo, tema, declaração ou perfil cria outra identidade.
- Progresso real por fase e contagem de segmentos concluídos; não há porcentagens simuladas.
- No máximo uma retentativa automática por chamada de IA para falhas HTTP transitórias 429/502/503/504. Retentativas do SDK são desativadas nessas chamadas.
- Cancelamento persistente, verificado a cada segundo, com AbortSignal para mídia/IA. O cancelamento não desfaz consumo já ocorrido.
- Timeout global de 30 minutos, 5 minutos para detecção de cortes e 30 segundos para probe ou cada extração de frame. A IA mantém o timeout configurado no provedor existente.
- Após interrupção do processo, trabalhos que estavam `RUNNING` são marcados como falha sob o lock global. Não são reenviados automaticamente para evitar repetir gastos sem revisão. O botão **Reprocessar** exige confirmação e cria nova execução; resultados parciais e consumo reportado da anterior são preservados.
- Direitos, arquivo e tema são conferidos antes das chamadas e no encerramento. A retirada de autorização bloqueia novas análises e acesso a frames. A seleção rejeita análises desatualizadas.
- Frames e vídeos exigem autenticação e propriedade; nenhuma resposta expõe chaves ou caminhos internos. As imagens são servidas com `private, no-store` e `nosniff`.
- Conteúdo das imagens, títulos, descrições e saídas externas é tratado como dados não confiáveis. O prompt proíbe seguir instruções encontradas nesses dados. Não há ferramentas executáveis na chamada da IA.
- Diretórios de trabalho usam identificadores internos e permissões privadas. Temporários são removidos ao terminar ou falhar; diretórios de análises interrompidas com mais de duas horas são removidos sob o lock do worker.
- Espaço livre mínimo: tamanho do vídeo mais 256 MiB antes da cópia. Até cinco imagens por chamada, cada JPEG limitado a 2 MiB. O upload continua sujeito ao limite da etapa 2. A análise aceita até 3840 × 2160 pixels de área por frame; vídeos maiores precisam de redução prévia. Extrações usam limite de 64 MiB por alocação do FFmpeg.
- Frames persistidos permanecem enquanto sua análise existir. Exclusões em cascata enfileiram a limpeza física usando a fila já existente da etapa 2. Arquivos gravados antes de uma falha também têm limpeza persistente agendada.

## Migration e dependências

Nova migration: `api/migrations/017_video_remix_analysis.sql`.

Cria `video_remix_analyses`, `video_remix_scenes`, `video_remix_scene_frames` e `video_remix_segment_candidates`, com índices, chaves estrangeiras e trigger de limpeza de frames. Detalhes visuais ficam em JSONB na cena; candidatos referenciam IDs de cenas, evitando copiar os detalhes completos. Metadados de origem e direitos continuam nas estruturas existentes; a análise guarda seu contexto de execução para invalidar resultados desatualizados.

Não foram adicionadas dependências npm. FFmpeg/FFprobe e sharp já fazem parte do projeto. Podem ser usados os executáveis configurados em `FFMPEG_PATH` e `FFPROBE_PATH`; caso contrário, usam-se os binários estáticos existentes.

```bash
cd api
npm run migrate:remix-analysis
npm run build
```

O runner é o mesmo das etapas anteriores e inclui a migration 017. A aplicação da migration no banco do `.env` foi tentada nesta sessão e retornou **ECONNREFUSED**. Portanto, permanece pendente nesse banco. Não foram alterados `.env`, senhas ou dados do banco da aplicação. Inicie o PostgreSQL configurado e confira a conexão antes de repetir. O Compose atual contém apenas o serviço `postgres`, publicado na porta 5433; não há container da API nesse arquivo.

## Modelo e variáveis de ambiente

Configure no servidor:

```dotenv
OPENAI_API_KEY=sua_chave_existente
VIDEO_REMIX_ANALYSIS_MODEL=modelo_multimodal_disponivel_na_sua_conta
```

O modelo deve aceitar imagens e Structured Outputs na Responses API. Não há modelo implícito: sem chave ou sem `VIDEO_REMIX_ANALYSIS_MODEL`, a interface informa a configuração ausente e o backend não inicia análise. Recomenda-se configurar um identificador de versão fixa para obter melhor rastreabilidade. Não é necessário fornecer a chave novamente no frontend.

Referência usada para conferir a integração: [documentação oficial OpenAI — imagens e visão](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).

Novas configurações e valores padrão em `api/.env.example`:

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `VIDEO_REMIX_ANALYSIS_MODEL` | vazio | Modelo multimodal obrigatório |
| `VIDEO_REMIX_ANALYSIS_TEMP_DIR` | `storage/remix-analysis-tmp` | Diretório privado gravável |
| `VIDEO_REMIX_ECONOMIC_MAX_FRAMES` | 45 | Teto de frames no perfil econômico |
| `VIDEO_REMIX_ECONOMIC_MAX_SEGMENTS` | 15 | Teto de segmentos |
| `VIDEO_REMIX_ECONOMIC_INTERVAL_SECONDS` | 15 | Intervalo temporal inicial |
| `VIDEO_REMIX_ECONOMIC_FRAMES_PER_SEGMENT` | 3 | Amostras por segmento antes da deduplicação |
| `VIDEO_REMIX_ECONOMIC_MAX_DURATION_SECONDS` | 600 | Janela inicial analisada |
| `VIDEO_REMIX_ECONOMIC_FRAME_EDGE` | 384 | Maior dimensão em pixels, mantendo proporção |
| `VIDEO_REMIX_DETAILED_MAX_FRAMES` | 120 | Teto de frames no perfil detalhado |
| `VIDEO_REMIX_DETAILED_MAX_SEGMENTS` | 40 | Teto de segmentos |
| `VIDEO_REMIX_DETAILED_INTERVAL_SECONDS` | 8 | Intervalo temporal inicial |
| `VIDEO_REMIX_DETAILED_FRAMES_PER_SEGMENT` | 3 | Amostras por segmento |
| `VIDEO_REMIX_DETAILED_MAX_DURATION_SECONDS` | 1200 | Janela inicial analisada |
| `VIDEO_REMIX_DETAILED_FRAME_EDGE` | 768 | Maior dimensão em pixels |
| `VIDEO_REMIX_DETECT_CUTS` | true | Combinar cortes e intervalos temporais |
| `VIDEO_REMIX_CUT_THRESHOLD` | 0.3 | Limiar do filtro scene |
| `VIDEO_REMIX_MIN_SEGMENT_SECONDS` | 2 | União de segmentos pequenos |
| `VIDEO_REMIX_RELEVANCE_BANDS` | `40,70,90` | Limites das classes de relevância |
| `VIDEO_REMIX_ANALYSIS_MAX_OUTPUT_TOKENS` | 2500 | Teto de saída por chamada |

Limites de configuração: até 240 frames, 80 segmentos, cinco amostras por segmento, maior dimensão de 128–1024 pixels e duração de até 3600 segundos. Quando os limites de segmentos/frames exigem, o intervalo efetivo aumenta para cobrir a janela analisada. Vídeos maiores são explicitamente marcados como truncados; não se presume que o restante foi inspecionado.

### Estimativa financeira opcional

Também adicionadas, vazias por padrão:

- `VIDEO_REMIX_ANALYSIS_INPUT_USD_PER_MILLION`
- `VIDEO_REMIX_ANALYSIS_OUTPUT_USD_PER_MILLION`
- `VIDEO_REMIX_ANALYSIS_IMAGE_TOKEN_UPPER_BOUND`
- `VIDEO_REMIX_ANALYSIS_MAX_USD`

Use preços e limite de tokens de imagem correspondentes ao modelo, resolução e nível de detalhe utilizados. A interface mostra tetos de frames, segmentos e chamadas antes da confirmação. Sem dados suficientes, mostra **estimativa em dólares indisponível**, sem inventar preços. A estimativa inclui margem de texto e uma retentativa por chamada.

Se `MAX_USD` estiver definido, o backend exige estimativa disponível e dentro do limite antes de enfileirar. O uso real reportado é acumulado após cada resposta; ao ultrapassar o limite configurado, o trabalho é interrompido. Isso é um controle por estimativa/consumo reportado, não uma garantia de faturamento máximo: uma chamada já enviada ou com resposta perdida pode ser cobrada. Configure também os controles de orçamento no provedor. Tokens de respostas não recebidas não podem ser reconstruídos localmente.

## Como usar

1. Aplique a migration, configure o modelo/chave e reinicie a API.
2. Abra um projeto Video Remix em rascunho e importe/autorize o vídeo pela etapa 2.
3. Na seção **Análise Inteligente**, escolha **Econômico** ou **Detalhado**.
4. Clique em **Estimar análise** para uma fonte ou **Estimar todas as fontes**.
5. Revise a janela, modelo, limites e estimativa. Clique em **Confirmar e iniciar análise** e autorize o envio dos frames.
6. Acompanhe o status por fonte. Abra o histórico para consultar cenas, cancelar ou reprocessar falhas.
7. Em cenas, consulte evidências, incertezas e justificativas. Em sugestões, escolha ordenação, visualize o trecho e selecione/desmarque ou salve novos limites em segundos.
8. Em Multi Source, use **Comparar sugestões das fontes** para visualizar candidatos das últimas análises concluídas de cada fonte, com sua origem e possíveis papéis complementares.

O player utiliza o arquivo original, busca o início e pausa no fim do intervalo. Não é produzido um novo arquivo de vídeo.

## API

Base: `/video-remix/projects/:projectId/analysis`.

| Método | Caminho | Operação |
| --- | --- | --- |
| POST | `/estimate` | Estimar perfil e fonte opcional, sem chamada paga |
| POST | `/` | Enfileirar fonte ou todas, com `profile`, `sourceId` opcional e `confirm: true` |
| GET | `/` | Histórico, status, progresso e consumo |
| GET | `/:id` | Análise, cenas cronológicas e sugestões por relevância |
| GET | `/:id/scenes/:sceneId` | Detalhe de uma cena |
| GET | `/:id/frames/:frameId` | Imagem privada autenticada |
| POST | `/:id/cancel` | Cancelar trabalho pendente/em execução |
| POST | `/:id/retry` | Reprocessar trabalho com falha/cancelado |
| PATCH | `/:id/candidates/:candidateId` | Selecionar/desmarcar/ajustar `start`, `end`, `selected` e `revision` |

## Testes e resultados

- API: **548 testes em 50 suítes**, regressão completa via `node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand`.
- Frontend: **95 testes**, `npm test`.
- Builds da API e frontend e lint dos dois projetos. O build do frontend mantém aviso de chunk maior que 500 kB.
- Integração com PostgreSQL 17 descartável e migrations 004–017 aplicadas duas vezes: FFmpeg/FFprobe reais, corte conhecido em vídeo sintético sem áudio, vídeo contínuo sem cortes com áudio, extração/deduplicação de frames, metadados/timestamps, mock multimodal estruturado, sequência, relevância/confiança, Single/Multi Source, fila/cache/deduplicação concorrente, resposta inválida, retentativa transitória, seleção/revisão, cancelamento pendente/em execução, limite de custo, proprietário/direitos e limpeza física após exclusão.
- Chrome real: estimativa e confirmação, conclusão assíncrona, cenas, sugestões, seleção, player e layout em 1440/768/390 pixels.
- Nenhuma chamada real de IA ou YouTube. Os vídeos sintéticos são fixtures de teste, não substitutos usados na implementação em produção.

Comandos em `api`:

```bash
npm run test:remix-analysis
# Após o build; exige PostgreSQL descartável e Google Chrome instalado:
CONTENT_TEST_DATABASE_URL=postgresql://usuario:senha@host:porta/postgres npm run test:remix-analysis:integration
```

O teste cria e remove seu próprio banco isolado. Não utilize credenciais de produção. Os logs desta sessão estão em `/tmp/remix3-all-unit.log`, `/tmp/remix3-front-test.log` e `/tmp/remix3-integration.log`. Evidências de integração/Chrome: `/tmp/trends-remix-analysis-3IcZzW`, incluindo screenshot mobile e `evidence.json`.

## Validação com GTA Vice City

O arquivo `api/test/fixtures/remix-gta-scenario.json` fornece os dados do projeto **GTA Vice City — Easter Egg do ovo de Páscoa**, Single Source, pt-BR, 35 segundos, 9:16. O gameplay não acompanha o repositório.

1. Crie o projeto com esses dados.
2. Importe um gameplay obtido legitimamente e registre autor, licença, evidência e declaração de direitos.
3. Escolha **Econômico**, confira se a janela configurada cobre o trecho desejado e confirme a análise.
4. Compare manualmente os frames e descrições com o arquivo original. Verifique a localização, a exploração do prédio e a aparição do ovo somente se esses elementos estiverem realmente visíveis.
5. Use as justificativas e classificações de evidência para distinguir observação de inferência. Se o ovo não estiver visível, não considere palavras-chave ou relevância alta como confirmação.
6. Visualize os trechos, ajuste os limites e selecione os candidatos. Repita em projeto Multi Source com arquivos autorizados distintos.
7. Registre falsos positivos, cenas perdidas, perfil, modelo/versionamento e timestamps corrigidos para comparar futuras execuções.

Não foi fornecido gameplay autorizado nesta sessão; portanto, esse teste semântico real permanece para validação com o material do usuário. Não houve alegação de que o easter egg foi encontrado.

## Limitações

A amostragem pode perder acontecimentos rápidos. Os timestamps são posições de amostragem/busca, não localização exata de toda ação; a precisão depende do FPS, codec, intervalos e frames disponíveis. Similaridade entre frames pode ocultar pequenas mudanças. Vídeos longos têm janela inicial limitada e segmentos podem aumentar para respeitar os tetos.

O modelo pode errar objetos, textos pequenos, identidades ou relações temporais; confiança e relevância não são medidas estatísticas calibradas. Não se detectam acontecimentos apenas audíveis. Sequências e papéis complementares exigem revisão humana. O player depende dos codecs suportados pelo navegador; FFmpeg pode analisar um formato que o navegador não consiga reproduzir.

A fila usa um worker global por banco e não distribui carga entre máquinas. Resultados parciais são preservados para auditoria, mas reprocessar reinicia a análise e pode repetir consumo. A estimativa financeira depende dos parâmetros fornecidos pelo operador. A migration no banco da aplicação e a validação com gameplay autorizado são as pendências operacionais.

A **Etapa 4 não foi iniciada**.

## Arquivos

Criados:

- `api/migrations/017_video_remix_analysis.sql`
- `api/src/video-remix/remix-analysis.schema.ts`
- `api/src/video-remix/remix-analysis.settings.ts`
- `api/src/video-remix/remix-analysis.media.ts`
- `api/src/video-remix/video-scene-analysis.service.ts`
- `api/src/video-remix/remix-analysis.service.ts`
- `api/src/video-remix/remix-analysis.worker.ts`
- `api/src/video-remix/remix-analysis.controller.ts`
- `api/src/video-remix/remix-analysis.spec.ts`
- `api/test/video-remix/remix-analysis.integration.cjs`
- `api/test/video-remix/remix-analysis.browser.cjs`
- `api/test/fixtures/remix-gta-scenario.json`
- `frontend/src/pages/VideoRemix/RemixAnalysisPanel.jsx`
- `frontend/test/remixAnalysis.test.mjs`
- Este relatório.

Modificados:

- `api/.env.example`, `api/package.json`, `api/scripts/migrate-assets.cjs`
- `api/src/video-remix/video-remix.module.ts`
- `api/src/video-remix/remix-files.service.ts` (exportação do tipo de metadados existente)
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`
- `frontend/src/services/videoRemixService.js`
- `frontend/src/types/videoRemix.d.ts`, `frontend/src/utils/videoRemix.js`
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`
