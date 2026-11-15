# Video Remix — Etapa 6: revisão final, exportação e preparação para publicação

## Entrega

A seção **Revisão Final**, após **Montagem e Edição**, permite assistir às versões renderizadas, navegar pelos cortes, registrar avaliações pessoais, comparar versões de um ou mais projetos, validar arquivos e preparar exportações com metadados editáveis. A Etapa 5 continua responsável pela montagem; esta etapa não cria outro motor de renderização e não publica vídeos automaticamente.

Funcionalidades:

- Player nativo com controles, volume, seek, tela cheia, vídeo vertical, carregamento e erro compreensível.
- Histórico numerado por projeto, com prévias/finais, status, versão atual concluída, duração, resolução, FPS, tamanho e datas. O contador é monotônico mesmo após exclusões.
- Referência ao roteiro/revisão, timeline e áudios imutáveis utilizados. Novas renderizações também preservam modo, título, tema, idioma e origens/licenciamento no snapshot.
- Timeline de revisão com miniaturas, fonte, tempos da fonte separados dos tempos no vídeo, duração, texto narrado e enquadramento. **Ver trecho** navega o player para o início correspondente.
- **Ajustar cortes, áudio e legendas** abre a timeline no editor existente. Se houver edição pendente, ela é preservada e o editor informa que é necessário salvar ou descartar antes de trocar de timeline.
- O editor da Etapa 5 mantém cortes, reordenação, exclusão, enquadramento, transições, volumes, silêncio da faixa original, legendas e tempos manuais. Salvar cria nova timeline; renderizar cria outro arquivo, sem alterar o anterior.
- A revisão oferece reescrita individual de segmento pelo serviço de roteiro da Etapa 4, com consentimento para a chamada de IA. Depois da reescrita, o usuário confere o roteiro e gera a narração no painel existente, criando uma timeline atualizada.
- Versões concluídas continuam reproduzíveis depois de alterações do roteiro. Fontes e áudios da versão histórica precisam continuar disponíveis e autorizados. Edição/renderização de uma timeline desatualizada permanece bloqueada.
- Comparação A/B entre versões do mesmo projeto ou de projetos diferentes. Permite comparar SINGLE_SOURCE e MULTI_SOURCE com players independentes, fontes/cortes, duração, tamanho, processamento, configurações, avisos e avaliações.
- Avaliações pessoais de 1 a 5 para coerência visual, cortes, narração, legendas e resultado geral, além de notas. Critérios sem avaliação permanecem nulos; não há pontuação automática de qualidade.
- Exclusão autorizada de versões antigas e de preparações de exportação. Referências de exportações e jobs ativos impedem excluir uma renderização em uso.
- Exportação com presets YouTube Shorts, Instagram Reels e TikTok, ou formato personalizado vertical. Metadados ficam vinculados à exportação e sua plataforma.

## Arquitetura e reutilização

A revisão inicial identificou:

- `RemixAssemblyService`, `RemixAssemblyRenderer`, `RemixAssemblyWorker`, timelines em JSONB e MP4 privados em `video_remix_exports`.
- `MediaProcess`, `RenderSettings`, FFmpeg/FFprobe estáticos, HTTP Range e `StorageProvider` com cópia/streaming.
- Editor `RemixAssemblyPanel`, editor de roteiro/narração e serviços de API do Video Remix.
- `PublicationService` e schemas de publicação, além de OAuth, canais, `YoutubePublicationService`, `YoutubeUploadService` e worker de publicação existentes.
- O publicador atual referencia projetos/renderizações do módulo de Criação de Conteúdo, não registros Video Remix. Enviar IDs Remix diretamente para ele seria incorreto.

A implementação reutiliza o motor da Etapa 5, a execução de processos, limites, storage, autenticação e isolamento. O novo worker executa **validação e conversão de arquivo existente**, não montagem de cenas. Compartilha o advisory lock de processamento da Etapa 5, impedindo montagem e conversão Remix simultâneas entre instâncias. A admissão das duas filas também compartilha o lock e o limite de jobs pendentes/ativos.

