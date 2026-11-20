> Evolução posterior: o fluxo agora tem nove etapas, com Trilha sonora antes de Renderizar. Música própria/autorizada pode ser enviada manualmente; isso não muda a análise acústica das referências. Veja [Trilha sonora](IMPLEMENTACAO_TRILHA_SONORA_SHORTS.md).

# Referências de Edição — Criar Short

Implementação opcional no fluxo existente `?page=create-short`. Não cria módulo independente, biblioteca global, pesquisa no YouTube ou publicação automática.

## Usar

1. Crie e aprove o roteiro.
2. Envie os vídeos **para montagem**.
3. Em **Referências de Edição**, declare autorização e envie MP4, MOV ou WebM de exemplo. Escolha as características e clique em **Analisar referências**. A análise consome API, roda na fila e não começa ao abrir a página.
4. Revise as métricas, as limitações e os parâmetros sugeridos; salve os ajustes e clique em **Continuar**. Entonação é uma escolha manual nesta versão.
5. Gere/revise o texto, aprove e gere a narração. Ouça a voz antes de avançar.
6. Solicite a montagem, revise cortes, textos informativos e avisos de sincronização; aprove.
7. Gere o vídeo. A renderização incorpora os estilos aprovados.
8. Visualize/baixe o MP4 em **Armazenar vídeo**.

**Pular etapa** mantém a montagem básica anterior. É possível pular após falha. Trocar/aplicar/desativar um estilo já aplicado invalida texto, áudio e montagem dependentes; gere-os novamente. Pular sem ter aplicado estilo preserva os dados do fluxo anterior.

Os arquivos de referência têm papel `REFERENCE`, upload, listagem e streaming separados. A seleção de cenas e o render recebem exclusivamente arquivos `SOURCE`. Não se copia áudio, frames, texto, fatos ou identidade vocal das referências para o resultado. A transcrição das referências serve somente às métricas, não ao roteiro nem aos overlays.

## Análise e aplicação efetivas

| Característica | Análise | Aplicação no Short |
| --- | --- | --- |
| Velocidade | Palavras/minuto médias e durante os intervalos narrados, usando transcrição com timestamps | Orçamento de palavras no texto e velocidade TTS moderada (0,8–1,25). A duração real do áudio determina o vídeo; não é promessa de duração exata |
| Pausas | Quantidade e média dos intervalos sem fala; aproximação se apenas segmentos estiverem disponíveis | Orientação de pausas naturais ao modelo; não se garante duração exata das pausas |
| Entonação/estilo/intensidade | Não inferidos do áudio nesta entrega; registrados como limitação | Usuário escolhe estilo; instruções de produção ao TTS, sem clonagem |
| Cortes | FFmpeg: quantidade, média, mediana, frequência/minuto, coeficiente de variação e distribuição por quartos do trecho | Duração de planos influenciada pela mediana consolidada; usa fins de frases/grupos reais quando disponíveis e variação limitada. Modo básico alterna fontes já selecionadas, preservando cronologia por arquivo; modo semântico preserva a ordem de relevância |
| Legendas | IA sobre amostras sequenciais: presença, posição, fonte aproximada, peso, cores, contorno, sombra, grupo, destaque/animação, quando observáveis | ASS/libass: poucas palavras, cores, tamanho, posição, contorno, sombra, destaque da palavra narrada com seus timestamps reais |
| Textos informativos | Presença, posição, frequência e tipos estimados | Novos rótulos de até seis palavras gerados exclusivamente do roteiro/narração atuais; tempos ancorados em unidades reais, até três itens, posições separadas das legendas e fade |
| Zoom | Aproximação/afastamento estimados somente com sequências do mesmo grupo | Zoom suave central limitado a 6%, ocasional, em momentos com overlay ou trecho central; não em todos os planos |
| Transições | Corte/fade/crossfade estimados quando observáveis | Corte seco; fade inicial e final. Crossfade não aplicado neste motor de Shorts |
| Música e efeitos sonoros | **Não identificados** nesta versão; não se presume sua presença | Não são extraídos das referências. Música autorizada pode ser enviada manualmente na etapa Trilha sonora; efeitos sonoros continuam fora do fluxo |

