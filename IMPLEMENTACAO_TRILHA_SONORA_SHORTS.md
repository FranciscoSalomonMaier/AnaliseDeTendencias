# Implementação — Trilha sonora de Criar Short

## Resumo e fluxo

Foi adicionada uma música de fundo opcional ao Criar Short. O novo fluxo tem nove etapas:

1. Criar roteiro.
2. Vídeos para montagem.
3. Referências de Edição (opcional).
4. Texto da narração.
5. Gerar narração.
6. Editar vídeo.
7. **Trilha sonora** (opcional).
8. Renderizar Short.
9. Resultado.

A trilha fica depois da aprovação da montagem e antes do render. Não inicia geração de IA, transcrição ou busca de músicas. Sem música, com a música desativada ou com volume zero, é utilizado diretamente o áudio de narração anterior, sem mixagem adicional.

## Como utilizar

Na etapa 7, confirme a autorização de uso e arraste um arquivo ou selecione-o no computador. É permitida uma música por projeto. O player reproduz o arquivo original; as configurações serão aplicadas no vídeo renderizado.

Revise o volume, fades, repetição e ducking. Clique em **Salvar configurações** antes de continuar. Para substituir, selecione outro arquivo; para excluir, use **Remover música**. A substituição mantém as configurações já salvas. **Continuar sem música** desativa a trilha e avança, preservando o upload para eventual reativação. O botão **Usar esta música no vídeo** permite reativá-la ao retornar à etapa.

O botão Voltar e a navegação existente foram preservados. O progresso agora mostra nove etapas. Ao editar configurações, o avanço fica bloqueado até salvar; erros preservam os campos não salvos.

## Padrões e validação

| Configuração | Padrão / limite |
| --- | --- |
| Música por projeto | Uma |
| Formatos | MP3, WAV, AAC, M4A, OGG, FLAC |
| Volume | 15%, slider de 0% a 100% |
| Fade in | Ativo, 1 segundo |
| Fade out | Ativo, 0,5 segundo |
| Duração dos fades | 0 a 30 segundos, limitada à faixa efetivamente utilizada |
| Repetição | Ativa |
| Ducking | Ativo |
| Upload | 50 MiB por padrão, configurável |
| Duração da música | Até 60 minutos por padrão, configurável |

Frontend valida extensão, MIME declarado e tamanho antes do envio. Backend valida tamanho real, assinatura do formato, extensão/MIME, contêiner/codec, uma faixa de áudio válida, duração, canais e amostragem via FFprobe. Faz decodificação completa com FFmpeg e `-xerror` para verificar integridade. A duração persistida é o tempo efetivamente decodificado (`out_time_us` com timestamps reiniciados), evitando depender da duração estimada de contêineres como AAC/ADTS. Imagens de capa anexadas são toleradas; arquivos com vídeo real ou múltiplas faixas de áudio são rejeitados. AAC é ADTS; M4A aceita AAC/ALAC; OGG aceita Vorbis/Opus/FLAC. O suporte depende dos codecs do FFmpeg instalado.

Uploads vão para disco temporário com limite Multer específico da música. O arquivo só é associado ao projeto após validação, revisão e trava do projeto. Extensões adicionais foram incluídas na lista permitida do storage privado, mantendo as verificações de caminho.

## Render e mixagem

Reutiliza `AudioMixService`, já existente, sem modificar os seus filtros ou alterar os fluxos antigos. `ShortMusicRenderer` adapta os dados do Short para esse serviço.

1. A narração permanece na posição original da timeline.
2. A música é reamostrada para 48 kHz/estéreo e recebe volume.
3. Se for mais longa que o vídeo, é cortada. Se for mais curta e o loop estiver ativo, repete até o fim; sem loop, recebe silêncio na cauda.
4. Fade in começa no início. Fade out termina no fim da música usada — no final do vídeo quando há loop ou música longa, ou no final da faixa curta quando não há loop.
5. Ducking usa a própria narração como sidechain, reduzindo a música durante a fala.
6. `amix`, `alimiter`, `apad`, `atrim`, `aresample` e ajuste de timestamps preservam a duração e reduzem risco de clipping.
7. O WAV intermediário é validado quanto à duração e usado no mux final H.264/AAC. Legendas, overlays, zoom/fades e enquadramento continuam no render existente.

