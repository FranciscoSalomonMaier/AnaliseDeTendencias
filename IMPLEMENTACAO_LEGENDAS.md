# Etapa 6 — Legendas automáticas e sincronizadas

Implementação no pipeline existente: **Imagem + narração selecionada + música + efeitos + legendas → MP4 H.264/AAC**.

## 1. Diagnóstico da arquitetura existente

Backend NestJS, PostgreSQL com `pg` e migrations SQL; frontend React/Vite. Projetos e cenas ficam em `content_generation_runs`; assets possuem arquivos imutáveis no StorageProvider; seleções visuais e de narração são persistidas em tabelas específicas.

TimelineBuilder utiliza a duração medida do áudio selecionado, adiciona o padding configurado e arredonda a duração para frames. A narração começa no início da cena, sem offset adicional. A transição atual é CUT, sem sobreposição. FfmpegRenderer prepara cada cena em H.264 com áudio PCM, concatena, aplica a mixagem existente e produz AAC no MP4 final. RenderJob possui fila persistida e snapshot. Não havia transcrição, SRT ou ASS. O FFmpeg empacotado oferece os filtros `ass` e `subtitles` com libass.

Não há autenticação de usuários nem ownership de projetos na plataforma. As novas operações verificam projeto, cena, versão e asset correspondente; isso **não equivale a autorização entre usuários**.

## 2. Tecnologia escolhida

Transcrição do áudio efetivamente selecionado usando timestamps retornados pelo provider. Não é distribuição proporcional do roteiro e não é forced alignment. O texto reconhecido permanece separado da referência da cena. A comparação textual sinaliza divergências para revisão.

Foi evitada instalação de modelos locais, ambientes Python e serviços pesados. Nenhuma dependência npm foi adicionada.

## 3. Provider

`SpeechAlignmentProvider` é a abstração; `OpenAiSpeechAlignmentProvider` é a única implementação real. Utiliza o SDK OpenAI já instalado, modelo **whisper-1**, endpoint `/v1/audio/transcriptions`, `verbose_json` e `timestamp_granularities: ['word', 'segment']`. Solicita português quando o projeto está em pt-BR. Não utiliza o roteiro como prompt, para não induzir uma transcrição que esconda diferenças do upload.

Usa a **OPENAI_API_KEY do backend**, a mesma integração usada pelas demais funções OpenAI. Geração ocorre exclusivamente por ação explícita ou continuação de um job previamente solicitado e persistido.

Referência oficial consultada em 10/10/2026: [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text). A documentação confirma suporte a granularidades no whisper-1 e limite de 25 MB; o módulo preserva o limite local mais restrito, **20 MiB e 600 segundos por narração**, MP3/WAV.

## 4. Precisão e granularidade

WORD quando existem palavras com timestamps; SEGMENT quando somente segmentos válidos estão disponíveis. Se os timestamps de palavras são inválidos mas os segmentos são válidos, mantém os segmentos reais e exige revisão explícita, com aviso; não tenta reparar ou interpolar as palavras. Tempos negativos, não finitos, vazios, fora da duração ou sobrepostos são rejeitados. Intervalos devem permanecer positivos também na precisão de centésimos do ASS.

Os timestamps são estimativas do reconhecimento de fala, não uma garantia de precisão fonética. Nomes, ruídos, fala muito rápida e silêncios podem exigir revisão. Testes usam um provider simulado e áudio sintético: validam o pipeline e os intervalos, **não medem a qualidade da OpenAI em fala real**. Não houve chamadas pagas para validar o reconhecimento.

## 5. Modelagem

`content_subtitles`: identificação da versão, projeto, cena, asset de áudio, status, erro e JSONB com referência/hash, duração real, idioma, configuração de agrupamento capturada, transcrição, score, granularidade, segmentos e palavras originais.

`content_project_subtitles`: configurações visuais e seleção de versão por cena. Segmentos possuem id, ordem, texto, início, fim e palavras opcionais.

**Convenção persistida: tempos relativos ao início do áudio da cena.** No snapshot de render/exportação os tempos passam a ser absolutos na timeline. ASS por cena converte de volta para o tempo local da cena, mantendo a mesma sincronização.

## 6. Associação e histórico do áudio