Os validadores de título e normalização de hashtags do módulo de publicação são reutilizados. Sugestões por IA usam `LlmProvider` e a configuração de modelo do roteiro. Não foram duplicados autenticação OAuth, credenciais, clientes YouTube, serviços de voz ou APIs de publicação.

Exportações e metadados possuem IDs e referências estáveis que permitem um futuro adaptador para o publicador existente. Esta etapa não habilita upload, agendamento ou novas integrações Instagram/TikTok. A interface informa essa separação e não oferece um botão fictício de publicação.

## Validação técnica

A validação ocorre em background. O relatório tem data, mídia verificada e mensagens `ERROR`, `WARNING` ou `INFO`.

Verificações:

1. Renderização concluída e arquivo privado existente com tamanho correspondente ao registro.
2. Fontes importadas atualmente autorizadas, mesmos arquivos associados aos cortes e narrações históricas disponíveis.
3. Timeline sem lacunas visuais, intervalos inconsistentes ou cobertura insuficiente.
4. FFprobe: container MP4, H.264, AAC, dimensões, FPS, duração do container e durações das faixas de vídeo e áudio.
5. Compatibilidade da duração com a timeline, tolerando apenas pequenos arredondamentos de frame/mux.
6. Limite de tamanho configurado.
7. Decodificação integral com FFmpeg e `-xerror` para detectar falhas de integridade.
8. Hash SHA-256 calculado por streaming e registrado no relatório válido.
9. Detecção de quadros escuros e silêncio prolongado com filtros FFmpeg; resultados são **avisos**, pois podem ser intencionais.
10. Legendas com tempos aproximados são sinalizadas para revisão humana.

Erros impedem criar uma exportação pronta. Relatórios de validação com erro ficam disponíveis sem apresentar um arquivo como concluído. Avisos pedem revisão, sem afirmar que conteúdo escuro/silencioso é defeituoso. A validação não prova coerência narrativa, precisão das legendas ou titularidade de direitos.

## Presets, reutilização e conversão

Presets centralizados em `remix-review.schema.ts`:

| Destino | Resolução | FPS | Arquivo |
| --- | --- | --- | --- |
| YouTube Shorts | 1080×1920 | 30 | MP4 / H.264 / AAC |
| Instagram Reels | 1080×1920 | 30 | MP4 / H.264 / AAC |
| TikTok | 1080×1920 | 30 | MP4 / H.264 / AAC |

São configurações iniciais de formato, sem garantia permanente de aceitação. Não foram codificados limites de duração de plataformas. Confira as regras atuais no momento de publicar.

Personalizado: 540×960, 720×1280 ou 1080×1920; 24/30 FPS; qualidade alta, padrão ou arquivo menor. Continua MP4/H.264/AAC.

O worker valida o arquivo selecionado e:

- Reutiliza os mesmos bytes quando o arquivo já atende ao formato. A preparação referencia a renderização original, sem copiar outro MP4.
- Faz conversão simples de resolução/FPS/qualidade somente quando necessário, preservando a duração e sem refazer análise, roteiro, TTS, cortes ou efeitos.
- Pode compartilhar um arquivo já convertido entre preparações compatíveis de plataformas diferentes. Revalida o arquivo compartilhado antes de utilizá-lo.
- Reutiliza a preparação concluída quando a solicitação é idêntica e o arquivo continua disponível. Jobs idênticos ativos também são deduplicados.
- Ao ampliar uma prévia para 1080×1920, avisa sobre a ampliação. Para maior detalhe, prefira selecionar uma renderização final da Etapa 5.

O nome de download contém título normalizado, modo, versão e parte do identificador interno, evitando colisões e caracteres inseguros. Reprodução/download usam sessão local, autorização e HTTP Range.

## Metadados e publicação futura

Cada preparação contém plataforma, arquivo, preset, validação e metadados com revisão otimista:

