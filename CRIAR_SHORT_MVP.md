# Criar Short — MVP

Módulo independente em `?page=create-short`. O Video Remix permanece disponível e não participa deste fluxo.

## Fluxo

1. Descrever o assunto, escolher 30/45/60 segundos, gerar/editar o roteiro e aprovar.
2. Enviar um ou mais MP4, MOV ou WebM e declarar autorização de uso. Os arquivos enviados são o material real dos cortes, não referências de estilo.
3. Gerar/editar o texto de narração e aprovar. Nenhum áudio é gerado automaticamente.
4. Escolher uma voz, gerar e ouvir a narração. A duração real conduz a montagem.
5. Solicitar cortes básicos ou ativar análise visual com IA, revisar os intervalos e as prévias dos originais, aprovar.
6. Escolher recorte central ou fundo desfocado e renderizar em segundo plano.
7. Reproduzir/baixar o MP4 validado. Meus Shorts permite continuar, visualizar, baixar e excluir projetos.

Todas as operações de IA/TTS são iniciadas por botões explícitos. Revisar a página, listar projetos e reproduzir arquivos não executa IA. Regenerar pode gerar nova cobrança. O MVP não publica no YouTube.

## Instalação e execução

Não há novas dependências npm. Reutiliza NestJS, PostgreSQL, Multer, Zod, serviços de IA e TTS, storage privado, FFmpeg/FFprobe e o design existente.

No diretório `api`:

```bash
npm run migrate:shorts
npm run start:dev
```

No diretório `frontend`:

```bash
npm run dev
```

Acesse o menu **Criar Short** ou `http://localhost:5173/?page=create-short`.

Reutiliza `DATABASE_URL`, `CONTENT_ACCESS_KEY`, `CONTENT_OWNER_ID`, `CONTENT_STORAGE_PATH`, `OPENAI_API_KEY`, `TTS_*`, `FFMPEG_PATH` e `FFPROBE_PATH`. `SHORT_CREATION_MODEL` vazio utiliza, nesta ordem, `VIDEO_REMIX_SCRIPT_MODEL`, `VIDEO_REMIX_ANALYSIS_MODEL`, `OPENAI_MODEL`. A análise semântica exige modelo com visão e Structured Outputs. A voz usa o TTS existente, sem clonagem.

A configuração completa está em `api/.env.example`. Padrões do novo módulo:

- 5 vídeos por projeto, até 250 MiB por vídeo, até 20 minutos e resolução máxima de 4K.
- Seleção limitada aos primeiros 10 minutos de cada original; máximo de 18 cenas por projeto e até 3 frames por cena.
- Máximo de 90 segundos de áudio real, 100 operações por projeto e 20 tarefas ativas na fila.
- Um worker por vez, coordenado por advisory lock PostgreSQL, mesmo com várias instâncias da API.
- Uma tarefa ativa por projeto. Alterações ficam bloqueadas durante tarefas.

## Persistência e segurança

Migration `021_short_creation.sql` cria `short_projects`, `short_files`, `short_jobs`, `short_storage_cleanup`. Não altera tabelas de outros módulos. É idempotente.

O proprietário é o `CONTENT_OWNER_ID` do servidor, protegido pelo acesso local já existente. Não é autenticação multiusuário independente. Todos os endpoints `/shorts` exigem acesso; projetos e arquivos são consultados pelo proprietário. Os originais ficam intactos no storage privado. Caminhos internos não são expostos nas respostas.

Uploads usam disco temporário, limites de bytes, extensão/MIME/magic bytes, FFprobe e autorização declaratória. Declaração não comprova direitos de terceiros. Processos usam argumentos separados, sem shell, e protocolos locais limitados. A renderização usa exclusivamente arquivos do projeto, silencia o áudio original e adiciona a narração. Não busca nem baixa mídia externa.

Edição do roteiro invalida aprovações e resultados dependentes. Edição da narração ou voz invalida áudio/plano/render. Remover/adicionar fontes invalida plano/render. O frontend preserva alterações não salvas diante do polling e pede confirmação para descartá-las.

Tarefas interrompidas são marcadas como falhas; não repetimos chamadas pagas automaticamente. Dados aprovados anteriores e uso retornado pelos providers são preservados. Arquivos substituídos/excluídos entram em limpeza persistente, executada após uma hora. Temporários abandonados são removidos após duas horas; temporários de operações concluídas/falhas são removidos ao encerrar a operação.

