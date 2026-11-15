# Video Remix — Etapa 4: roteiro e narração

## Entrega

A seção **Roteiro e Narração** transforma os trechos selecionados na Análise Inteligente em roteiro revisável e áudio, nos modos Single Source e Multi Source.

- Planejamento narrativo estruturado, com HOOK, DEVELOPMENT, REVEAL e ENDING quando adequados, e registro de lacunas visuais.
- Estilos Curiosidade, Narrativo, Dinâmico e Explicativo; idioma inicial pt-BR; duração desejada de 5–600 segundos.
- Cada segmento mantém os IDs dos candidatos, cenas e fontes, intervalos originais, notas e estimativa de duração. O texto destinado à voz permanece separado de descrições e instruções visuais.
- Revisão visual independente da geração: o modelo multimodal recebe o texto, as evidências estruturadas e frames dos intervalos associados. A resposta é validada como `SUPPORTED`, `PARTIALLY_SUPPORTED` ou `UNSUPPORTED`, com motivo e sugestão de reformulação.
- Inferências, baixa confiança e ausência de frames não são promovidas automaticamente a fatos. Relevância alta não é usada como prova. **Somente segmentos SUPPORTED podem ser narrados.** O usuário não pode enviar um status de validação manual para contornar essa regra.
- Editor por segmentos, reordenação, exclusão, troca de referências, regeneração individual e cópia do roteiro completo.
- Vozes da integração existente, velocidade entre 0,75× e 1,25×, formato MP3 ou WAV. Geração segmentada prioritária e geração completa em uma chamada quando o texto cabe no limite do TTS.
- Reprodução privada do áudio e prévia do vídeo original no intervalo associado.
- Duração real do áudio validada por FFprobe, além do validador de áudio existente.
- Sincronização preliminar por segmento: duração visual disponível, duração de áudio, diferença e sugestões. Também compara a duração total com o alvo. Não corta palavras nem modifica arquivos originais.

A Etapa 5 não foi iniciada: não há montagem, ajuste automático de clipes, mixagem ou renderização final.

## Arquitetura e reutilização

A revisão inicial encontrou projetos, fontes, arquivos privados e análises em `api/src/video-remix`, geração estruturada em `LlmProvider`, síntese em `TtsProvider`/`OpenAiTtsProvider`, catálogo e limites em `TtsSettings`, validação em `AudioFileValidator`, storage em `StorageProvider` e execução limitada de mídia em `MediaProcess`.

Esses serviços são reutilizados. O módulo de assets passou a exportar os providers de TTS e seu validador, evitando criar outro cliente de voz. A interface de TTS recebeu um AbortSignal opcional; os chamadores anteriores continuam compatíveis. Não foram adicionadas dependências npm, Redis ou outro serviço de fila.

Novos serviços:

- `RemixNarrativePlanner`: recupera somente candidatos selecionados de análises concluídas, atuais e autorizadas. Carrega evidências e timestamps e gera um hash de contexto.
- `RemixScriptAiService`: geração estruturada e validação visual independente usando o `LlmProvider` existente.
- `RemixVoiceService`: instruções consistentes de voz, fingerprint por conteúdo/configuração, validador existente e FFprobe.
- `RemixStoryService`: CRUD, revisão concorrente, histórico, consumo, associação de áudio e sincronização derivada.
- `RemixStoryWorker`: fila persistente no PostgreSQL seguindo o padrão das etapas anteriores, sem bloquear HTTP.

## Persistência e versões

Migration nova: `api/migrations/018_video_remix_script.sql`.

Tabelas:

- `video_remix_scripts`: versão, revisão, configuração, provedor/modelo solicitado, planejamento e snapshot privado das evidências.
- `video_remix_script_segments`: ordem, tipo, texto, candidatos, estimativa, validação e áudio associado.
- `video_remix_script_revisions`: snapshot anterior às edições ou revisões, para rastreabilidade.
- `video_remix_narrations`: arquivos independentes, fingerprint, configurações, provedor/modelo, duração real, caracteres e uso retornado quando disponível.
- `video_remix_story_jobs`: estado, configuração capturada, deduplicação, progresso, tokens reportados, caracteres submetidos e reserva de limite.

A sincronização é derivada das referências e durações persistidas; não há outra tabela com cópias que possam ficar desatualizadas. Intervalos sobrepostos do mesmo arquivo não são contados duas vezes dentro de um segmento.

Editar texto, tipo ou referências invalida a validação e o áudio correspondente. Alterar voz, estilo ou velocidade invalida os áudios associados. Reordenar ou editar notas preserva o áudio individual quando o conteúdo/configuração permanecem compatíveis; a associação do áudio completo é removida nas revisões. Arquivos idênticos continuam no cache e podem ser associados novamente sem nova chamada de TTS.