As métricas numéricas são calculadas. Características visuais são estimativas multimodais com confiança declarada e propriedades desconhecidas (`null`); não são medições exatas de fonte/movimento. Resultados visuais com confiança abaixo de 0,6 não ativam efeitos automaticamente. Defaults para propriedades desconhecidas são parâmetros de aplicação, explicitamente identificados na revisão, não resultados observados.

Cada arquivo tem perfil próprio. A consolidação escolhe valores numéricos observados representativos, sem média artificial entre estilos; categorias exigem maioria. Divergências são avisadas. A configuração é validada por Zod e só é aplicada após aprovação; características desmarcadas não se aplicam.

## Arquitetura reutilizada

- `ShortService`, `ShortWorker`: propriedade, revisões, fila PostgreSQL com advisory lock, progresso, limites de tarefas, registro de consumo, falhas e limpeza persistente.
- `RemixAnalysisMedia`: FFprobe, hash, detecção de cortes e JPEGs limitados. Amostras em pequenos grupos sequenciais, sem envio indiscriminado de frames.
- `LlmProvider`: saída estruturada multimodal, validação, sem retentativa paga automática.
- `SpeechAlignmentProvider`: implementação existente OpenAI/Whisper para transcrição e alinhamento. Sem timestamps confiáveis não são fabricados tempos de palavras.
- `RemixVoiceService`/`TtsProvider`: mesma voz configurada, instruções opcionais e medição real do áudio.
- `subtitle.builder` e `subtitle.formats`: agrupamento, margens seguras, escape ASS e destaque sincronizado.
- `ShortMedia`, `MediaProcess`, FFmpeg/FFprobe: render privado 1080×1920, H.264/AAC, 30 FPS, crop/blur, zoom/fade e legendas.
- Storage privado e guard de acesso existentes, sem caminhos internos nas respostas.

Endpoints novos: `POST /shorts/:id/references`, `GET /shorts/:id/references/:fileId`, `DELETE /shorts/:id/references/:fileId`. A operação assíncrona é `POST /shorts/:id/jobs` com `kind: REFERENCES`, revisão e confirmação. Ajustes, aprovação `EDITING` e `skipReferences` usam o `PATCH /shorts/:id` existente.

Cache por projeto, hash do arquivo, modelo, versão do analisador, seleção e limites. Arquivos idênticos no mesmo projeto reutilizam a análise. A transcrição de referência não é mantida no perfil. Reprocessar uma análise incompleta pode consumir API novamente; resultados completos por arquivo já salvos podem ser reaproveitados.

## Migration e configuração

Sem novas dependências npm. Requer FFmpeg com libass, zoompan e fades, já presentes no binário utilizado nos testes.

Com a API parada ou sem tarefas ativas, execute no diretório `api`:

```bash
npm run migrate:shorts
npm run migrate:short-references
npm run start:dev
```

`022_short_editing_references.sql` adiciona papel em `short_files`, tabela `short_reference_analyses`, job `REFERENCES` e oito etapas. Converte projetos antigos avançando etapas 3–7 uma única vez, preservando dados e resultados. É idempotente e recusa a primeira aplicação se houver tarefas em andamento. Não modifica tabelas de outros módulos.

Reutiliza `OPENAI_API_KEY`, modelo de `ShortSettings` (deve aceitar visão e Structured Outputs), `TTS_*`, storage e banco existentes. Variáveis opcionais em `.env.example`:

```dotenv
SHORT_REFERENCE_MAX_FILES=3
SHORT_REFERENCE_MAX_SECONDS=90
SHORT_REFERENCE_MAX_FRAMES=12
SHORT_REFERENCE_MAX_TOKENS=12000
```

