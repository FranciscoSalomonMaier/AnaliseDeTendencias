# Top 50 por período

## Antes e depois
Antes: GET /youtube/popular consultava videos?chart=mostPopular e videoCategories em tempo real. Não havia entidades de vídeos, snapshots ou jobs. YoutubeNormalizerService convertia views/likes/comments em memória. MetricsService calculava views por idade do vídeo, engajamento e score, sem histórico. As únicas tabelas eram de cache de IA e geração de conteúdo.

Agora: GET /youtube/popular?regionCode=BR&period=today|7d|30d|1y consulta o PostgreSQL. Ranking dos vídeos acompanhados na região, ordenado pelo delta de views DESC, com desempate por ID e limite de 50. Nenhuma chamada ao YouTube ao trocar período. O frontend mantém a lista anterior durante carregamento, cancela requisições obsoletas e mostra erro, seleção, total, crescimento, data da coleta e histórico parcial. Formatação usa Intl pt-BR existente.

## Arquivos
Criados: migrations/001_youtube_metric_snapshots.sql; src/sources/youtube/youtube-metrics.repository.ts; youtube-period.ts; youtube-period.spec.ts; youtube-collector.ts; test/youtube/ranking.integration.cjs; este relatório.
Alterados: youtube.service.ts, youtube.controller.ts, youtube.module.ts e respectivos testes service/controller; frontend/src/services/youtubeService.js; frontend/src/pages/Youtube/YoutubeList.jsx.
Normalizer, MetricsService, IA e Estúdio não foram alterados.

## Banco e implantação
O projeto usa pg, não TypeORM; migration SQL transacional, idempotente e aditiva, sem synchronize e sem exclusões. Executada somente em PostgreSQL 17 descartável para testes. Aplicar a migration com o processo de implantação antes de iniciar a API. A aplicação não cria automaticamente essas tabelas.

- youtube_videos: ID externo TEXT PK e metadados JSONB.
- youtube_collection_regions: regiões solicitadas para coleta; BR inicial.
- youtube_video_regions: vínculo vídeo/região, FK e PK (region_code, video_id).
- youtube_video_metric_snapshots: id BIGINT identity PK, video_id TEXT FK, view_count BIGINT obrigatório, like_count/comment_count BIGINT opcionais, captured_at TIMESTAMPTZ real e capture_slot TIMESTAMPTZ horário.
- Índice único (video_id, capture_slot), índice (video_id, captured_at), índice captured_at. Contadores não negativos. Uma observação por vídeo/hora; novas coletas na mesma hora atualizam essa observação, sem inventar timestamp histórico.

## Coleta e cobertura
Não havia scheduler existente. Coletor inicia após bootstrap e repete a cada hora, sem sobreposição dentro do processo. Descobre mostPopular nas regiões registradas e atualiza vídeos conhecidos em lotes de até 50, excluindo os já coletados naquele ciclo. Consultas existentes de trends também persistem as statistics obtidas. Regiões novas são registradas no endpoint e entram no próximo ciclo; antes da primeira coleta a lista pode estar vazia.

Granularidade nominal de uma hora, dependente de uptime, quota, latência e erros da API. Uma única instância coletora é recomendada: múltiplas réplicas deduplicam armazenamento, mas não chamadas externas. Vídeos indisponíveis mantêm a última observação, explicitamente marcada como atrasada/parcial.

## Baseline e contrato
Hoje começa à meia-noite de Brasília (UTC-03); demais períodos são janelas móveis de 7/30/365 dias. Baseline: primeiro snapshot dentro da janela até a observação mais recente; snapshots anteriores ao início não são usados. Se nenhuma observação está na janela, usa a última como baseline, retorna zero e marca parcial. Um único snapshot também retorna zero parcial. Sem nenhum snapshot, não há delta calculável e o vídeo não entra no ranking.

Delta = max(currentViews - baselineViews, 0), calculado em BIGINT no banco. Strings decimais no JSON preservam precisão; Intl converte somente para apresentação compacta. Cada resultado preserva metadados originais e currentViews, baselineViews, viewsInPeriod, capturedAt, baselineCapturedAt, period, requestedPeriod, periodStartedAt, actualHistorySeconds e hasFullPeriodData.

hasFullPeriodData indica cobertura aproximada: baseline no máximo uma hora após o início, observação atual no máximo uma hora atrasada e dois instantes distintos. Não promete precisão no instante exato; a tolerância corresponde à coleta horária. Vídeos novos não começam artificialmente em zero. actualHistorySeconds descreve somente o intervalo observado. Históricos diferentes não são diretamente comparáveis.

## Performance
Uma consulta de ranking, com duas buscas LATERAL indexáveis por vídeo; nenhum histórico carregado no Node e nenhuma consulta por item. Uma escrita em lote atômica para metadados, região e snapshots. EXPLAIN executado em fixtures: PostgreSQL utilizou índice (video_id,captured_at) no primeiro ensaio; em tabela pequena também pode preferir seq scan. Validar EXPLAIN ANALYZE com volume representativo antes de escalar.

## Validação
- Backend build/TypeScript aprovados.
- Testes YouTube: 4 suítes, 10 testes aprovados, sem API real.
- Integração PostgreSQL real: migration, captura atômica, deduplicação, metadados, delta 2500-1000=1500, clamp negativo, parcial, novo, baseline, mais recente, ranking DESC, limite 50, snapshot único, ausência de snapshots, observação atrasada, BIGINT acima de 2^53 e EXPLAIN aprovados.
- Backend lint: sem erros após correção; aviso preexistente em src/main.ts sobre promise.
- Suíte geral possui falhas preexistentes: dois testes Reddit com @nestjs/config ESM e cache de IA com alias src não resolvido.
- Frontend build e lint aprovados. Não há script/suíte de testes frontend no projeto.
- Dados reais do banco do projeto não foram consultados; aritmética validada com fixtures reais no PostgreSQL temporário. Console e responsividade em navegador não foram verificados; filtro usa flex-wrap e tabela mantém scroll horizontal existente.

## Limitações e próximos passos
Não é ranking global de todo o YouTube: considera vídeos descobertos e acompanhados por região. Histórico começa na implantação; períodos longos ficam parciais até acumular dados. Aplicar migration, iniciar coleta, acompanhar quotas/falhas e revisar visualmente em desktop/mobile. Custos crescem com número de vídeos acompanhados. Futuramente centralizar liderança do coletor, monitorar atraso e avaliar materialização do ranking em escala.

Nenhuma retenção destrutiva implementada. Estratégia futura: observações horárias nos últimos 30 dias, agregação diária mais antiga preservando extremos e cobertura necessários para 365 dias. Definir e validar a política antes de excluir dados. growthRate, acceleration, trendScore e novas ordenações não foram implementados.

## Correção de implantação — 05/10/2026
O erro 42P01 (youtube_collection_regions ausente) ocorreu porque a migration ainda não havia sido aplicada ao banco da API. Ela foi aplicada ao DATABASE_URL configurado e as quatro tabelas foram verificadas, sem exclusões. Comando reproduzível: `cd api` e `npm run migrate:youtube`. O runner carrega api/.env, executa a migration transacional e verifica as tabelas. Reiniciar a API dispara o primeiro ciclo do coletor imediatamente; sem reinício, o próximo ciclo horário tenta novamente.
