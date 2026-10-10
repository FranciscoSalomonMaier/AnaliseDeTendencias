# Criação de conteúdo com IA — primeira etapa

## Diagnóstico e decisões

O Trends Analytics já possuía NestJS, React/Vite, o menu YouTube, a página Conteúdos, um Estúdio vinculado a trends e o fluxo de ideias → roteiro → cenas. A persistência era feita em `content_generation_runs`, usando PostgreSQL com `pg`; não há TypeORM. Existiam schemas Zod, prompts e um `LlmProvider` com Structured Outputs via OpenAI. `AiAnalysisService.getModel()` centraliza a escolha do modelo.

A criação anterior exigia uma trend, começava diretamente nas ideias e não possuía aprovação independente do roteiro. As mudanças de seleção apagavam os resultados posteriores no fluxo antigo.

Foram reutilizados: a tabela existente, os schemas de ideias/roteiro/cenas, a abstração de IA, os editores de roteiro e cenas, timestamps, contagem de palavras, placeholder de produção e visual do menu. O Estúdio anterior e seus dados continuam acessíveis pela biblioteca; projetos novos têm rotas próprias e não podem ser modificados pelas rotas antigas.

Não existem autenticação, usuário/empresa/workspace ou infraestrutura de upload/storage neste projeto. Não há Redis/BullMQ em uso. A página trabalha no mesmo contexto compartilhado das páginas existentes. As referências de arquivos ficam como “Em breve”; não foi instalada infraestrutura de storage.

## Arquitetura

- `ContentProjectController`: rotas e parâmetros.
- `ContentProjectService`: validação de requests, transições, seleção, aprovação e invalidação.
- `ContentProjectGenerationService`: solicitações estruturadas ao `LlmProvider`, validação das respostas, IDs, duração e usage.
- `ContentProjectRepository`: persistência, paginação, revisão e bloqueio no PostgreSQL.
- Prompts de projeto: ideias, roteiro e cenas, separados da interface e dos controllers.

A produção futura pode acrescentar adapters de imagem/TTS e associar assets ao ID estável do projeto ou da cena. Não há implementações vazias de providers de mídia.

## Modelagem e persistência

Foi escolhida uma extensão híbrida de `content_generation_runs`. Identidade, status, revisão, datas e marcadores de invalidação são colunas; configuração, ideias, roteiro, plano de cenas e usage são documentos JSONB separados. Isso reutiliza a persistência sem duplicar conteúdo nem criar dezenas de tabelas.

`ContentProject` retorna:

- `id`, `config`, `status`, `revision`, `createdAt`, `updatedAt`;
- `ideas`, `selectedIdea`, `script`, `scenes`;
- `scriptStale`, `scenesStale`, `usage`.

Configuração: tipo VIDEO, tema obrigatório, instruções opcionais, estilo DARK, idioma pt-BR e duração de 60 a 600 segundos. A interface oferece 1, 3, 5 e 10 minutos. A referência é opcional: TOPIC, VIDEO ou MANUAL, com ID opcional; não há dependência obrigatória de um topic ou de seus dados atuais.

Ideias: UUID estável, título, hook, abordagem, resumo e público opcional. São geradas 3–5 ideias. O usuário escolhe uma; o roteiro não é gerado automaticamente.

Roteiro: título, hook, introdução, seções com título/narração, conclusão, duração estimada e notas de pesquisa. A constante `NARRATION_WORDS_PER_MINUTE=150` define o orçamento solicitado à IA e o cálculo da duração. O título não entra na narração. Ao salvar uma edição, a estimativa é recalculada.

Cenas: UUID estável, ordem, narração, descrição visual, imagePrompt e duração estimada. A numeração gerada é validada como consecutiva. Os timestamps resultam da soma das durações; não há engine de timeline. A ordem permanece estável ao editar.

Assets: os tipos IMAGE/AUDIO/MUSIC e as semânticas REQUIRED/REFERENCE/OPTIONAL estão definidos para evolução futura. Nenhum arquivo é recebido ou processado nesta etapa.

## Status e invalidação

| Status | Significado |
| --- | --- |
| DRAFT | Configuração salva; gerar ideias atuais |
| IDEAS_GENERATED | Ideias disponíveis para seleção |
| IDEA_SELECTED | Uma ideia selecionada; gerar roteiro |
| SCRIPT_GENERATED | Roteiro em revisão |
| SCRIPT_APPROVED | Roteiro aprovado; gerar cenas |
| SCENES_GENERATED | Cenas em revisão |
| SCENES_APPROVED | Planejamento aprovado; produção “Em breve” |

Alterar a configuração retorna a DRAFT e desatualiza as etapas posteriores. Trocar a ideia exige confirmação quando já há material, retorna a IDEA_SELECTED e desatualiza roteiro/cenas. Editar ou regenerar o roteiro retorna a SCRIPT_GENERATED e desatualiza cenas. Editar cenas retira a aprovação delas.