A duração usada é a **duração real do áudio aprovado**, já utilizada pela montagem e validada contra os intervalos dos clipes. Não se utiliza a duração solicitada inicialmente como limite da mixagem. Loops só são ativados quando a faixa é menor que o vídeo, evitando carregar uma música longa inteira no buffer de repetição.

Os vídeos originais continuam silenciados, como no fluxo anterior (`-an` nos cortes). A narração não muda de velocidade nem conteúdo. Não foram adicionados efeitos sonoros, múltiplas músicas ou configurações de áudio original.

## Persistência e compatibilidade

Os dados ficam no JSONB `short_projects.data`, seguindo o padrão do módulo:

- `music`: identificação, chave privada, nome sanitizado, bytes, duração, MIME, codec, amostragem, canais e data da declaração de direitos.
- `musicSettings`: volume, fades e durações, loop e ducking.
- `musicEnabled`: uso ou desativação temporária da trilha.

Chaves internas não são retornadas ao frontend. A API apresenta URL privada do player. A declaração registra a autorização informada pelo usuário, sem afirmar que houve comprovação jurídica.

Alterar, substituir, remover, ativar ou desativar a música invalida somente o vídeo final. Narração, cortes aprovados e referências são preservados. Se o roteiro/texto/voz mudar, a trilha e suas configurações permanecem no projeto para o próximo render.

Músicas substituídas ou removidas e renders invalidados entram na limpeza persistente já existente, com carência de uma hora. Arquivos temporários são removidos ao concluir/falhar o upload ou render. Arquivos associados ao projeto continuam privados e não são sobrescritos.

## Banco e atualização do ambiente

Migration: `api/migrations/023_short_soundtrack.sql`.

Ela adiciona o marcador `soundtrack_version`, amplia a restrição de etapas para 1–9 e converte as antigas etapas 7/8 em 8/9 uma única vez. Não altera os arquivos nem os resultados de Shorts antigos, que continuam sem música. É idempotente e recusa a primeira aplicação se houver tarefas de Shorts na fila ou em execução. Execute com a API parada para evitar trabalho concorrente durante a atualização.

Em ambiente já atualizado até a migration 022:

```bash
cd api
npm run migrate:short-music
npm run start:dev
```

Em ambiente novo, execute antes `npm run migrate:shorts` e `npm run migrate:short-references`.

Frontend:

```bash
cd frontend
npm run dev
```

Não foram adicionadas dependências npm. Reutiliza FFmpeg/FFprobe, NestJS/Multer, Zod, PostgreSQL, storage e filtros existentes. As configurações opcionais estão em `api/.env.example`:

```dotenv
SHORT_MUSIC_UPLOAD_MAX_MB=50
SHORT_MUSIC_MAX_SECONDS=3600
```

Não exige alteração de chaves de API. Alterações dessas configurações exigem reinício da API. FFmpeg deve oferecer os codecs selecionados e os filtros `sidechaincompress`, `alimiter`, `aloop` e demais filtros já usados pela mixagem existente.

## Endpoints