São até três referências, 90 segundos e o limite de bytes existente por arquivo. O upload rejeita duração acima do limite. Até 12 frames por referência, agrupados em sequências de três. O limite de tokens interrompe chamadas visuais posteriores quando o consumo reportado exceder o teto; não é um orçamento financeiro exato nem inclui tokens de áudio/transcrição. Transcrição de referências, alinhamento da narração e geração de rótulos geram consumo adicional. A montagem informa isso antes de ser solicitada.

## Limitações

- Amostragem não observa tudo. Estimativas de zoom podem confundir câmera, objetos e movimento; revisão humana continua necessária.
- Entonação, intensidade, ênfase original, música e efeitos não são extraídos automaticamente. Os seletores de áudio indicam a limitação, sem prometer detecção.
- O controle de velocidade TTS é aproximado; a voz pode durar mais ou menos que o alvo. O render usa o tempo efetivamente medido.
- Sem timestamps de palavras válidos, legendas usam segmentos reais e perdem o destaque palavra a palavra. Não se distribuem palavras artificialmente.
- Apenas um trecho contínuo não contém necessariamente mudanças visuais: subdividi-lo não cria novos acontecimentos. A alternância depende de haver material adequado; o modo básico não entende semântica. No modo semântico, a ordenação por relevância tem prioridade sobre alternar fontes.
- Fins de grupos de legendas são âncoras aproximadas de frases. A alternância básica pode deslocá-las. Não há alinhamento semântico de cada afirmação com cada corte.
- Overlays usam prompt restrito e rejeitam números ausentes no roteiro/narração. Isso reduz erros, mas não substitui revisão factual; nomes e afirmações do próprio roteiro não são verificados na web.
- Sem crossfade, efeitos de região/rostos, animações complexas ou biblioteca de áudio. Módulos antigos possuem mixagem, mas seus assets pertencem a outros projetos/fluxos; não são importados implicitamente para Criar Short.

## Testes e comparação A/B

```bash
# api
npm run test:shorts
npm run test:short-editing
npm run build
# Banco PostgreSQL de teste com CREATEDB; cria/remove banco isolado.
SHORT_TEST_DATABASE_URL=postgresql://... npm run test:short-editing:integration
# Opcional: salvar os dois MP4s gerados fora do storage de produção
SHORT_TEST_DATABASE_URL=postgresql://... SHORT_REFERENCE_ARTIFACT_DIR=/tmp/short-ab npm run test:short-editing:integration
# frontend
npm test
npm run build
```

A integração usa o mesmo assunto e duas fontes sintéticas. Renderiza A com 30s sem referência e B com voz a 1,2x, cerca de 25s, mais alternâncias entre fontes, ASS/destaque com tempos simulados pelo provider, rótulos, zoom e fades. FFmpeg e PostgreSQL são reais; roteiro, transcrição e TTS são mocks. A diferença de duração é intencional, para comprovar velocidade e respeito à duração real, não um teste de qualidade subjetiva de uma voz real.

Também cobre fluxo antigo sem referências, isolamento de proprietário, upload separado, remoção/substituição, cache, persistência, migration repetida, atualização de projetos antigos, invalidação, falhas e render com uma/múltiplas fontes, crop/blur e streaming/download. Testes unitários verificam métricas, consolidação, propriedades desconhecidas, limites, seleção, TTS, cortes e fallback de timestamps. Nenhum teste faz chamada paga.

Para validação com conteúdo real: crie dois projetos com o mesmo roteiro e fontes autorizadas. Pule a etapa no primeiro; analise e aprove referências no segundo. Confira voz, quantidade/intervalos de cortes, legendas e rótulos antes de renderizar. Compare os MP4s baixados. Esse teste consome sua API apenas após os botões de geração/análise; não há interface adicional de comparação.

## Arquivos da entrega