O conteúdo anterior não é apagado na invalidação. Os marcadores `scriptStale`/`scenesStale` indicam a validade dos documentos preservados; o status central controla o fluxo e as aprovações. Material desatualizado não pode ser aprovado ou usado para gerar a próxima etapa. Regenerações exigem confirmação quando substituem dados; a interface também avisa sobre edições não salvas.

## Endpoints

Todas as rotas abaixo usam `/content-projects`:

| Método | Caminho | Ação |
| --- | --- | --- |
| POST | / | Criar projeto |
| GET | /?limit=50&offset=0 | Listar projetos |
| GET | /:id | Reabrir projeto |
| PATCH | /:id | Salvar configuração |
| POST | /:id/ideas/generate | Gerar/regenerar ideias |
| POST | /:id/ideas/:ideaId/select | Selecionar ideia |
| POST | /:id/script/generate | Gerar/regenerar roteiro |
| PATCH | /:id/script | Salvar roteiro |
| POST | /:id/script/approve | Aprovar roteiro |
| POST | /:id/scenes/generate | Gerar/regenerar cenas |
| PATCH | /:id/scenes/:sceneId | Salvar cena |
| POST | /:id/scenes/approve | Aprovar cenas |

Mutações de projeto existente exigem `revision`. Operações que substituem ou invalidam trabalho existente exigem `confirm: true`. Alteração de configuração recebe `{revision, config, confirm}`; edição de roteiro `{revision, script, confirm}`; edição de cena `{revision, scene}`.

IDs são validados como UUID. Paginação e payloads são validados. Selecionar ideia ou editar cena de outro projeto é rejeitado. A lista mostra até 50 projetos por página e permite carregar mais.

## Concorrência e falhas

Cada mutação usa um advisory lock de sessão por projeto, com tentativa imediata. A conexão dedicada mantém o lock durante a geração, sem abrir uma transação longa durante a chamada de rede. Outra operação no mesmo projeto recebe HTTP 409 antes de chamar a IA. Projetos diferentes podem ser processados separadamente.

A revisão também é conferida antes do trabalho e no UPDATE. Uma janela desatualizada recebe HTTP 409 e pode reabrir a versão salva. Respostas da IA são validadas antes do UPDATE; erro, timeout ou resposta inválida não substituem o conteúdo anterior. Os erros de provider já tratados pelo `OpenAiLlmProvider` são reutilizados.

O frontend desabilita ações durante as requests e usa uma proteção contra duplo clique. Os editores oferecem “Salvar alterações”. Aprovar primeiro salva as edições pendentes e depois aprova. Ao sair com edições pendentes, é exibida confirmação. Dados salvos podem ser reabertos pela lista e pela URL com `projectId`.

## Prompts, provider e segurança

`api/src/ai/content-generation/prompts/content-project.prompt.ts` organiza três instruções de geração. Todos os prompts consideram tema, instruções, estilo, idioma e duração; roteiro acrescenta a ideia escolhida; cenas acrescentam o roteiro aprovado. Os prompts orientam narrativa dark documental, retenção, continuidade visual, verificação de fatos e ausência de clickbait enganoso.

O fluxo continua React → NestJS → LlmProvider → OpenAI. Não há chamada direta do frontend à OpenAI, nem nova chave ou variável VITE de chave. O schema é enviado pelo provider existente, sem regex ou limpeza improvisada de JSON. Usage de cada geração bem-sucedida preserva provider, modelo e tokens de entrada/saída/total no projeto.

## Interface e integração com Temas em Alta

O submenu YouTube mantém Listar, Temas em Alta e Conteúdos e acrescenta Criação. A nova página contém configurações, formatos futuros bloqueados, referências futuras bloqueadas, lista de projetos e pipeline de cinco etapas. Os editores existentes receberam ações de salvar/aprovar sem alterar o comportamento do Estúdio legado.

“Criar conteúdo” em Temas em Alta passa o nome e o ID do tema como origem opcional. O tema fica preenchido no formulário e pode ser editado antes de gerar. A URL conserva os parâmetros de origem e depois recebe o ID do projeto. O histórico do navegador restaura o projeto.

## Arquivos

Backend criados:

- `api/src/content-projects/content-project.schema.ts`
- `api/src/content-projects/content-project.repository.ts`
- `api/src/content-projects/content-project-generation.service.ts`
- `api/src/content-projects/content-project.service.ts`
- `api/src/content-projects/content-project.controller.ts`
- `api/src/content-projects/content-project.module.ts`
- `api/src/content-projects/content-project.service.spec.ts`
- `api/src/ai/content-generation/prompts/content-project.prompt.ts`
- `api/migrations/004_content_projects.sql`
- `api/scripts/migrate-content.cjs`
- `api/test/content/projects.integration.cjs`

Backend alterados: `api/src/app.module.ts`, `api/package.json`, `api/trends/content-generation.repository.ts`. Na validação geral, foram corrigidos mocks de dependências nos quatro specs antigos de Trends/Reddit, formatação em `ai-analyzed-topic-cluster.interface.ts` e o aviso de promise em `api/src/main.ts`; isso não altera a lógica dos coletores.