- Título e descrição.
- Hashtags normalizadas e sem duplicatas.
- Idioma e categoria opcional.
- Status DRAFT ou READY, que significa revisão dos metadados, não publicação na plataforma.

Para marcar READY, título/descrição precisam estar preenchidos e o arquivo/fontes precisam estar acessíveis. A edição concorrente com revisão antiga é rejeitada.

A geração por IA é opcional, explícita e assíncrona. Usa tema e roteiro da versão renderizada, idioma e plataforma da exportação. As instruções proíbem inventar fatos e hashtags irrelevantes. O resultado é apresentado como **sugestão para revisão humana**, com modelo/provedor/consumo reportados no job. Não sobrescreve os metadados salvos. **Aplicar sugestão no formulário** ainda exige salvar explicitamente.

Não houve chamada paga de IA durante os testes. Fixtures de metadados usam um provider de teste; a produção usa o provider configurado existente.

## Persistência e migration

Migration: `api/migrations/020_video_remix_review.sql`.

- Acrescenta número de versão às renderizações e contador monotônico no projeto; preserva registros anteriores.
- `video_remix_reviews`: avaliações e notas por renderização.
- `video_remix_finalization_jobs`: validação, exportação e sugestões de metadados, status/progresso/resultados.
- `video_remix_deliveries`: exportações prontas, presets, referências/arquivos, relatório e metadados.
- `video_remix_review_events`: registro de solicitações, conclusão, avaliações, edição e exclusões.
- Índices da fila e trigger para limpeza de arquivos de exportação removidos.

Os itens da timeline continuam no JSONB existente; não foi criada outra representação de montagem. A contagem de ajustes corresponde a salvamentos manuais de timeline registrados nesta etapa. Timelines antigas sem essa informação exibem “não registrado”, sem inventar números.

Aplicar:

```bash
cd api
npm run migrate:remix-review
```

A migration 020 foi aplicada no banco local durante a implementação. O teste de integração aplica as migrations duas vezes. Não há nova dependência npm, Redis ou serviço externo.

## Configuração

Não há variável nova obrigatória. Reutiliza:

- `DATABASE_URL`, `CONTENT_ACCESS_KEY`, `CONTENT_OWNER_ID`, `CONTENT_STORAGE_PATH`.
- `FFMPEG_PATH`/`FFPROBE_PATH`, quando não utilizados os executáveis dos pacotes existentes.
- `VIDEO_RENDER_TEMP_DIR`, `VIDEO_RENDER_TIMEOUT_MS`, `VIDEO_RENDER_MAX_QUEUED`, `VIDEO_RENDER_MIN_FREE_MB`, `VIDEO_RENDER_MAX_FILE_MB`.
- `OPENAI_API_KEY` e `VIDEO_REMIX_SCRIPT_MODEL` (fallback do modelo da análise), apenas para sugestões/reescrita solicitadas pelo usuário.
- `VIDEO_REMIX_SCRIPT_MAX_JOBS_PER_PROJECT`, também usado para limitar solicitações de sugestões por IA.
- Configuração existente `VITE_API_URL` no frontend.

Nenhuma chave ou `.env` foi alterado. A preparação não cria credenciais de plataforma e não interfere no fluxo existente de publicação.

## Como usar

