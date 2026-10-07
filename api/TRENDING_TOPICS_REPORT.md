# Temas em Alta — relatório

Esta é a implementação inicial. A identificação lexical foi posteriormente substituída no ranking por temas semânticos persistidos; veja SEMANTIC_TOPICS_REPORT.md para o funcionamento atual.

## Funcionamento anterior e reutilização
TopicClusteringService usa similaridade lexical Jaccard ponderada: títulos/tags, descrição e categoria, limiar 0,32. Remove stopwords/termos genéricos, reduz similaridade com números conflitantes e associa cada vídeo ao grupo de maior similaridade média. Nomes usam cinco termos representativos; keywords vêm da soma dos pesos. Não usa IA. Clusters são dinâmicos, sem persistência.

O método antigo groupByTopic e seus consumidores foram preservados. A extração interna groupDrafts/describeCluster permite groupByContent receber TrendItem e reaproveitar agrupamento/nomeação sem calcular scores. A nova entrada deduplica vídeos e ordena por ID, evitando que a ordem do ranking por período altere o agrupamento.

YoutubeNormalizerService converte metadados/estatísticas; MetricsService calcula métricas por idade do vídeo no fluxo antigo, sem histórico. AiAnalysisService participa somente da geração explícita de análises. Nenhum desses serviços foi alterado.

## Endpoint e fluxo novo
GET /trends/youtube/topics?regionCode=BR&period=7d&limit=20.
Períodos today/7d/30d/1y reutilizam periodStart do Top 50; Hoje começa à meia-noite de Brasília. Região validada/normalizada, limite inteiro 1–100, padrão 20. Valores inválidos retornam 400.

Metadados de todos os vídeos acompanhados na região com snapshots → normalizador → clustering existente → associação vídeo/tema → agregação PostgreSQL → ranking por soma do crescimento DESC. Não limita candidatos aos 50 vídeos do ranking individual. Nenhuma chamada YouTube/OpenAI para consultar temas.

Resposta: period, regionCode, periodStartedAt, topics. Cada tema: id, name, keywords, videoCount, totalViews, viewsInPeriod, period, hasFullPeriodData, actualHistorySeconds, maxHistorySeconds, capturedAt, topVideos. Contadores/somas são strings decimais para preservar precisão, inclusive acima de 2^53. Likes/comments opcionais não foram adicionados.

## Banco e estratégia de agregação
Nenhuma migration ou tabela nova. Reutiliza youtube_videos, youtube_video_regions, youtube_collection_regions e youtube_video_metric_snapshots; coleta horária preservada, sem snapshots próprios de temas ou exclusões.

VIDEO_PERIOD_SQL foi extraída para ser compartilhada com o Top 50. Último snapshot até o instante consultado; baseline é o primeiro dentro da janela. Sem baseline dentro da janela, usa o atual como baseline, crescimento zero e parcial. Delta = GREATEST(current - baseline, 0).

No banco: associação deduplicada por vídeo, COUNT para videoCount, SUM(numeric) para totalViews/viewsInPeriod, BOOL_AND para cobertura, MIN/MAX para histórico. Soma numeric suporta resultados maiores que BIGINT. Desempate de temas por ID. Não usa views históricas totais como crescimento.

## Cobertura e casos insuficientes
Tema completo somente quando TODOS os vídeos têm cobertura aproximada aceita pelo Top 50 (tolerância de uma hora e dois instantes distintos). actualHistorySeconds é o MENOR intervalo observado dos membros; maxHistorySeconds é o maior. capturedAt representa a observação atual mais antiga entre membros, conservadora quanto à atualização.

Snapshot único retorna delta zero parcial. Vídeos sem snapshots não têm métricas verificáveis e não são candidatos. Temas sem membros mensuráveis não aparecem. Vídeos novos não começam artificialmente em zero. A interface usa crescimento observado e explica que históricos diferentes não são diretamente comparáveis; períodos maiores que o histórico podem ter o mesmo ranking.

## Nome, identidade, keywords e vídeos
Nome/keywords vêm do clustering existente, sem LLM; até cinco keywords são retornadas/exibidas. ID lexical pode colidir: acrescentamos hash determinístico dos IDs dos membros. Mesmos membros/metadados mantêm a identidade, mas mudanças de membros ou keywords podem mudá-la. NÃO é identidade histórica persistente. GTA 6 / Grand Theft Auto VI não têm equivalência semântica garantida.

ROW_NUMBER seleciona os cinco vídeos de maior crescimento por tema, desempate por ID. A resposta inclui título, canal, thumbnail, currentViews, baselineViews, viewsInPeriod, timestamps e cobertura. As métricas agregam TODOS os vídeos; a expansão do card informa que é uma prévia dos cinco principais. Não foi criado endpoint de paginação de vídeos nesta etapa.

## Frontend e Estúdio
Página ?page=trending-topics em YouTube / Temas em Alta. Design dark, filtros reutilizando youtubePeriods, carregamento mantendo resultado anterior, cancelamento de requisições obsoletas, erro/retry, vazio, badges parciais, keywords com quebra de linha e detalhes nativos para vídeos. Valores compactos pt-BR via Intl com BigInt.