Frontend criados:

- `frontend/src/pages/ContentCreation/ContentProjectCreation.jsx`
- `frontend/src/pages/ContentCreation/components/ProjectConfiguration.jsx`
- `frontend/src/services/contentProjectService.js`
- `frontend/src/utils/contentProjectState.js`
- `frontend/src/types/contentProject.d.ts`
- `frontend/test/contentProjects.test.mjs`

Frontend alterados: `App.jsx`, `layouts/Aside/Aside.jsx`, `ContentCreation.jsx`, componentes ContentStudioStepper/ScriptStep/ScenesStep/ProductionStep, páginas TrendingTopics/TopicCard e seu teste.

## Migration e validação

A migration 004 é transacional e repetível. Acrescenta seis colunas e um índice à tabela existente, sem apagar registros. Também cria a tabela base se o banco estiver vazio. Os conteúdos antigos mantêm `project_config IS NULL` e permanecem na biblioteca anterior.

Foi aplicada ao banco local com `npm run migrate:content`. Conferência posterior confirmou as seis colunas e os dois conteúdos legados preservados.

Resultados:

- Backend: build/TypeScript aprovados; 26 suites e 140 testes Jest aprovados; ESLint aprovado.
- Frontend: build Vite e ESLint aprovados; os três arquivos de testes, incluindo cenários de formulário, loading, edição, aprovação bloqueada, erro da API, revisão, timestamps e estados do pipeline, aprovados.
- PostgreSQL descartável + HTTP: validação, estados incompatíveis, seleção, duas gerações concorrentes com uma única chamada ao provider, revisão antiga, falha preservando trabalho, migration repetida e isolamento das rotas legadas aprovados.
- Chrome: tema preenchido → gerar ideias → escolher → gerar roteiro → editar/salvar → aprovar → gerar cenas → editar/salvar → aprovar → sair → reabrir; dados e status preservados. Novo projeto e larguras 1440/768/390 também validados.
- Nenhum teste chamou a OpenAI. Screenshot de conferência em `/tmp/trends-content-creation.png`.

Comandos:

```sh
cd api
npm run migrate:content
npm run build
npm run test:content
npx jest --config jest.ai-cache.config.cjs --runInBand
npx eslint 'src/**/*.ts' 'trends/**/*.ts'
CONTENT_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55441/postgres npm run test:content:integration
```

O teste de integração requer Google Chrome e PostgreSQL de testes com permissão para criar bancos. Cria e remove um banco isolado por execução; não aponte essa URL ao banco operacional.

## Como usar e limites

Reinicie o backend e abra YouTube → Criação. Informe o tema e gere ideias; selecione uma antes de gerar o roteiro. Salve ou aprove as edições; gere cenas somente depois da aprovação do roteiro. Salve e aprove as cenas para chegar à produção “Em breve”. Volte pela lista de projetos para continuar.

A duração é estimada e o orçamento de palavras é uma orientação ao modelo, sem garantia de tempo exato. O conteúdo pode exigir pesquisa editorial; não há busca de fontes neste fluxo. Salvamento é explícito, sem autosave. O código foi testado com provider simulado; disponibilidade, permissões, saldo e qualidade da geração real dependem da configuração existente do provider.

Nesta etapa somente vídeo, estilo Dark e pt-BR estão disponíveis. Não há produção de mídia, upload, imagens reais, TTS, música, legendas, timeline, FFmpeg, MP4, publicação ou cortes. O próximo passo é definir storage e assets, incorporar providers de mídia e conectar as cenas a narração/imagens e à produção, preservando a identidade do projeto e a revisão dos artefatos.


## Etapa de narração TTS

Implementada geração real de áudio por cena com OpenAI, configurações de voz do projeto, versões, seleção persistida, upload MP3/WAV, duração medida no backend e fila persistente no PostgreSQL. Detalhes, endpoints, migration, testes e limitações: [IMPLEMENTACAO_NARRACAO_TTS.md](IMPLEMENTACAO_NARRACAO_TTS.md).

## Etapa 4 — Timeline e renderização MP4

Implementada montagem real com FFmpeg, timeline baseada na duração das narrações, movimento suave, jobs persistentes, progresso, cancelamento, histórico, player e download. Migration aplicada e teste real em 1080p aprovado. Diagnóstico, configuração, endpoints, testes, limitações e os 25 pontos de entrega: [IMPLEMENTACAO_TIMELINE_RENDERIZACAO.md](IMPLEMENTACAO_TIMELINE_RENDERIZACAO.md).

## Etapa 5 — Música, efeitos e mixagem

Integrada mixagem real ao renderizador existente: upload de MP3/WAV, música por projeto com volume/fades/loop/ducking, efeitos por cena com offset/ganho e snapshot das configurações. Detalhes dos 22 pontos de entrega, rotas, migration, testes e limites: [IMPLEMENTACAO_MUSICA_E_EFEITOS.md](IMPLEMENTACAO_MUSICA_E_EFEITOS.md).