1. Abra o projeto Video Remix e conclua ao menos uma prévia ou renderização da Etapa 5.
2. Expanda **Revisão Final**. Se acabou de renderizar, use **Atualizar revisão final**. Selecione a versão desejada.
3. Reproduza o vídeo. Em **Timeline utilizada**, use **Ver trecho** para conferir cada corte e sua fonte.
4. Para corrigir cortes, volumes ou legendas, clique em **Ajustar cortes, áudio e legendas**. Salve outra timeline e gere nova prévia/final no editor existente.
5. Para reescrever um segmento, abra a seção correspondente, autorize a chamada de IA e solicite a reescrita. Confira o resultado em **Roteiro e Narração**, gere o áudio e crie a nova timeline.
6. Em **Avaliação manual**, registre notas e observações; nenhum critério recebe nota automática.
7. Em **Comparar versões e modos**, escolha projeto/versão B e clique em **Comparar A e B**. Ambos os players são independentes. Para SINGLE_SOURCE versus MULTI_SOURCE, escolha projetos nos modos correspondentes.
8. Em **Exportar Vídeo**, selecione o preset. **Validar vídeo** consulta a validação em background; **Preparar exportação** também valida antes de reutilizar/converter o arquivo.
9. Aguarde a conclusão real. A preparação aparece em **Exportações e metadados para publicação**, com player, resolução, FPS, tamanho, relatório e **Baixar exportação MP4**.
10. Edite e salve título, descrição, hashtags, idioma e categoria. Se quiser sugestões por IA, autorize a chamada e revise a sugestão antes de aplicar/salvar. Nenhum vídeo é publicado.

## API

Prefixo: `/video-remix/projects/:projectId/review`.

| Método e caminho | Operação |
| --- | --- |
| `GET /renders` | Histórico, métricas e versão atual concluída |
| `GET /renders/:id` | Revisão, timeline, fontes e avaliação |
| `GET /renders/:id/compare?projectId=...&renderId=...` | Comparação A/B, autorizando ambos os projetos |
| `PATCH /renders/:id/rating` | Avaliação manual com revisão otimista |
| `DELETE /renders/:id` | Excluir versão sem referências/atividade |
| `GET /presets` | Presets e opções disponíveis |
| `POST /renders/:id/jobs` | Enfileirar VALIDATE, EXPORT ou METADATA, com `confirm: true` |
| `GET /jobs` | Status, progresso, relatórios e sugestões |
| `POST /jobs/:id/cancel` | Cancelar job pendente/ativo |
| `GET /deliveries` | Exportações concluídas e metadados |
| `PATCH /deliveries/:id/metadata` | Salvar metadados com revisão otimista |
| `DELETE /deliveries/:id` | Excluir preparação e liberar arquivo sem outras referências |
| `GET /deliveries/:id/file` | Player privado com Range |
| `GET /deliveries/:id/file?download=1` | Download com nome seguro |

A edição de timeline, narração e renderização continua nos endpoints existentes das Etapas 4/5.

## Arquivos

Criados:

- `api/migrations/020_video_remix_review.sql`
- `api/src/video-remix/remix-review.schema.ts`
- `api/src/video-remix/remix-review.service.ts`
- `api/src/video-remix/remix-review.media.ts`
- `api/src/video-remix/remix-review.worker.ts`
- `api/src/video-remix/remix-review.controller.ts`
- `api/src/video-remix/remix-review.spec.ts`
- `api/test/video-remix/remix-review.integration.cjs`
- `api/test/video-remix/remix-review.browser.cjs`
- `frontend/src/pages/VideoRemix/RemixReviewPanel.jsx`
- `frontend/test/remixReview.test.mjs`
- Este relatório.

Modificados:

- `api/package.json`: comandos de migration/integração.
- `api/scripts/migrate-assets.cjs`: inclui 020.
- `api/src/video-remix/video-remix.module.ts`: registra revisão e worker.
- `api/src/video-remix/remix-assembly.service.ts`: histórico autorizado independente da revisão atual do roteiro, versões e fila compartilhada.
- `api/src/video-remix/remix-assembly.worker.ts`: preserva snapshot de origem junto aos metadados técnicos.
- `api/src/video-remix/remix-assembly.schema.ts` e `remix-timeline.builder.ts`: contagem de salvamentos manuais.
- `api/src/video-remix/remix-files.service.ts`: protege arquivos compartilhados pelas preparações na limpeza.
- `api/test/video-remix/remix-assembly.integration.cjs`: inclui migration 020 no ambiente de teste da Etapa 5.
- `frontend/src/pages/VideoRemix/RemixAssemblyPanel.jsx`: abre a timeline solicitada pela revisão sem perder edição pendente.
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`: integra revisão e navegação aos editores existentes.
- `frontend/src/services/videoRemixService.js`: operações da revisão/exportação.
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`: link da etapa.