Todos protegidos pelo acesso local/proprietário já existente:

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/shorts/:id/music` | Upload/substituição multipart: `file`, `rights=true`, `revision` |
| GET | `/shorts/:id/music` | Player privado com streaming e suporte a Range |
| DELETE | `/shorts/:id/music` | Remoção com `revision` no JSON |
| PATCH | `/shorts/:id` | Salvar `musicSettings`, `musicEnabled` ou `skipMusic`, com revisão |
| GET | `/shorts/options` | Inclui limites da música |

Não aceita URLs, caminhos arbitrários, comandos nem parâmetros FFmpeg do cliente. Nomes são sanitizados; os processos recebem argumentos separados, sem shell e com protocolos locais permitidos. Escritas exigem revisão, etapa correta e ausência de tarefa ativa.

## Testes

Unitários cobrem padrões/limites, gates das nove etapas, ausência/desativação/volume zero, invalidação apenas do render, remoção/limpeza e filtros reaproveitados.

A integração cria banco descartável e usa FFmpeg real com músicas/narração sintéticas. Os serviços de IA permanecem simulados. Verifica os seis formatos, assinatura/MIME, arquivo inválido, vídeo disfarçado de M4A, tamanho, autorização, revisão, isolamento de proprietário, player com Range, substituição, remoção, persistência, render com/sem música e compatibilidade de etapas antigas.

Mede a componente musical de 1 kHz misturada com narração sintética de 440 Hz: volumes 0%, 15%, 100%; teto de picos; repetição e silêncio; fades; ducking durante a fala e recuperação no silêncio. Confere a duração exata do áudio intermediário e a duração/resolução/codec do vídeo final.

Comandos:

```bash
# api
npm run build
npm run test:short-music
npm run test:shorts
npm run test:short-editing
# Integração: usuário PostgreSQL de teste precisa de CREATEDB.
SHORT_TEST_DATABASE_URL=postgresql://... npm run test:short-music:integration
# Regressão opcional da edição com referências e render ASS
SHORT_TEST_DATABASE_URL=postgresql://... npm run test:short-editing:integration
# frontend
npm test
npm run build
```

Os resultados efetivamente executados são registrados ao final deste documento.

## Limitações e escopo

- Uma música, posicionada desde o início do vídeo, sem edição manual de pontos de entrada ou efeitos.
- Loop simples; músicas sem fechamento adequado podem apresentar uma emenda audível. Não foi introduzido crossfade de loops.
- Player mostra o arquivo original, sem simular os filtros; confira o vídeo final para avaliar a mixagem.
- Ducking reage à energia do áudio, não ao significado das palavras. A percepção de clareza depende também do material original; recomenda-se ouvir o resultado antes de publicar.
- Declaração de autorização não valida direitos de terceiros.
- Não há geração de música com IA, busca na internet, biblioteca ou integração externa.
- Músicas não são extraídas dos vídeos de referência; o seletor de música nas referências continua sem análise acústica automática.

## Arquivos

Criados:

- `api/migrations/023_short_soundtrack.sql`
- `api/scripts/migrate-short-music.cjs`
- `api/src/short-creation/short-music.schema.ts`
- `api/src/short-creation/short-music.service.ts`
- `api/src/short-creation/short-music.spec.ts`
- `api/test/shorts/short-music.integration.cjs`
- `api/test/shorts/short-music.scenarios.cjs`
- `frontend/src/pages/CreateShort/Soundtrack.jsx`
- `frontend/test/shortSoundtrack.test.mjs`
- `IMPLEMENTACAO_TRILHA_SONORA_SHORTS.md`

Modificados:

- `api/.env.example`, `api/package.json`
- `api/src/content-assets/local-storage.provider.ts`
- `api/src/short-creation/short.schema.ts`, `short.settings.ts`, `short.service.ts`, `short.worker.ts`, `short.media.ts`, `short.module.ts`, `short.controller.ts`, `short-editing.schema.ts`, `short.spec.ts`, `short-media.spec.ts`
- `api/test/shorts/shorts.integration.cjs`
- `frontend/src/pages/CreateShort/CreateShort.jsx`, `EditingReferences.jsx`
- `frontend/src/services/shortCreationService.js`
- `frontend/test/shortCreation.test.mjs`
- `CRIAR_SHORT_MVP.md`, `REFERENCIAS_EDICAO_SHORTS.md`

## Resultados executados nesta entrega

- **93 testes de backend aprovados**, em oito suítes: Criar Short, trilha sonora, mixagem existente, voz e legendas.
- **120 testes do frontend aprovados**, incluindo upload/revisão/direitos, configurações, player e etapa opcional.
- Builds de produção da API e do frontend aprovados; `git diff --check` sem erros.
- Integração da trilha aprovada com **PostgreSQL descartável e FFmpeg real**: seis formatos, validação e limites, direitos, isolamento, revisão, streaming Range, substituição/remoção, persistência, compatibilidade de etapas e renders com/sem música.
- Medições em áudio sintético aprovadas para volume 0/15/100%, limitação de picos, música longa/curta, loop/silêncio, fade in/out e ducking durante a fala, mantendo a duração da timeline.
- Regressão A/B da edição aprovada, incluindo renderização conjunta de **música independente autorizada no cenário de teste + legendas ASS/destaques + overlays + zoom/fades**. As referências continuam sem fornecer material audiovisual ao resultado.
- Migration 023 aplicada no banco local; a integração também aplicou a migration repetidamente para verificar idempotência e conversão das etapas antigas.

Todos os serviços pagos de IA foram simulados nos testes; nenhuma geração ou transcrição paga foi executada. A validação acústica usou sinais sintéticos para permitir medições objetivas; a avaliação de clareza com uma música e voz reais deve ser feita ouvindo o vídeo final.