Alterações de fontes, licenças, tema ou seleção tornam o contexto antigo desatualizado. A interface avisa; a narração e seu acesso são bloqueados até revisão adequada. Jobs com uma revisão antiga não sobrescrevem um texto editado enquanto a IA estava trabalhando. Um áudio já gerado nesse intervalo pode permanecer no cache, sem ser associado à revisão errada.

## Migration aplicada no ambiente local

O primeiro comando retornou `ECONNREFUSED` porque o PostgreSQL do Compose estava parado. O serviço existente foi iniciado com:

```bash
docker compose up -d --wait postgres
```

Em seguida, **a migration foi aplicada com sucesso ao banco configurado**, usando o runner existente:

```bash
cd api
npm run migrate:remix-story
```

O runner inclui as etapas anteriores e a migration 018. Não foram alteradas credenciais ou o `.env`. O PostgreSQL da aplicação permanece ativo. O banco descartável utilizado pelos testes é separado e foi encerrado ao concluir a validação.

## Configuração

Reutiliza `OPENAI_API_KEY`, `TTS_PROVIDER`, `TTS_MODEL`, `TTS_DEFAULT_VOICE`, `TTS_OUTPUT_FORMAT`, `TTS_MAX_TEXT_LENGTH`, `TTS_TIMEOUT_MS`, storage, autenticação, banco e FFprobe existentes.

Novas variáveis em `api/.env.example`:

```dotenv
# Precisa aceitar visão e Structured Outputs.
# Vazio reutiliza VIDEO_REMIX_ANALYSIS_MODEL.
VIDEO_REMIX_SCRIPT_MODEL=
VIDEO_REMIX_SCRIPT_MAX_JOBS_PER_PROJECT=100
VIDEO_REMIX_TTS_MAX_CHARACTERS_PER_PROJECT=50000
VIDEO_REMIX_SPEECH_WORDS_PER_MINUTE=145
```

Sem chave ou modelo multimodal configurados, a interface informa o que falta e o backend não enfileira geração. O TTS mantém os modelos com instruções de estilo aceitos pela configuração existente (`gpt-4o-mini-tts` e `gpt-4o-mini-tts-2025-12-15`), os formatos MP3/WAV e o catálogo de 13 vozes já utilizado pelo aplicativo. Não há seleção de outro provedor enquanto somente OpenAI estiver implementado.

A configuração exposta ao frontend não contém chaves nem caminhos internos. O parâmetro de palavras por minuto serve apenas como base ajustável; a estimativa também considera estilo, velocidade e pausas de pontuação, apresentando uma faixa aproximada. A medida que orienta a sincronização após TTS é a duração real.

