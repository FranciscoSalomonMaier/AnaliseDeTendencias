# Etapa 4 — movimentos, enquadramento e transições

## Diagnóstico e arquitetura

A implementação anterior já renderizava imagens e narrações com quatro movimentos e cortes. Faltavam transições visuais, pan vertical, configurações persistidas e prévia animada.

Foi preservada a arquitetura `VideoRenderController → VideoRenderService → TimelineBuilder → RenderRepository → FfmpegRenderer → MediaProcess`. Não existe um segundo renderer, provider novo ou chamada paga nesta implementação. Música, TTS, geração de imagens e alinhamento de legendas continuam usando os módulos existentes.

## Transições e sincronização

- `CUT`: preserva a concatenação anterior, sem sobreposição.
- `FADE`: fade-out para preto no fim da cena e fade-in na seguinte. Cada metade usa metade da duração efetiva. As cenas e os áudios não são sobrepostos.
- `CROSSFADE`: o filtro `xfade` mistura a saída da cena com o primeiro enquadramento da próxima imagem. A próxima imagem fica parada durante a transição e começa seu movimento quando sua própria cena inicia. A composição é feita no segmento anterior, antes da concatenação final.

A timeline mantém os mesmos inícios das narrações e a mesma duração total. Não subtrai a duração do crossfade. Música, efeitos e legendas mantêm seus timestamps absolutos. Legendas são aplicadas depois da composição visual e não aparecem antecipadamente na imagem de entrada.

A duração solicitada é global por projeto, entre 0 e 2 segundos, com default centralizado de 0,5 s. A duração efetiva é quantizada em frames e limitada pelo silêncio disponível após a fala, pela metade da cena atual e pela metade da próxima. Menos de dois frames resulta em CUT explícito. Uma única cena não recebe transição.

Exemplo a 30 FPS: narração de 3 s e padding de 0,3 s produz uma cena de 3,3 s. Um crossfade solicitado de 0,5 s usa 0,3 s, de 3,0 a 3,3 s. A próxima narração continua começando em 3,3 s. O frontend mostra a duração efetiva e informa quando a pausa é insuficiente.

## Movimentos e enquadramento

Presets: `SLOW_ZOOM_IN`, `SLOW_ZOOM_OUT`, `PAN_LEFT`, `PAN_RIGHT`, `PAN_UP`, `PAN_DOWN`, `STATIC`. `AUTO` representa a escolha solicitada, não um filtro adicional.

A seleção automática é determinística, alterna zoom e pan e evita repetição consecutiva. Imagens em retrato usam pans verticais; as demais mantêm a alternância horizontal. Não existe análise semântica, reconhecimento facial ou seleção por LLM.

Os novos snapshots usam interpolação smoothstep (`t² × (3 − 2t)`) com entrada e saída suaves. A amplitude é configurável por cena entre 0 e 8%, com default de 5%. Os cálculos respeitam os limites de `zoompan`. Snapshots antigos sem o campo `easing` continuam com movimento linear.

Modos de enquadramento:

- `CONTAIN`: imagem inteira com possíveis faixas pretas.
- `COVER`: preenchimento com recorte central, habilitando movimentos com amplitude limitada.
- `BLURRED_BACKGROUND`: fundo ampliado/desfocado da mesma imagem com primeiro plano inteiro, implementado com Sharp.

Overrides explícitos em CONTAIN ou BLURRED_BACKGROUND usam STATIC quando há movimento solicitado: mover o quadro inteiro recortaria o primeiro plano que esses modos devem preservar. O motivo fica registrado e visível. Para movimentar uma cena, selecione COVER. Cenas antigas sem override preservam o comportamento anterior de contain com movimento.

COVER não garante preservar um rosto ou objeto próximo das bordas; o recorte central é uma escolha explícita. Visão computacional permanece fora do escopo.

## Fallback e erros

Há fallback geométrico registrado no snapshot para preservar a imagem inteira ou amplitude zero. Durante o processamento existe uma única tentativa adicional com STATIC apenas para erros reconhecidos de avaliação/parsing da expressão de `zoompan`.

Erros de imagem corrompida, áudio, storage, disco, permissão, timeout, cancelamento e falhas gerais do FFmpeg não são convertidos em sucesso. Filtros de transição ausentes produzem mensagem explícita para selecionar CUT ou configurar FFmpeg compatível.

O snapshot efetivo é persistido na conclusão do job, incluindo eventual fallback. Vídeos anteriores e assets originais não são apagados. As pastas de trabalho são removidas em `finally`.

## Persistência e compatibilidade

A migration aditiva `010_content_project_editing.sql` cria `content_project_editing`, com configurações JSONB por projeto. O runner existente foi atualizado; comando: `npm run migrate:editing` ou `npm run migrate:renders`, dentro de `api`.

Há revisão própria das configurações de edição para rejeitar salvamentos concorrentes. Projeto e cena são validados; overrides de cenas removidas são omitidos ao carregar o formulário. Salvar edição não invalida roteiro, imagens, áudio ou legendas.

Cada novo RenderJob captura `schemaVersion: 2`, configurações solicitadas, movimento efetivo, enquadramento, amplitude, transição efetiva e seus timestamps. Os novos campos são opcionais para leitura de snapshots antigos. Histórico não é migrado nem reescrito.