Criados:

- `api/migrations/022_short_editing_references.sql`
- `api/scripts/migrate-short-references.cjs`
- `api/src/short-creation/short-editing.schema.ts`
- `api/src/short-creation/short-editing.metrics.ts`
- `api/src/short-creation/short-reference-analysis.service.ts`
- `api/src/short-creation/short-editing-effects.service.ts`
- `api/src/short-creation/short-editing.spec.ts`
- `api/test/shorts/short-references.integration.cjs`
- `frontend/src/pages/CreateShort/EditingReferences.jsx`
- `REFERENCIAS_EDICAO_SHORTS.md`

Modificados:

- `api/.env.example`, `api/package.json`
- `api/src/content-assets/content-assets.module.ts`
- `api/src/video-remix/remix-voice.service.ts`
- `api/src/short-creation/short.schema.ts`, `short.settings.ts`, `short.service.ts`, `short.worker.ts`, `short.media.ts`, `short.module.ts`, `short.controller.ts`, `short.spec.ts`, `short-media.spec.ts`
- `api/test/shorts/shorts.integration.cjs`
- `frontend/src/pages/CreateShort/CreateShort.jsx`
- `frontend/src/services/shortCreationService.js`
- `frontend/test/shortCreation.test.mjs`
- `CRIAR_SHORT_MVP.md`

## Validação executada nesta entrega

- Build da API e build de produção do frontend aprovados.
- 64 testes em seis suítes de backend (Criar Short, voz e legendas) aprovados. Cobrem também métricas, consolidação, seleção, velocidade, preservação ao pular, layout e tempos de legendas.
- 116 testes do frontend aprovados, incluindo os contratos dos uploads separados e a interface opcional.
- Integração PostgreSQL com banco descartável, migrations repetidas/idempotentes e conversão de projeto antigo; serviços externos pagos simulados.
- Render FFmpeg real com uma/várias fontes, crop/blur, ASS, overlays, zoom/fades, streaming e download, cache, propriedade, invalidação, falha simulada de análise e continuidade ao pular.
- Comparação A/B: mesmos dois materiais sintéticos de montagem e assunto. A sem referências, áudio de 30s; B com duas referências sintéticas, velocidade 1,2 aplicada à solicitação TTS e áudio de 25s, mais alternâncias entre fontes, legendas com destaque e novos rótulos. Frame renderizado inspecionado: texto e legenda dentro das margens, sem sobreposição.

Os MP4s foram gerados de verdade; roteiro, TTS, alinhamento e respostas multimodais são mocks. Os timestamps simulados têm intervalos definidos pelo provedor de teste, não são calculados pela aplicação para inventar alinhamento. O teste não comprova qualidade de entonação ou interpretação de referências reais; isso exige revisão manual com as suas referências e chamadas explícitas à API. Nenhuma chamada paga foi executada.

Arquivos A/B locais desta validação: `/tmp/trends-short-editing-MepghT/short-a-without-references.mp4` e `/tmp/trends-short-editing-MepghT/short-b-with-references.mp4`. São temporários de teste, não fazem parte do Git.

Para repetir:

```bash
# api
npm run build
npm run test:shorts
npm run test:short-editing
SHORT_TEST_DATABASE_URL=postgresql://... npm run test:short-editing:integration
# Opcional: exportar os MP4s do teste
SHORT_TEST_DATABASE_URL=postgresql://... SHORT_REFERENCE_ARTIFACT_DIR=/tmp/short-ab npm run test:short-editing:integration
# frontend
npm test
npm run build
```

Para comparar com conteúdo real: crie dois projetos com o mesmo roteiro e os mesmos materiais autorizados. Em A pule as referências; em B analise, revise e aprove o perfil antes de gerar o texto e a voz. Compare a duração real, número e alternância dos cortes, legendas, textos e efeitos após renderizar. Essa validação manual consome API; não é iniciada automaticamente.