Cada versão aponta para `audio_asset_id` exato. Trocar o áudio impede usar os tempos do anterior; versões antigas continuam armazenadas. A interface mostra versões do áudio atual e informa a preservação dos demais.

O hash da referência detecta edição posterior da narração. Legendas antigas ficam sinalizadas como desatualizadas. Confirmação após revisão cria outra versão; não modifica a original. Edição de legendas também cria uma versão nova. Nunca modifica o texto da cena ou os arquivos de narração.

## 7. Agrupamento

Palavras reconhecidas são agrupadas por máximo de palavras, caracteres, duração, pausas e pontuação final. Mantém os limites temporais reais da primeira e última palavra; não inventa intervalos internos e não corta palavras.

Configuração inicial: 5 palavras, 42 caracteres, 4 segundos e pausa de 0,5 segundo. Sem timestamps de palavras, mantém os segmentos fornecidos; não divide sua duração para simular precisão. Segmentos longos podem exigir edição manual ou redução de fonte. Há proteção para largura segura e máximo de linhas no ASS.

Alterar agrupamento afeta novas gerações. O MVP não oferece reagrupar versões existentes por uma ação própria; reproduzir, exportar, selecionar, editar e renderizar não reexecuta transcrição.

## 8. Presets

- CLASSIC: branco, contorno escuro, centralizado na parte inferior.
- DARK_CINEMATIC: fonte forte, contorno/sombra discretos; interface aplica defaults correspondentes.
- DYNAMIC: grupos curtos e destaque da palavra atual **somente quando existem timestamps confiáveis por palavra**.

O destaque usa eventos ASS limitados aos intervalos efetivos de cada palavra. Durante pausas não destaca uma palavra arbitrária. Versões editadas passam a SEGMENT e deixam de destacar palavras.

## 9. Configurações visuais

Schema central no backend valida ativação, preset, fonte de 24–96 px em referência 1080p, cores hexadecimais, contorno, sombra, posição vertical, margem inferior, máximo de 1–2 linhas e agrupamento. Valores são escalados para a resolução de renderização.

Defaults: desativado, CLASSIC, 48 px, branco, destaque amarelo, contorno 2, sombra 1, posição 0,86, margem 80 e 2 linhas. Posição efetiva considera margem inferior e espaço seguro para o texto. Textos excessivos retornam erro em vez de serem cortados silenciosamente.

## 10. SRT

Exportação UTF-8 com acentuação, índices sequenciais e timestamps absolutos `HH:MM:SS,mmm`. Usa as versões selecionadas e os inícios reais das cenas. Exportação independe de as legendas estarem ativadas no MP4.

Nesta versão a exportação utiliza TimelineBuilder e requer imagem e narração selecionadas em todas as cenas para montar a timeline completa. Não utiliza durações estimadas quando faltam assets.

## 11. ASS e fonte

Geração de arquivos ASS temporários com resolução, fonte, cores, posicionamento, contorno, sombra e eventos de destaque. Não interpola timestamps. Texto do usuário fica no arquivo; não entra em comandos shell. Chaves e barras usadas para tags ASS são neutralizadas; UTF-8 e acentos são preservados.

Liberation Sans 2.1.5 Regular/Bold incluída em `api/assets/fonts` e `frontend/public/fonts`, com aviso de copyright e licença SIL Open Font License 1.1. A renderização usa a cópia local no diretório do job. **A implantação deve distribuir `api/assets/fonts` junto com a API**, além de dist e dependências. O build frontend distribui suas fontes em public automaticamente.

## 12. Integração com FFmpeg

Mesmo FfmpegRenderer e MediaProcess (`spawn`, `shell: false`). O filtro ASS é aplicado após o movimento da imagem durante a codificação da cena, evitando uma segunda recodificação completa do vídeo. Concatenação, mixagem, AAC, validação FFprobe, progresso, cancelamento e limpeza continuam no pipeline existente.

Fontes e limites de layout são conferidos no preflight. O worker verifica o filtro libass antes de renderizar legendas. Um FFmpeg customizado sem libass gera erro explícito. Legendas desativadas ou snapshots antigos usam o comportamento anterior.

## 13. Timeline

Não alterou a duração ou posicionamento de cenas, narrações, música ou efeitos. Apenas adiciona o snapshot de legendas. Tempo absoluto = início real da cena + timestamp relativo da narração; offset atual da narração é zero. Transições futuras com sobreposição exigirão atualizar essa conversão junto do renderizador.