## Testes

- API: **585 testes em 53 suítes**.
- Frontend: **109 testes**.
- Builds da API/frontend, lint dos arquivos TypeScript alterados e lint do frontend.
- Integração PostgreSQL descartável + FFmpeg/FFprobe reais: migrations idempotentes, histórico numerado, comparação SINGLE_SOURCE/MULTI_SOURCE, avaliações/revisões concorrentes, validação completa, reutilização sem cópia, conversão de resolução/FPS, compartilhamento entre plataformas, metadados manuais, sugestões isoladas com provider de teste, reprodução histórica após alteração do roteiro, avisos de preto/silêncio intencionais, erro por arquivo ausente/falha de processo, cancelamento pendente/ativo, direitos atuais, propriedade, Range, nomes seguros, exclusão protegida, limpeza e cascade do projeto.
- Chrome real: player, seek pelos trechos, avaliação, comparação entre projetos, exportação e edição de metadados, com layout em 1440/768/390 pixels.
- Integração completa da Etapa 5 executada novamente e aprovada, incluindo FFmpeg real e navegador.
- As fixtures são cores e tons/silêncio sintéticos. Nenhuma API externa paga é consumida nos testes.

Comandos:

```bash
cd api
npm run build
node node_modules/jest/bin/jest.js --config jest.ai-cache.config.cjs --runInBand
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55444/postgres npm run test:remix-review:integration
```

A URL da integração deve ser de PostgreSQL **descartável**, com permissão para criar/remover bancos, nunca produção. O script cria um banco próprio e o remove ao terminar. O teste de navegador usa `google-chrome` e as portas 33873/33874. Evidências ficam em `/tmp/trends-remix-review-*`.

No frontend: `npm test`, `npm run build`, `npm run lint`.

## Limitações e cenário GTA Vice City

Não foi executada uma exportação de gameplay real do GTA nesta entrega. A validação automatizada utiliza fixtures; não representa o easter egg ou uma avaliação de narrativa real.

Para o teste completo, prepare dois projetos com o tema **“GTA Vice City — Easter Egg do ovo de Páscoa”**: SINGLE_SOURCE com um gameplay autorizado e múltiplos cortes; MULTI_SOURCE com gameplays autorizados de fontes diferentes. Complete seleção visual, roteiro validado, narração pt-BR, legendas e montagem 9:16 nas etapas anteriores.

Na revisão do vídeo A, escolha o vídeo B na comparação. Reproduza os cortes, confira o acontecimento e as fontes, sincronização da voz, legendas e enquadramento. Registre notas manuais de 1 a 5 para ambos. Se necessário, corrija no editor e renderize outra versão. Selecione o resultado preferido, valide, prepare YouTube Shorts e salve título, descrição e hashtags fiéis ao que o vídeo mostra. Baixe o MP4 e compare os relatórios/avaliações. Não há envio automático.

Outros limites:

- Legendas automáticas continuam aproximadas conforme a Etapa 5; validação técnica não é alinhamento fonético nem revisão semântica.
- As listas de renderizações, jobs e preparações retornam até 100 registros recentes por projeto.
- Os players de comparação são independentes; não há sincronização complexa de reprodução.
- A disponibilidade histórica depende da permanência dos arquivos e das autorizações atuais. Revogar uma fonte bloqueia arquivos derivados.
- Não há upload novo, Instagram/TikTok, agendamento, pontuações subjetivas automáticas ou garantia de ausência de reivindicações de copyright. Declaração de autorização não é prova automática de titularidade.
- Operações interrompidas/falhas podem ser solicitadas novamente. Não há retentativa automática infinita; sugestões por IA podem ter consumo parcial e exigem nova ação explícita.
- O acesso de proprietário continua o modo local configurado, sem introduzir novo sistema de login.
- O build do frontend mantém o aviso existente de tamanho do bundle; ele não impede a geração.

Nenhuma etapa posterior foi iniciada.
