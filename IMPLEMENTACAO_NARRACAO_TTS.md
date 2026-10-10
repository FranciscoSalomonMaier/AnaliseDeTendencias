# Implementação de narração por IA — TTS

## 1. Diagnóstico da arquitetura existente

Backend NestJS 11, frontend React 19/Vite, PostgreSQL com SQL direto via `pg` (sem ORM). Projetos, roteiros e cenas são persistidos em `content_generation_runs`; cenas possuem IDs próprios dentro do JSON `video_plan`. O módulo visual já tinha `ContentAssetRepository`, `StorageProvider`, `LocalStorageProvider`, `ImageProvider`, validação de uploads, seleções de imagens e bloqueios por projeto. O SDK OpenAI instalado é 7.15.0. Existem Jest no backend, testes Node/Vite/React SSR no frontend e integrações com PostgreSQL/HTTP/storage/Chrome.

Não existem autenticação, usuários/proprietários de projetos, Redis ou BullMQ. O módulo anterior de imagens utiliza fila local, com estados persistidos e recuperação de interrupções. A nova fila de áudio persiste também o trabalho pendente e o retoma no PostgreSQL.

## 2. Provider escolhido

`OpenAiTtsProvider`, usando `OpenAI.audio.speech.create` do SDK instalado. Reutiliza exclusivamente `OPENAI_API_KEY` no backend. A chave nunca é retornada ao frontend nem registrada nos logs.

## 3. Modelo

Padrão centralizado: `gpt-4o-mini-tts`. Aceita instruções de interpretação, formato e velocidade. A configuração também aceita o snapshot `gpt-4o-mini-tts-2025-12-15`; modelos sem instruções de estilo são rejeitados.

Documentação oficial consultada em 09/10/2026:

- [Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).
- [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech).
- [Deprecations](https://developers.openai.com/api/docs/deprecations): snapshots de GPT-4o Mini TTS possuem encerramento anunciado para **06/01/2027**, com migração recomendada para `gpt-realtime-2.1-mini`. A API Speech e o alias usados nesta entrega estavam disponíveis e foram verificados em uma chamada real. Antes desse prazo, revisar o provider e a documentação de migração; Realtime não deve ser tratado como substituição apenas do nome do modelo.

## 4. Vozes disponíveis

IDs oficiais: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`. Padrão: `cedar`. A interface apresenta nomes capitalizados, sem inventar gênero ou identidade. Amostras são geradas somente após clique e confirmação, com as configurações salvas, e ficam persistidas como assets de áudio sem cena. A UI identifica voz gerada por IA.

## 5. Configurações

Variáveis documentadas em `api/.env.example`:

| Variável | Padrão | Limite/opções |
|---|---|---|
| `TTS_PROVIDER` | `openai` | OpenAI implementado |
| `TTS_MODEL` | `gpt-4o-mini-tts` | Alias ou snapshot admitido pelo adapter |
| `TTS_DEFAULT_VOICE` | `cedar` | 13 vozes oficiais |
| `TTS_OUTPUT_FORMAT` | `mp3` | `mp3`, `wav` |
| `TTS_MAX_CONCURRENCY` | `2` | 1–3 |
| `TTS_MAX_TEXT_LENGTH` | `4096` | 1–4096 caracteres |
| `TTS_MAX_QUEUED` | `200` | 1–1000 |
| `TTS_TIMEOUT_MS` | `120000` | 30000–300000 ms |

O endpoint oficial também suporta opus/AAC/FLAC/PCM; esta implementação limita geração e armazenamento a MP3/WAV para garantir validação e reprodução sem transcodificação. Idioma acompanha o projeto (`pt-BR`). Voz, estilo `DARK`/`NARRATIVE` e velocidade 0,25–4 são salvos no projeto. Os presets centralizados instruem narração natural e leitura exata, sem conteúdo acrescentado.

## 6. Arquitetura do TtsProvider

`TtsProvider.generateSpeech` recebe texto, configurações efetivas e instruções. Retorna bytes, MIME, provider/modelo/voz, metadata e usage opcional. O adapter usa resposta binária, limita bytes lidos a 20 MB e converte erros do SDK em mensagens sem dados sensíveis. `maxRetries: 0` impede repetição automática de chamadas cobradas. O backend valida texto vazio/excessivo antes da chamada. Texto e configurações são capturados na criação do job; se a cena mudar depois, o resultado não é selecionado como atualizado automaticamente.

## 7. Storage reutilizado

A mesma instância de `StorageProvider` e a mesma raiz `CONTENT_STORAGE_PATH` servem imagens e áudio. `LocalStorageProvider` admite extensões MP3/WAV além das imagens, mantendo proteção de caminhos e criação exclusiva de arquivos com UUIDs.

Chaves lógicas de áudio: `content-projects/{projectId}/scenes/{sceneId}/audio/{assetId}.mp3` ou `.wav`. Amostras usam `audio-samples`. Arquivos continuam disponíveis após reabertura/reinício. Montar e fazer backup da raiz de storage junto com o banco. Nenhum caminho físico é exposto; a resposta contém a chave lógica e o endpoint do arquivo.

## 8. Modelagem dos assets

Reutilização de `content_assets`, estendida para `IMAGE | AUDIO`, com `duration_seconds` e `voice`. Os campos existentes guardam status, source, provider/modelo, texto original, instruções efetivas, fingerprint, metadata, usage, erros e timestamps. Metadata preserva configurações, hash do texto, duração, codec, taxa de amostragem, canais e informações da chamada quando disponíveis.

`content_generation_runs.narration_settings` guarda a configuração global. Sem duplicação editável por cena; cada versão guarda um snapshot necessário à rastreabilidade.

## 9. Seleção

`content_scene_audio` guarda a escolha por projeto/cena e eventual aceite explícito da versão desatualizada. FK composta garante que o asset pertence ao mesmo projeto; o service também exige `AUDIO`, mesma cena e status `READY` com duração válida. A escolha sobrevive à reabertura. Assets antigos não são removidos quando as cenas são substituídas.

## 10. Regeneração e desatualização

Cada tentativa cria novo ID/arquivo; nada é sobrescrito. A nova versão só assume a seleção após sucesso e se texto/configurações ainda corresponderem, as cenas estiverem aprovadas e a escolha anterior não tiver sido alterada durante o processamento. Falha preserva a seleção existente.

Hashes detectam texto alterado e configurações diferentes. O progresso não conta uma versão desatualizada como pronta, salvo aceite explícito para a configuração atual. **Manter áudio não muda o texto/hash/voz original do asset nem oculta o aviso de desatualização**. Uma mudança posterior exige novo aceite ou geração. Upload próprio não é invalidado apenas pela mudança da voz de IA.

## 11. Upload

MP3 e WAV PCM, máximo 20 MB, até 10 minutos e no máximo dois canais. Valida extensão, MIME, assinatura, container/codec, taxa de amostragem, duração finita/positiva e integridade do tamanho RIFF de WAV. Rejeita arquivo vazio, incompatível, truncado ou sem duração válida. Seleciona o upload após persistência bem-sucedida. Não há transcodificação nem suporte a M4A nesta etapa.

## 12. Duração real e player

`music-metadata` mede a duração no servidor a partir dos bytes, inclusive MP3 sem duração fornecida pelo browser. O resultado fica em `ContentAsset.durationSeconds` e metadata. A estimativa da cena continua independente.

Player nativo `<audio controls>` fornece reproduzir/pausar, progresso e tempos. O endpoint de arquivo compartilhado suporta byte ranges (`206`, `Content-Range`, `416`), MIME validado, cache privado e `nosniff`.

## 13. Geração em lote

POST confirmado cria somente jobs para cenas sem seleção pronta/válida, ignorando cenas com trabalho ativo. O retorno HTTP `202` fornece quantidade e IDs; polling consulta estados persistidos. Não chama OpenAI durante GET, carregamento da página ou aprovação de cenas. Amostras também exigem confirmação.

## 14. Concorrência e persistência da fila

Jobs são os próprios assets `PENDING` no PostgreSQL. Worker consulta a fila e faz claim atômico via `FOR UPDATE SKIP LOCKED`, passando para `GENERATING`. Concorrência global configurável (padrão 2) e limite de fila serializado entre projetos por advisory lock transacional. Índice único por projeto/cena/tipo impede duas gerações ativas acidentais; frontend usa bloqueio de operação em andamento.

Uma lease PostgreSQL permite um worker TTS por banco, compatível com a implantação local existente. Reinício retoma `PENDING`; chamadas `GENERATING` interrompidas viram `FAILED`, sem repetição cobrada automática. O worker de imagens só recupera assets `IMAGE`, evitando interferência entre filas. Não há Redis, BullMQ ou fila de trabalho exclusivamente em memória para TTS.

## 15. Erros e retentativas

Erros por asset não interrompem outras cenas. A UI exibe falha e ação explícita para tentar novamente, preservando histórico. Não há retry automático de chamadas ao provider: timeout/conexão não garantem que a chamada anterior não foi cobrada. Apenas o acabamento local/seleção possui retentativas curtas diante de conflito de locks; isso não repete a chamada OpenAI. Falha de storage/DB deixa asset como falha e remove arquivo órfão quando possível.

## 16. Endpoints

Prefixo: `/content-projects/:projectId`.

| Método | Caminho | Função |
|---|---|---|
| PATCH | `/narration-settings` | Salvar voz, estilo e velocidade; retorna projeto/revisão atualizada |
| GET | `/audio/progress` | Configurações/opções, versões, seleções e progresso |
| GET | `/scenes/:sceneId/audio` | Versões e seleção da cena |
| POST | `/scenes/:sceneId/audio/generate` | Gerar/regenerar; 202 |
| POST | `/scenes/:sceneId/audio/upload` | Multipart `file` + `revision` |
| PATCH | `/scenes/:sceneId/audio/:assetId/select` | Selecionar/aceitar versão existente |
| POST | `/audio/generate-missing` | Lote confirmado; 202 |
| POST | `/audio/sample` | Amostra confirmada com configurações salvas; 202 |
| GET | `/assets/:assetId/file` | Endpoint existente estendido para áudio e ranges |

Mutações exigem revisão atual. Lote/amostra exigem `confirm: true`. Configurações recebem `voice`, `style`, `speed`.

## 17. Migration

`006_content_narration.sql` adiciona campos e seleção de áudio, estende constraints de tipo/READY e índice de geração ativa por tipo. Dados existentes são preservados. Pode ser executada novamente. Não usa synchronize.

Executar dentro de `api`: `npm run migrate:narration` (reutiliza o runner de assets, aplicando 004, 005 e 006). **Aplicada e validada no banco local nesta entrega**, além das aplicações repetidas em bancos descartáveis.

## 18. Arquivos backend

Criados em `api/src/content-narration`: `tts-settings.ts`, `tts.provider.ts`, `openai-tts.provider.ts`, `audio-file.validator.ts`, `narration.repository.ts`, `content-narration.service.ts`, `content-narration.controller.ts` e specs de service/provider.

Alterados: tipos/repository/service/controller/module de assets, providers de storage, schema/repository de projetos, `.env.example`, `package.json`/lock e runner de migrations. Adicionado teste `api/test/content/narration.integration.cjs`; integrações anteriores atualizadas para o schema completo.

## 19. Arquivos frontend

Criados: `NarrationProduction.jsx`, `contentNarrationService.js`, `contentNarrationState.js`, `contentNarration.test.mjs`.

Alterados: `VisualProduction.jsx`, `ContentProjectCreation.jsx` e `contentProject.d.ts`. A etapa Produção mostra seções separadas de narração e imagens com progresso próprio, preservando o tema existente. Voz é definida globalmente para o projeto; não há overrides por cena.

## 20. Testes automatizados e integrações

- Backend: **30 suites, 175 testes passaram**, incluindo 20 novos testes de service/provider TTS.
- Frontend: **5 arquivos de testes passaram**, incluindo novo teste de narração (estado, vozes/configurações, player, versões, upload, loading, erro/retry, desatualização e requisições).
- PostgreSQL/HTTP/storage: migrations repetidas, parsing real MP3/WAV, duração, ranges, upload inválido/excessivo, versões, falhas, proteção entre projetos/cenas, lote, concorrência, duplicidade, mudanças de texto/voz e retomada após reinício passaram.
- Chrome: salvar voz, gerar individualmente, reproduzir/pausar, carregar duração, regenerar, selecionar versão anterior, upload, lote confirmado e reabrir com seleções persistidas passaram. Layouts 1440/768/390 sem overflow.
- Regressões PostgreSQL/Chrome de projetos/roteiros/cenas e imagens passaram.

**Todos esses testes automatizados usam providers simulados e não consomem créditos.** Áudio fixture é um WAV PCM válido; o parser MP3 também foi exercitado com frames de teste.

## 21. Build, TypeScript e lint

Backend: build Nest, TypeScript `--noEmit` e ESLint passaram. Frontend: build Vite, ESLint e testes passaram. O frontend utiliza JSX/JavaScript e declarações `.d.ts`, sem configuração/script de compilação TypeScript independente.

## 22. Validação real e limitações

Com autorização, foi feita **uma única chamada real** à OpenAI usando a chave existente: `gpt-4o-mini-tts`, voz `cedar`, MP3, **5,352 s**, **85.632 bytes**. O adapter real, o parser e o storage validaram/salvaram os bytes; o arquivo de teste ficou em `/tmp`, sem criar ou alterar projetos do usuário. O Chrome confirmou reprodução/decodificação do MP3 real, duração de 5,352 s e avanço do tempo do player sem erro.

Limitações: sistema existente não possui autenticação ou propriedade por usuário. As validações implementadas impedem misturar projetos/cenas/assets, mas **não fornecem privacidade multiusuário**: quem conhece um UUID pode acessar a API existente. Implantação compartilhada exige autenticação e ownership em todos os módulos/arquivos. Não foi criada uma segurança fictícia apenas para TTS.

Worker atual é único por banco; expansão para múltiplas instâncias requer evolução da lease/worker. Storage local precisa de volume persistente/backup. M4A, clonagem, música, legendas, timeline, FFmpeg e renderização não foram implementados. Revisar a migração da família de modelos TTS antes de janeiro/2027.

## 23. Custos e chamadas externas

Uma chamada Speech por asset gerado, inclusive amostras e novas versões. Uploads, seleção e consultas não geram chamadas à OpenAI. A API Speech binária usada não retorna usage de tokens: `tokenUsage` permanece `null`. Persistimos provider/modelo/voz, caracteres, duração, número de chamadas e request ID quando disponíveis, sem inventar tokens ou valor cobrado. O custo efetivo deve ser consultado no projeto OpenAI associado à chave. A verificação real introduziu uma única chamada curta paga; não foi gerado lote real.

## 24. Próximos passos

Preparar autenticação/ownership antes de uso multiusuário, garantir backup do storage/banco e planejar a migração do provider TTS anunciada pela OpenAI. A futura timeline já pode consultar imagens selecionadas, áudio selecionado e duração real; montagem e renderização ficam para outra etapa.