## 14. Snapshot e jobs

RenderSnapshot captura ativação, estilo, configurações, ids das versões/áudios, textos, timestamps e palavras, com cópia independente. Alterações posteriores não mudam o render em andamento nem os MP4 históricos.

Alinhamento usa fila PostgreSQL persistida na própria tabela de versões: QUEUED → PROCESSING → READY/FAILED. Um worker com advisory lock, claim atômico e concorrência 1; máximo de 100 jobs ativos/pendentes. Jobs QUEUED retomam após reinício; PROCESSING ambíguos viram FAILED, sem repetir automaticamente uma chamada possivelmente cobrada.

`SUBTITLE_REQUEST_INTERVAL_MS` controla o intervalo mínimo, default 1000 ms, faixa 1000–60000. Para conta de 3 RPM usar 21000. Em HTTP 429 respeita Retry-After antes dos próximos jobs; não faz retry automático do job falhado. Falha continua visível para tentativa explícita. A seleção automática exige que áudio, referência e seleção anterior continuem correspondentes; uma edição feita durante a transcrição não é substituída silenciosamente.

## 15. Endpoints

Base: `/content-projects/:projectId`.

| Método | Caminho | Função |
|---|---|---|
| GET | `/subtitles` | Estado, progresso, configurações, seleções e versões |
| POST | `/scenes/:sceneId/subtitles/generate` | Geração por cena; 202 |
| POST | `/subtitles/generate-missing` | Somente versões faltantes; 202 |
| PATCH | `/subtitle-settings` | Persistir configurações e revisar projeto |
| PATCH | `/scenes/:sceneId/subtitles/:versionId` | Editar com criação de outra versão |
| POST | `/scenes/:sceneId/subtitles/:versionId/select` | Selecionar/confirmar versão revisada; 200 |
| GET | `/subtitles/export/srt` | Download do SRT |

Mutações exigem revision. Regenerar versão pronta por cena exige `replace: true`; confirmação de divergência/desatualização exige `confirmReview: true`. UUIDs, schema, projeto e associações são validados. A ausência de autenticação de usuários continua sendo uma limitação existente.

## 16. Migration

`009_content_subtitles.sql`, aditiva, preserva dados existentes. Runner inclui a migration no journal.

```bash
cd api
npm run migrate:subtitles
```

Aplicada no banco local configurado. O teste em PostgreSQL descartável também aplica a SQL duas vezes para conferir idempotência.

## 17. Arquivos backend

Novo diretório `api/src/content-subtitles`: schema, provider abstrato, adapter OpenAI, agrupamento/snapshot/comparação, formatos, repository, service, controller e três arquivos de testes unitários.

Outros: `009_content_subtitles.sql`, fontes/licença, `test/content/subtitles.integration.cjs`; alterações em ContentAssetsModule, FfmpegRenderer, RenderJob, VideoRenderService, runner de migrations, package.json e .env.example. Três fixtures de testes existentes receberam casts explícitos para permitir a verificação TypeScript completa; sem alteração funcional de produção nesses arquivos.

## 18. Arquivos frontend

Novos: `SubtitleProduction.jsx`, `subtitleService.js`, `test/subtitles.test.mjs`, fontes/licença em public.

Alterados: VisualProduction, VideoProduction, NarrationProduction, index.css, contratos `contentProject.d.ts` e expectativa do teste de imagens, pois legendas deixaram de estar marcadas “Em breve”.

Interface inclui geração por cena/lote, custos explícitos, ativação, presets/configuração, preview, histórico, editor e download SRT. Polling exibe progresso sem bloquear navegação; evita aplicar uma resposta antiga depois de uma edição salva. Edições pendentes bloqueiam renderização e avisam ao sair.

## 19. Testes automatizados

Backend: **38 suites / 280 testes aprovados**, sendo 43 novos testes de legendas. Cobrem provider e granularidade, erros/chave/limite/429, agrupamento, timestamps, versões de áudio, stale, edição, persistência/transações, geração/batch, estilos, SRT, ASS seguro e snapshot.