A integração foi conferida com a skill OpenAI Docs e a [documentação oficial de TTS](https://developers.openai.com/api/docs/guides/text-to-speech) e [referência de geração de voz](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Segurança, fila e custos

- Mesma sessão/chave e isolamento por proprietário das etapas anteriores; UUIDs e entradas validados, SQL parametrizado e arquivos privados.
- Até 12 candidatos selecionados, 12 segmentos por roteiro, três referências por segmento e 1000 caracteres de narração por segmento. Contexto textual de geração limitado a 100 mil caracteres.
- Apenas frames dentro dos timestamps selecionados entram na evidência; a revisão envia até dois frames por referência e cada imagem é limitada a 2 MiB.
- Conteúdos de fontes, frames, observações e textos externos são dados não confiáveis. Os prompts proíbem seguir suas instruções. Nenhuma ferramenta executável é fornecida à IA.
- Um worker de roteiro/narração por banco, protegido por advisory lock, e até 20 jobs ativos/pendentes. Pedidos equivalentes em execução são deduplicados. Resultados de jobs concluídos com o mesmo fingerprint também são reutilizados.
- Cada job registra os modelos capturados. Mudanças de configuração durante o processamento impedem aplicar resultados incompatíveis.
- Limite de operações por projeto e de caracteres reservados configuráveis. As reservas incluem tentativas anteriores, falhas e cancelamentos de maneira conservadora; não representam caracteres faturados pelo provedor.
- Tokens são registrados conforme retornados pelo LLM. Caracteres submetidos ao TTS são registrados por tentativa; isso não é uma confirmação de faturamento. Duração e uso eventualmente retornado pelo TTS ficam na narração. O adaptador atual não fornece contagem de tokens de voz.
- Sem dados financeiros confiáveis de tokenização/preço de voz, a interface apresenta custo em dólares indisponível. Nenhum preço ou consumo financeiro é inventado.
- Cache de voz por texto normalizado, idioma, provedor, modelo, formato, voz, estilo, velocidade e versão das instruções, dentro do mesmo projeto. Texto/configuração idênticos não forçam nova cobrança apenas por clicar em gerar novamente.
- Tempo máximo de job: 30 minutos. O TTS reutiliza seu timeout existente; FFprobe tem 30 segundos. Cancelamento persistente propaga AbortSignal ao LLM, TTS e probe. Consumo já ocorrido não é desfeito.
- Não há retentativa automática paga no worker desta etapa. Após falha/cancelamento, o usuário pode repetir a ação; cache preserva áudios anteriores válidos. Após interrupção do processo, jobs `RUNNING` são marcados como falha, sem reenvio automático.
- Temporários de voz são removidos ao concluir/falhar. Exclusão do projeto remove dados em cascata e enfileira limpeza física dos áudios. A limpeza compartilhada foi atualizada para reconhecer referências a frames e narrações, preservando objetos ainda em uso.

## Como usar

1. Configure chave/modelo de roteiro e TTS e reinicie a API pelos comandos habituais.
2. Abra um projeto Video Remix em rascunho. Importe e autorize as fontes, execute a Etapa 3 e selecione candidatos.
3. Na seção **Roteiro e Narração**, escolha pt-BR, estilo, duração, voz e velocidade.
4. Clique em **Gerar roteiro com IA** e confirme a operação. Acompanhe o histórico de jobs.
5. Leia o planejamento, as lacunas e o roteiro completo. Confira as cenas associadas e os avisos de suporte.
6. Edite texto, ordem, notas e associações; salve antes de continuar. Para mudar só uma parte, use **Regenerar este segmento**.
7. Use **Validar correspondência visual** após alterações. Reformule ou troque cenas se o resultado não for SUPPORTED.
8. Gere narração segmentada, individual ou completa. A geração completa exige que o texto total caiba no limite de uma chamada do TTS (4096 caracteres por padrão).
9. Ouça o áudio e compare durações. Para aplicar voz/velocidade novas ao roteiro atual, clique em **Salvar configuração no roteiro** e gere o áudio novamente.
10. Consulte **Sincronização preliminar**. Se houver áudio longo demais, reduza o texto ou selecione mais material compatível; nenhuma correção destrutiva é aplicada automaticamente.

A narração completa informa sua duração total; sem alinhamento de fala, não se inventam durações individuais a partir desse arquivo. Para a sincronização por segmento, gere a versão segmentada.

## API

Base: `/video-remix/projects/:projectId/story`.

| Método | Caminho | Operação |
| --- | --- | --- |
| GET | `/options` | Configuração pública, vozes e limites |
| GET | `/evidence` | Trechos selecionados e referências seguras |
| GET | `/jobs` | Estado, progresso e consumo |
| POST | `/jobs/:id/cancel` | Cancelar |
| GET | `/scripts` | Listar versões |
| POST | `/scripts` | Gerar roteiro, com `config` e `confirm: true` |
| GET | `/scripts/:id` | Roteiro, segmentos, validações, áudio e sincronização |
| PATCH | `/scripts/:id` | Editar configuração/segmentos com revisão otimista |
| POST | `/scripts/:id/validate` | Validar correspondência com as cenas |
| POST | `/scripts/:id/regenerate` | Regenerar um segmento por `segmentId` |
| POST | `/scripts/:id/narrate` | Gerar áudio `SEGMENTED` ou `FULL`, com segmento opcional no modo segmentado |
| GET | `/scripts/:id/audio/:audioId` | Streaming privado com Range |
| GET | `/scripts/:id/synchronization` | Dados preliminares de sincronização |

Operações de IA exigem `confirm: true` e, quando alteram um roteiro existente, sua `revision` atual.

## Testes e resultados

- API: **564 testes em 51 suítes passaram**, incluindo regressão completa e compatibilidade do TTS existente.
- Frontend: **100 testes passaram**, incluindo ausência de operações pagas ao abrir a seção, sessão, revisão e distinção entre regeneração individual/voz completa.
- Builds da API/frontend e lint de ambos passaram. O frontend mantém o aviso de bundle maior que 500 kB.
- Integração: PostgreSQL 17 descartável; migrations 004–018 aplicadas duas vezes; FFmpeg/FFprobe reais; mocks de LLM/TTS; arquivo WAV válido com duração conhecida de 3,25 segundos.
- Casos exercitados: sem seleção suficiente; geração estruturada; deduplicação concorrente; SUPPORTED/PARTIALLY_SUPPORTED/UNSUPPORTED; bloqueio de narração não sustentada; edição/reordenação/regeneração; preservação do áudio não alterado; áudio completo/segmentado; cache; sincronização e excesso de duração; alteração de voz/velocidade; revisão concorrente durante TTS; falha/cancelamento; limite de operações; proprietário; histórico e limpeza de arquivos; Single Source/Multi Source.
- Chrome real: configuração e consentimento, geração assíncrona, editor, reprodução e duração do áudio, invalidação individual, nova validação, geração com cache e layouts 1440/768/390. O player recebeu limite de largura para telas estreitas.
- O teste de navegador desativa observadores de arquivos do Vite, evitando o limite de watchers do ambiente.
- Nenhuma chamada real de IA ou YouTube; arquivos sintéticos são usados somente nos testes.

Comandos em `api`:

```bash
npm run test:remix-story
npm run build
# Exige PostgreSQL descartável e Google Chrome instalado:
CONTENT_TEST_DATABASE_URL=postgresql://usuario:senha@host:porta/postgres npm run test:remix-story:integration
```

Em `frontend`: `npm test`, `npm run lint` e `npm run build`.

O teste cria/remove seu banco isolado. Não use credenciais de produção. Logs da sessão: `/tmp/remix4-all-unit.log`, `/tmp/remix4-front-test.log`, `/tmp/remix4-integration.log`. Evidências finais e screenshot: `/tmp/trends-remix-story-FkQj5u`.

## Validação com GTA Vice City

Cenário preparado em `api/test/fixtures/remix-gta-story-scenario.json`, baseado no projeto da Etapa 3: tema do ovo de Páscoa, Single Source, pt-BR, Curiosidade, 35 segundos e 9:16.

Use gameplay obtido legitimamente e autorizado. Depois da análise, selecione os trechos pertinentes, gere o roteiro e confira cada frase contra frames e o vídeo original. A aparição de um prédio ou de um personagem não confirma uma passagem secreta, a travessia de uma parede ou o ovo. Se o material não mostrar o acontecimento, reformule o texto ou selecione outra cena; não libere a afirmação apenas pela relevância.

Valide, gere a voz, ouça o resultado e compare os 35 segundos com a duração medida e com os intervalos visuais. Repita em Multi Source, conferindo a origem de cada segmento. Registre falsos positivos do revisor e ajustes necessários.

Não foi fornecido gameplay autorizado nesta sessão. Portanto, a validação semântica real com GTA permanece para execução com o material do usuário. Não se afirma que um easter egg foi encontrado.

## Limitações

A validação visual continua sendo uma avaliação de IA sobre amostras e pode errar. SUPPORTED é um resultado de correspondência visual, não prova histórica ou estatística. Eventos entre frames, texto pequeno, identidade de personagens e causalidade precisam de revisão humana.

Idioma inicial restrito a pt-BR; catálogo de vozes e modelos segue a integração atual. A geração de voz exige acesso ao modelo configurado na conta. A estimativa de fala é aproximada e não ajusta o áudio automaticamente.

Um worker por banco e limites por projeto priorizam previsibilidade sobre distribuição de carga. Repetir uma geração com falha pode consumir a API novamente; resultados recebidos e áudios válidos são preservados, mas não se reconstrói consumo de respostas perdidas. Cache é por projeto e não sintetiza variações novas quando texto/configuração permanecem idênticos.

A sincronização não corta clipes, não faz alinhamento de palavras e não atribui tempos artificiais a um arquivo de voz completo. Tais operações ficam para etapas posteriores.

## Arquivos criados e modificados

Criados:

- `api/migrations/018_video_remix_script.sql`
- `api/src/video-remix/remix-story.schema.ts`
- `api/src/video-remix/remix-story.settings.ts`
- `api/src/video-remix/remix-narrative-planner.ts`
- `api/src/video-remix/remix-script-ai.service.ts`
- `api/src/video-remix/remix-voice.service.ts`
- `api/src/video-remix/remix-story.service.ts`
- `api/src/video-remix/remix-story.worker.ts`
- `api/src/video-remix/remix-story.controller.ts`
- `api/src/video-remix/remix-story.spec.ts`
- `api/test/video-remix/remix-story.integration.cjs`
- `api/test/video-remix/remix-story.browser.cjs`
- `api/test/fixtures/remix-gta-story-scenario.json`
- `frontend/src/pages/VideoRemix/RemixStoryPanel.jsx`
- `frontend/test/remixStory.test.mjs`
- Este relatório.

Modificados:

- `api/.env.example`, `api/package.json`, `api/scripts/migrate-assets.cjs`
- `api/src/content-assets/content-assets.module.ts`
- `api/src/content-narration/tts.provider.ts`, `openai-tts.provider.ts` e `openai-tts.provider.spec.ts`
- `api/src/video-remix/video-remix.module.ts`, `remix-files.service.ts`
- `frontend/src/pages/VideoRemix/VideoRemix.jsx`
- `frontend/src/services/videoRemixService.js`
- `frontend/src/types/videoRemix.d.ts`
- `IMPLEMENTACAO_CRIACAO_CONTEUDO.md`