Estúdio resolve trendId pelo fluxo atual de clusters ao vivo; IDs de temas derivados de snapshots não são intercambiáveis. Botão Criar conteúdo desabilitado com Em breve. Futuro: referência VIDEO|TOPIC e resolução estável do contexto antes de ativar. Nenhuma geração ou navegação fake.

Revisão visual detectou menu expandido ao reduzir janela desktop→mobile: o Aside agora recolhe nessa transição, mantendo espaço legível para a página.

## Performance e cache
Número constante de queries: registro da região, metadados candidatos e agregação em lote. Nenhuma consulta individual por tema/vídeo na aplicação; nenhum histórico completo carregado no Node. Banco seleciona snapshots, soma, ordena e limita vídeos. EXPLAIN em PostgreSQL confirmou índice (video_id,captured_at) nas duas buscas LATERAL; não é benchmark de produção.

Sem cache novo. Não existe cliente Redis integrado ao backend atual. Com poucos candidatos e consultas indexadas, adicionar cache exige primeiro medir latência/carga. Clustering existente é aproximadamente O(n²), podendo ficar caro em milhares de candidatos; avaliar cache regional versionado pela coleta ou persistência de memberships após medir. Não foi imposto corte arbitrário nos candidatos.

## Arquivos criados
- api/src/sources/youtube/youtube-period.sql.ts
- api/trends/interfaces/trending-topic.interface.ts
- api/trends/trending-topics.service.ts, trending-topics.controller.ts, trending-topics.sql.ts
- api/trends/trending-topics.service.spec.ts, trending-topics.controller.spec.ts
- api/test/youtube/topics.integration.cjs, topics-browser.integration.cjs
- frontend/src/services/trendingTopicsService.js
- frontend/src/pages/TrendingTopics/TrendingTopics.jsx, TopicCard.jsx
- frontend/test/trendingTopics.test.mjs
- api/TRENDING_TOPICS_REPORT.md

## Arquivos alterados
- api/trends/topic-clustering.service.ts: lógica comum extraída, entrada sem score.
- api/trends/trends.module.ts: service/controller registrados.
- api/src/sources/youtube/youtube-metrics.repository.ts: candidatos e agregação em lote, SQL compartilhada.
- api/src/sources/youtube/youtube.module.ts: exporta repositório existente.
- api/test/youtube/ranking.integration.cjs: usa SQL compartilhada.
- api/package.json: test:topics, test:topics:integration.
- frontend/package.json: npm test sem novas dependências.
- frontend/src/App.jsx: nova página/URL.
- frontend/src/layouts/Aside/Aside.jsx: navegação e recolhimento no mobile.

## Validação
- Backend build/TypeScript aprovados.
- npm run test:topics: 7 suítes, 31 testes aprovados, incluindo regressão de clustering/Top 50.
- Lint backend em src e arquivos trends alterados: zero erros; warning preexistente de promise em src/main.ts.
- npm test -- --runInBand geral: 8 suítes aprovadas, 3 falhas preexistentes (Reddit/@nestjs/config ESM e cache IA/alias src); 23 testes aprovados. Fora deste escopo.
- PostgreSQL 17 descartável: temas e Top 50 aprovados. Soma, ranking DESC, videoCount, totalViews, crescimento, limites, parcial, vazio, snapshot único, deduplicação, topVideos, mais de 50 membros e BIGINT.
- Verificação manual: 100000 + 200000 + 350000 = 650000. SQL e endpoint HTTP com clustering/service reais retornaram 650000 e videoCount=3.
- HTTP: 200 na consulta válida e 400 para período/região/limites inválidos; sem APIs externas.
- Frontend build/lint/npm test aprovados. Testes Node/Vite cobrem loading/controles iniciais, cards, parcial, detalhes, parâmetros/signal de períodos, erro de serviço e resposta vazia.
- Chrome headless real: filtro/requisição/seleção, loading mantendo resultado anterior, ranking, parcial, expansão, erro HTTP simulado, retry, empty; sem exceções JavaScript/console.error. Responsividade em 1440, 768 e 390 px, checando overflow e recolhimento do menu. Captura mobile revisada.
- API do usuário não estava ativa na porta 3000 durante a tentativa de consulta. HTTP foi validado com aplicação Nest isolada e providers reais em banco descartável, sem iniciar coletores externos.

## Limitações e próximos passos
Considera vídeos acompanhados por região, não todo o catálogo YouTube. Temas com mais vídeos tendem a somar mais audiência; videoCount permite avaliação futura sem fórmula arbitrária. Clustering lexical pode gerar nomes pouco naturais e não garante equivalência semântica. IDs podem mudar; histórico curto produz períodos com resultados iguais.

Validar agrupamentos/nomes com dados reais, acompanhar cobertura/custo, definir identidade persistente antes de integrar Estúdio. Não foram implementados Trend Score, velocity, growthRate, acceleration, IA automática, cache novo, geração de conteúdo ou notificações.

## Comandos reproduzíveis
Backend: npm run build; npm run test:topics.
Integração: configurar YOUTUBE_TEST_DATABASE_URL para PostgreSQL descartável e executar npm run test:topics:integration; node test/youtube/ranking.integration.cjs.
Browser: após build, com banco descartável e Chrome, node test/youtube/topics-browser.integration.cjs (portas locais 33441–33443; encerra os serviços ao final).
Frontend: npm run build; npm run lint; npm test.