## Endpoints

- `GET /content-projects/:projectId/render-settings`
- `PATCH /content-projects/:projectId/render-settings`: `{ revision, settings }`; `settings` inclui sua própria `revision`.
- `POST /content-projects/:projectId/render-preview`: `{ revision, editingRevision?, sceneId? }`.
- `POST /content-projects/:projectId/renders`: preservado, com `editingRevision` opcional para validação adicional.

IDs de projeto/cena, revisões e configurações são validados. O repositório atual não possui autenticação/ownership de usuários; esta tarefa não acrescenta uma camada de identidade. Portanto, isolamento por projeto não equivale a autorização por usuário.

## Frontend e prévia

O layout existente foi mantido. Em Montagem do vídeo há controles de transição, duração e, por cena, movimento, enquadramento e amplitude. São mostrados o movimento efetivo, fallback e duração efetiva das transições. Alterações não salvas bloqueiam a geração.

A prévia cria um RenderJob pela mesma fila e pelo mesmo renderer, com até duas cenas a partir da escolhida, 640×360, áudio silenciado, sem mixagem ou legendas e até 3 s por cena. É identificada como prévia no histórico. Respeita concorrência, cancelamento, progresso, validação e download existentes.

A prévia acelera o movimento completo e pode usar uma transição maior que a pausa disponível na montagem final. Essas diferenças são informadas na interface; ela serve para avaliar trajetória, enquadramento e tipo de transição, não para revisar sincronização de fala. O vídeo final preserva os tempos completos.

Cartões de imagens usam a timeline real quando disponível e identificam estimativas quando não há duração real. O editor de planejamento identifica explicitamente a duração como estimada.

## Performance

Crossfade usa somente a imagem seguinte, com o primeiro enquadramento congelado, em um grafo por segmento. Não abre todas as cenas em um único processo. Os segmentos continuam H.264/PCM; o fechamento continua copiando vídeo e codificando AAC uma única vez. FADE e CROSSFADE são processados na codificação de cada segmento.

A preparação continua em 2× a resolução de saída. Fundo desfocado exige uma composição Sharp adicional e mais memória transitória. Permanecem os limites de concorrência, threads, duração, timeout, arquivo e espaço livre. Prévia compete pela mesma fila, evitando processos extras sem limite.

Não foi executado benchmark de carga concorrente em produção; testes curtos não comprovam consumo máximo de RAM ou qualidade cinematográfica em vídeos longos.

## Testes e evidências

Validações realizadas nesta implementação:

- TypeScript e build backend.
- Suíte backend: 43 suítes, 332 testes aprovados.
- Frontend: lint, build e 9 arquivos de testes aprovados.
- `test:editing:integration`: FFmpeg real, sem banco ou APIs externas.
- Sete movimentos: 60 frames por vídeo, posição/tamanho dos marcadores, sentido e deslocamento entre frames.
- CUT, FADE e CROSSFADE: frames reais verificam manutenção da cena, aproximação de preto e mistura de cores.
- Nove combinações de proporção/enquadramento: 16:9, 1:1 e 9:16, com renderização e verificação de dimensões/faixas.
- Três cenas com narrações sintéticas distintas, música, efeito e legendas: posição das frequências, pausas entre falas, offset do efeito, música no fim e presença da legenda.
- Snapshot antigo e rejeição de imagem corrompida; limpeza das pastas de trabalho.
- `test:audio-mix:timestamps`: 16 s esperados e obtidos; mantém posição da voz e música até o fim.

Evidências FFmpeg em `/tmp/trends-editing-E2849x`: MP4s, frames extraídos e `evidence.json`. São artefatos temporários locais, não versionados. A inspeção visual de frames complementa as medições; não constitui comprovação subjetiva de qualidade cinematográfica.

As integrações PostgreSQL/HTTP e Chrome de renders, música/efeitos e legendas passaram. Verificam persistência, conflito de revisão, snapshot histórico imutável, geração da prévia, alteração e reabertura das escolhas, player, download e layout em 1440/768/390 px. Os testes abrem os painéis retráteis antes de interagir. O encerramento dos bancos descartáveis aguarda a liberação das conexões, sem DROP FORCE. A migration 010 também foi aplicada no banco configurado do desenvolvimento, pelo runner existente.

## Principais arquivos

Backend: `video-render/{editing-settings.ts,editing.repository.ts,timeline.builder.ts,ffmpeg.renderer.ts,render-job.ts,render-settings.ts,render.repository.ts,video-render.service.ts,video-render.controller.ts}`, registro no `content-assets.module.ts`, migration 010 e runner.

Frontend: `VideoEditingControls.jsx`, `VideoProduction.jsx`, `VisualProduction.jsx`, `ScenesStep.jsx`, `videoRenderService.js`, tipos e utilitários de tempo/nomes de movimentos.

Testes: `timeline.builder.spec.ts`, `ffmpeg-fallback.spec.ts`, `editing.integration.cjs`, `renders.integration.cjs`, `videoRenders.test.mjs` e `contentStudioTime.test.js`.

Próxima etapa recomendada: avaliar vídeos reais longos e ajustar enquadramento/amplitude conforme o material; edição semântica avançada permanece uma etapa futura.