Frontend: **55 testes aprovados**. Testes de controles, presets, editor, preview/destaque, erros/stale, revisão, bloqueio de render com rascunho e contratos de revision/versão. Infraestrutura existente de testes SSR mantida.

## 20. Build, tipos e lint

Backend build Nest, TypeScript completo e lint sem erros. Frontend build Vite e lint aprovados. Verificação TypeScript dos contratos `.d.ts` aprovada; a aplicação frontend permanece em JavaScript/JSX, como antes. `git diff --check` aprovado.

## 21. Teste real

`npm run test:subtitles:integration`, com `CONTENT_TEST_DATABASE_URL` apontando para PostgreSQL descartável e Chrome instalado. API/Vite/Chrome usam portas 33752/33753/33754; não ocupam a porta 3000 da aplicação.

MP4 real de 5,3 s, 1920×1080, 30 FPS, H.264/AAC, três segmentos, fonte/acento/contorno visíveis. Frames antes e depois não possuem texto; frame em 2,3 s mostra “Um avião desapareceu.”. Inspeção visual e pixels confirmaram centralização, texto entre y=889 e y=928, sem corte.

Fluxo Chrome aprovado: gerar → ativar/preset → editar → acompanhar player de narração → SRT → MP4 real → reproduzir/download → reabrir configurações e histórico. Sem exceções de execução, com larguras 1440/768/390 sem overflow.

Também validado MP4 com música em loop, efeito sonoro e legendas no pipeline completo. O preset DYNAMIC produziu 1201 pixels na cor de destaque no frame da palavra “avião”. Alterar ativação/tamanho da fonte após enfileirar não modificou o snapshot nem a saída desse job. A regressão do renderer anterior também passou: vídeo real de 12,9 s em 1080p, cancelamento, restart, histórico, streaming e limpeza.

Artefatos em `/tmp`: `trends-subtitles.mp4`, `trends-subtitles.srt`, `trends-subtitle-visible.png`, `trends-subtitles-dynamic.mp4`, `trends-subtitle-highlight.png`, `trends-subtitles-production.png`; transcrição simulada, nenhuma chamada OpenAI.

## 22. Limitações

Reconhecimento e timestamps dependem da qualidade do provider e precisam de revisão. Score textual é similaridade entre palavras, não probabilidade acústica nem precisão dos tempos. Upload divergente exige confirmação; roteiro não é substituído.

Editar segmentos remove alinhamento por palavra dessa versão; o original permanece disponível. Sem alinhamento de palavras não há destaque dinâmico. Preview usa a mesma família de fonte e controles, mas navegador e libass têm diferenças de quebra/antialiasing; não é afirmado como resultado idêntico ao MP4.

Não há autenticação de usuários. Fontes devem acompanhar o deployment. Agrupamento novo não reorganiza automaticamente versões existentes. SRT completo requer assets suficientes para timeline. Somente MP3/WAV e o pipeline atual com CUT/offset zero; não introduz transições novas.

## 23. Custos

OpenAI whisper-1: **US$ 0,006/minuto de áudio enviado** segundo [preço oficial](https://developers.openai.com/api/docs/models/whisper-1), verificado em 10/10/2026. Dez minutos de narração total: aproximadamente US$ 0,06 por transcrição completa; o padding silencioso da timeline não é enviado. Quantidade de cenas não define o custo; soma das durações enviadas define a estimativa. Regeneração explícita tem novo custo.

Editar, exportar SRT, revisar, reproduzir ou renderizar usa dados persistidos, sem nova chamada de IA. FFmpeg/libass consome CPU e armazenamento local, sem taxa de API; os custos da máquina/hosting continuam aplicáveis. Testes externos usam mocks e custam US$ 0 em créditos de IA.

## 24. Uso e próximos passos

Reinicie API e frontend após a migration. Abra projeto → Produção → selecione narração → Gerar legendas → revise segmentos/tempos e divergências → escolha estilo → ative legendas → salve → gere nova versão do vídeo. Pode exportar SRT independentemente da ativação. Para versão sem legendas, desative, salve e gere outro vídeo.

Próximos passos dentro da evolução do módulo: avaliar qualidade em uma amostra real de fala brasileira autorizada, ajustar intervalo aos limites da conta, acrescentar autenticação/ownership antes de uso por vários usuários e permitir reagrupar palavras já alinhadas sem retranscrever.