## Teste completo manual

Use vídeos próprios/autorizados com duração total suficiente para cobrir a narração, preferencialmente dois vídeos de cenas diferentes.

1. Crie um projeto e aprove o roteiro.
2. Envie um vídeo; confira nome, duração/tamanho e declaração. Envie um segundo vídeo para testar múltiplas fontes.
3. Gere, edite e aprove o texto. Gere áudio, ouça e confira a duração real.
4. Na seleção básica, confira o aviso de ausência de entendimento semântico. Na opção com IA, confira a relação das cenas com a narração; esta opção consome a API.
5. Reproduza os cortes listados; aprove. Renderize e acompanhe o progresso.
6. Confira player, dimensões 1080×1920, duração, download MP4 e voz.
7. Atualize o navegador e reabra em Meus Shorts. Volte e edite o texto para verificar invalidação de áudio e resultado.

## Testes automatizados

```bash
# api
npm run test:shorts
npm run build
# Integração: cria e remove um banco descartável; exige usuário PostgreSQL com CREATEDB.
SHORT_TEST_DATABASE_URL=postgresql://... node test/shorts/shorts.integration.cjs
# frontend
npm test
npm run build
```

A integração usa vídeos sintéticos e mocks de todos os providers pagos. Cobre criação, edição/aprovação, uploads, geração de roteiro/texto/voz, detecção de cenas, montagem básica/semântica, renderização real com uma/várias fontes, crop/blur, validação, persistência, streaming/download, retomada, isolamento de proprietário e falhas.

## Limitações reais

- A IA não pesquisa nem verifica fatos na web. O prompt exige cautela, mas o usuário deve revisar afirmações.
- Análise semântica usa amostras limitadas do centro dos intervalos detectados, preservadas pelos cortes centralizados; não compreende o vídeo inteiro nem garante correspondência perfeita. O modo básico não avalia significado.
- A narração é uma faixa única: cortes acompanham sua duração total, sem alinhamento palavra a palavra. Não há detecção de rostos para enquadramento.
- Não há legendas nesta primeira entrega; o item de legendas é opcional no escopo. Não há música, efeitos, transições elaboradas ou editor avançado.
- Material insuficiente gera erro em vez de repetir automaticamente ou inventar cortes.
- Saída fixa MP4 H.264/AAC, 1080×1920, 30 FPS. Renderizar requer CPU e espaço de disco local; progresso é por cortes e finalização.
- Cada upload é enviado individualmente para limitar memória e permitir preservar os anteriores quando um arquivo falha. Um upload interrompido precisa ser reenviado.
- A revisão manual é obrigatória antes de áudio, seleção aprovada e render; não há publicação nem agendamento.

## Arquivos da entrega

Novos:

- `api/migrations/021_short_creation.sql`
- `api/scripts/migrate-shorts.cjs`
- `api/src/short-creation/short.module.ts`
- `api/src/short-creation/short.controller.ts`
- `api/src/short-creation/short.service.ts`
- `api/src/short-creation/short.worker.ts`
- `api/src/short-creation/short.media.ts`
- `api/src/short-creation/short.schema.ts`
- `api/src/short-creation/short.settings.ts`
- `api/src/short-creation/short.spec.ts`
- `api/src/short-creation/short-media.spec.ts`
- `api/test/shorts/shorts.integration.cjs`
- `frontend/src/pages/CreateShort/CreateShort.jsx`
- `frontend/src/services/shortCreationService.js`
- `frontend/test/shortCreation.test.mjs`
- `CRIAR_SHORT_MVP.md`

Integrações modificadas:

- `api/.env.example`: limites e modelo opcionais.
- `api/package.json`: comandos `migrate:shorts`, `test:shorts` e `test:shorts:integration`.
- `api/src/app.module.ts`: registro do módulo.
- `api/src/content-publication/content-access.ts`: aplica o controle de acesso existente a `/shorts`.
- `frontend/src/App.jsx`: rota independente `create-short`.
- `frontend/src/layouts/Aside/Aside.jsx`: entrada Criar Short.

Resultados da verificação desta entrega: 10 testes unitários do novo backend; 114 testes do frontend completo; integração isolada com PostgreSQL e FFmpeg reais, MP4/MOV/WebM e mocks de IA/TTS; builds de API/frontend aprovados. Migration 021 aplicada no banco local. Nenhum projeto real foi gerado e nenhuma chamada paga foi executada.
