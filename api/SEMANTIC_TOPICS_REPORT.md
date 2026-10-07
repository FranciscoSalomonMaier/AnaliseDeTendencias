> A consolidação de assuntos principais foi atualizada. Consulte [CANONICAL_TOPICS_REPORT.md](CANONICAL_TOPICS_REPORT.md) para o diagnóstico atual, a correção e a comparação com os mesmos 105 vídeos. Este documento preserva a avaliação da etapa anterior.

# Correção semântica de Temas em Alta — 05/10/2026

## Diagnóstico e causa
O fluxo anterior comparava palavras de title/tags (peso 3/2), description (peso 1, primeiros 20 tokens) e category (0,5). Similaridade Jaccard ponderada, participação 75% do título/tags, 20% do texto e 5% da categoria; limiar 0,32, associação incremental por similaridade média. Canal não participava. Não havia TF-IDF, stemming, embeddings ou compreensão semântica. O nome era a junção dos cinco termos mais pontuados. Pouco vocabulário em comum fragmentava títulos diferentes sobre o mesmo assunto; nomes eram palavras reorganizadas, inclusive termos técnicos/números. Clusters eram recalculados no GET, com IDs derivados de palavras/membros.

## Estratégia implementada
Texto representativo → embedding persistido → TopicClusteringService.groupSemantically → entidades/centroid → TopicNamingService → tema/associação persistidos → agregação de snapshots existente.

A abstração LlmProvider existente foi estendida com generateEmbeddings, implementada pelo mesmo OpenAiLlmProvider. Compartilha OPENAI_API_KEY, timeout, retries e tratamento de erros; nenhuma segunda configuração de chave ou chamada direta ao SDK dentro do clustering. Os métodos lexicais antigos são preservados para o fluxo de IA/Estúdio e para diagnóstico comparativo. Não foi criado outro serviço de clustering.

Modelo: text-embedding-3-small, 1536 dimensões. O SDK instalado suporta entradas em array e dimensions; veja a [documentação oficial de embeddings](https://developers.openai.com/api/docs/guides/embeddings). OPENAI_EMBEDDING_MODEL permite configuração de outro modelo compatível com o parâmetro dimensions. Nomeação usa OPENAI_TOPIC_NAMING_MODEL se definido, senão o OPENAI_MODEL existente; nenhuma troca automática do modelo configurado.

## Texto e reutilização
SemanticTextBuilder usa título (350 caracteres), até 20 tags deduplicadas/ordenadas (100 caracteres cada), até cinco linhas informativas de descrição (700 caracteres) e nome textual da categoria (80 caracteres). Remove URLs, hashtags, handles, CTAs, cupons, créditos/propaganda e linhas de links. Não inclui videoId, categoryId numérico, contadores ou timestamps. Categoria dá contexto e não define o tema. Canal não é usado, para evitar agrupar por produtor em vez de assunto. Não há transcrição/análise do vídeo.

SHA-256 do texto normalizado controla invalidação. Mudança relevante de título/tags/descrição/categoria gera outro embedding; alteração de views/likes/comments não. Cache PostgreSQL por (video_id, model) armazena source_hash e vector DOUBLE PRECISION[]. Sem pgvector: banco tinha apenas plpgsql, e o volume atual permite similaridade no backend. Não instalamos extensões, Redis, BullMQ ou bibliotecas NLP.

## Clustering, threshold e centroid
Cosine similarity; embeddings precisam ter dimensões iguais, valores finitos e norma não nula. Complete-link aglomerativo com ordem/tie-break determinísticos: todos os pares de um grupo precisam atingir o limiar. Distâncias de linkage são atualizadas por mínimo; evita cadeias de single-link e dependência da ordem de entrada. Centroid é a média dos vetores, normalizada.

Entidade compartilhada dá bônus pequeno de 0,04 na similaridade, nunca une vídeos por si só. Jogos/entidades específicas explicitamente conflitantes nos títulos impedem a união; tags genéricas não substituem evidência do título. Prefixos plausíveis de artista em títulos de música complementam o catálogo. Não reduzimos o limiar para obrigar vídeos não relacionados a se juntar.

Limiar final: TOPIC_CLUSTER_SIMILARITY_THRESHOLD=0.75. Avaliado em seis valores sobre os MESMOS 60 IDs reais, usando embeddings persistidos e sem novas chamadas para comparar thresholds. Valores 0,60/0,65 criaram grupos amplos demais; 0,80 voltou a fragmentar quase todos. 0,75 preservou grupos claros de Minecraft/Roblox e foi mais conservador para músicas de artistas diferentes. É calibração inicial por inspeção, não um benchmark rotulado definitivo.

## Entidades e naming
Catálogo pequeno de aliases: Batman/Bruce Wayne/Gotham/Arkham, GTA 6/GTA VI, GTA 5/GTA V, Roblox, Simone Mendes, Minecraft/Mojang, Rockstar Games, PlayStation, Apple/iPhone/iPad/MacBook, OpenAI/ChatGPT, Fortnite e Raça Negra. Complemento conservador de prefixos de artista em categoria de música. Entidades reconhecidas em título têm mais peso; tags/descrição corroboram. Não é um sistema universal de NER; catálogo pode ser ampliado.

Nome determinístico quando uma entidade está associada a pelo menos 80% dos membros e não há empate de evidência. Keywords contextuais incluem somente termos encontrados nos títulos/tags (ex.: Gotham, Joker, Bruce Wayne, Trailer, Gameplay); entidades minoritárias não viram nome obrigatório do tema.

Casos ambíguos são nomeados em lotes de até 10 pelo provider de LLM existente, com Structured Outputs/Zod: id, name (2–70 caracteres), keywords (3–8, até 45 caracteres cada), confidence. IDs/quantidade são validados; não há parsing por regex de JSON. A nomeação recebe até cinco títulos/tags/contextos e entidades, tratados como dados, não instruções. Um nome de entidade minoritária é rejeitado; confiança abaixo de 0,6 usa fallback.

LLM chamado somente no processamento de cluster novo, mudança significativa de membros/centroid, ou retry de fallback após 24h. Nomes publicados são reutilizados. Heurística forte dispensa LLM. Falha/ambiguidade retorna Tema não identificado em vez de cinco palavras aleatórias; não derruba o ranking. Keywords heurísticas podem ter menos de três termos quando não há evidência suficiente para inventar mais.

## Identidade e publicação
UUID persistido por tema/região/modelo. Reutiliza tópico anterior por sobreposição de membros e similaridade de centroid; entidade dominante reforça o match. Matching um-a-um, com desempate determinístico, impede dar o mesmo ID a dois grupos distintos no mesmo processamento. Splits/merges podem criar IDs novos; não há garantia absoluta de identidade em deriva semântica forte ou troca de modelo. Clusters conservadores de subassuntos podem ter o mesmo nome de entidade com IDs diferentes.

Embedding cache pode ser salvo por lote; temas e todas as associações da região são publicados em uma transação. As associações são atualizadas por UPSERT, não por exclusão. Tópicos antigos continuam no banco, sem apagar histórico/dados. Lock advisory PostgreSQL de sessão garante um único worker semântico entre processos; liberado em finally.

## Processamento e GET
Coletor YouTube existente emite sinal após coleta bem-sucedida. Worker semântico independente inicia no bootstrap e verifica recuperação/backfill a cada minuto. Usa checkpoint dos hashes/configuração para pular dados inalterados dentro do processo. Não bloqueia o bootstrap ou requisições de ranking. Embeddings em lotes de 50; SDK com timeout existente/retry limitado. Falha de embeddings tem backoff de 15 minutos. Lotes já persistidos são reutilizados; vídeos sem embedding válido ficam isolados, sem relação semântica inventada. Fallback naming tem cooldown de 24h.

GET /trends/youtube/topics mantém o contrato/períodos/limite anteriores. TrendingTopicsService agora depende somente do repositório de métricas; lê associação/nome já publicados e passa memberships à mesma agregação PostgreSQL. Não injeta provider, normalizer ou clustering. Consulta não gera embeddings/names nem muda processamento semântico. Os quatro períodos reais foram verificados; nenhum processamento foi disparado pelo GET.

videoCount, totalViews, viewsInPeriod, keywords, topVideos e cobertura parcial continuam. Crescimento vem do delta de snapshots; não usa total histórico nem filtro de publicação. Nenhuma mudança no Estúdio, MetricsService, análise automática, geração de conteúdo ou Trend Score. Nenhuma alteração no código de produção do frontend foi necessária.

## Migration
002_semantic_topics.sql, transacional/aditiva, aplicada e verificada no banco configurado, sem exclusões. Projeto usa pg/migrations SQL, não TypeORM; seguimos o padrão real, sem synchronize.

- youtube_video_embeddings: video_id FK, model, source_hash, vector float8[], updated_at; PK(video_id, model).
- youtube_semantic_topics: UUID PK, region_code, model, name, keywords, entities, centroid float8[], naming_source/hash, member_ids, retry_after, updated_at; índice region/model.
- youtube_video_topics: region_code + video_id PK, topic_id FK, source_hash; índice topic_id.
- youtube_semantic_processing_runs: identity BIGINT, região/modelo/threshold, distribuição/contagens JSONB, embedding_usage e naming_usage separados, data.

npm run migrate:youtube aplica as migrations 001 e 002 idempotentemente. Rollout: migration → deploy/reinício da API → backfill em segundo plano ou npm run process:topics após build. IDs/estatísticas de vídeos e snapshots não foram apagados.

## Comparação controlada

| Medida | Antes | Depois (0,75) |
|---|---:|---:|
| Vídeos | 60 | 60 |
| Clusters | 58 | 45 |
| Unitários | 56 | 36 |
| Com 2 vídeos | 2 | 7 |
| Com 3+ vídeos | 0 | 2 |
| Maior cluster | 2 | 5 |
| Média vídeos/cluster | 1.034 | 1.333 |

| Threshold | Clusters | Unitários | Maior |
|---|---:|---:|---:|
| 0.6 | 18 | 5 | 10 |
| 0.65 | 21 | 8 | 8 |
| 0.7 | 35 | 23 | 7 |
| 0.72 | 40 | 29 | 5 |
| 0.75 | 45 | 36 | 5 |
| 0.8 | 55 | 52 | 4 |

A coleta continuou durante a implementação: houve um processamento posterior com 98 vídeos (66 clusters, 46 unitários, maior 8), que NÃO foi usado como comparação direta contra a amostra inicial. reports/topics-comparison.json confirma sameVideoIds=true para a comparação de 60 vídeos. Um cluster unitário continua legítimo; a melhoria não é medida só pela quantidade de grupos.

## Exemplos reais para inspeção
Os exemplos abaixo vêm da consulta real de Hoje na data da verificação, ordenada por crescimento; a coleção continua mudando. A comparação controlada acima é independente deste ranking ao vivo.

- **GTA 5 com super-heróis** — 2 vídeos; crescimento observado 867983. Keywords: GTA 5, Batman, Homem-Aranha, Venom, Iron Man.
  - الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero
  - الرجل العنكبوت انقاذ باتمان Spider-Man Rescue batman vs iron man vs venom funny Game GTA 5 superhero

- **Roblox** — 2 vídeos; crescimento observado 453096. Keywords: Roblox, Gameplay.
  - Steal an Egg But I Turned My Friends Into BOSSES!
  - Steal an Egg Bosses Characters in REAL LIFE!

- **The Sweet Spot** — 1 vídeos; crescimento observado 434656. Keywords: The Sweet Spot, sorveteria, sorvete, venda de sorvete.
  - TÁ CALOR, ENTÃO EU COMECEI A VENDER SORVETE... DE MADRUGADA!

- **Simone Mendes** — 1 vídeos; crescimento observado 392014. Keywords: Simone Mendes.
  - Simone Mendes - CÊ PERDEU (O MELHOR DE MIM)

- **Trailer de Vision Quest** — 1 vídeos; crescimento observado 355767. Keywords: Vision Quest, Ultron, Marvel, Visão, Jocasta.
  - ULTRON ESCAPOU! É O FIM DO MUNDO? ANÁLISE COMPLETA DO TRAILER DE VISION QUEST

- **Roblox** — 5 vídeos; crescimento observado 298144. Keywords: Roblox.
  - 🦋 NOVO BIOMA FLORESTA ENCANTADA NO ROUBE UM OVO DO ROBLOX! SEGREDOS E NOVIDADES!
  - ROUBANDO OVOS NO ROBLOX!

- **Se Cuida Aí** — 1 vídeos; crescimento observado 252236. Keywords: Se Cuida Aí, Sertanejo.
  - Se Cuida Aí | Cleber & Cauan, Panda [ Resenha na Fazenda ]

- **Minecraft** — 8 vídeos; crescimento observado 226590. Keywords: Minecraft, Sobrevivência, Roblox.
  - Limpe Todas as Folhas em 1 Hora!
  - CRIEI A DIMENSÃO QUE A MOJANG NÃO TEVE CORAGEM

- **Roblox** — 2 vídeos; crescimento observado 212779. Keywords: Roblox.
  - AJUDEI o SR ABOBORA do HALLOWEEN na NOVA ATUALIZAÇÃO do 99 NOITES NA FLORESTA 🎃🦇
  - NUNCA ENTRE NA CASA DE DOCES DA BRUXA MALVADA (Escape Roblox)

- **Call of Duty: Modern Warfare 4 — DMZ** — 1 vídeos; crescimento observado 197544. Keywords: Call of Duty, Modern Warfare 4, DMZ, Worldbuilder Trailer, Activision.
  - Call of Duty: Modern Warfare 4 | DMZ Worldbuilder Trailer

## Custo/usage observado
Nenhuma chamada ao abrir a página. Na primeira amostra: 60 embeddings em 2 lotes, 7591 tokens de embedding; 4 lotes de naming, 11242 tokens (8201 entrada, 3041 saída). Na reavaliação: 60 reutilizados, 0 embeddings novos; 1 lote de naming, 3802 tokens. Worker posterior com 38 vídeos novos: 4901 tokens de embedding e 6515 de naming. Valores são os retornados pelos providers, não preços monetários e não um limite de gastos futuro. Aumentam somente com metadados novos/alterados e novos clusters ambíguos/retries.

Usage é registrado separadamente por finalidade no PostgreSQL. Diagnósticos de desenvolvimento incluem novos/reutilizados/falhos, distribuição e chamadas de naming; logs de distribuição são desativados em NODE_ENV=production. Registros não são gravados por cada tick inalterado. Falhas abruptas de processo/DB entre uma chamada e seu registro não constituem um ledger de cobrança completo.

## Arquivos desta correção
Criados: migrations/002_semantic_topics.sql; trends/semantic/semantic-text.builder.ts; semantic-math.ts; semantic-topic.interface.ts; topic-entities.service.ts; topic-naming.service.ts; semantic-topics.repository.ts; semantic-topics.processor.ts; semantic.spec.ts; semantic-topics.processor.spec.ts; src/sources/youtube/youtube-collection-events.ts; test/youtube/semantic-persistence.integration.cjs; scripts/diagnose-topics.cjs; process-semantic-topics.cjs; verify-semantic-topics.cjs; compare-semantic-topics.cjs; reports/topics-before.json, topics-initial-evaluation.json, topics-after.json, topics-comparison.json, topics-verified.json; este relatório.

Alterados: src/ai/llm.provider.ts, openai-llm.provider.ts e testes; src/database/postgres-database.service.ts (conexão dedicada para lock/transação); youtube-collector.ts (sinal após coleta); youtube-metrics.repository.ts (leitura de memberships persistidos); trends/topic-clustering.service.ts (método semântico e diagnósticos); trends/trending-topics.service.ts e testes (GET persistido); trends/trends.module.ts (providers); scripts/migrate-youtube.cjs; package.json (scripts); .env.example (model/threshold opcionais); test/youtube/topics-browser.integration.cjs (fixtures persistidas). Demais mudanças anteriores no workspace pertencem às tarefas anteriores.

## Validação técnica
- Backend build/TypeScript aprovados.
- 10 suítes, 55 testes do escopo aprovados, todos com providers mockados. Cobrem texto/hash, cosine/centroid, threshold, grupos Batman/GTA6/Simone, iPhone separado de Minecraft, ordem estável, conflitos de entidades, singleton, deduplicação, naming estruturado/fallback, falhas de embedding/LLM, cache, invalidação e preservação do UUID/GET sem IA.
- Lint do backend e arquivos trends alterados: zero erros; warning preexistente em src/main.ts.
- Integração PostgreSQL 17 descartável: migrations, arrays de vetores, cache por modelo/hash, UPSERT, publicação atômica com rollback em FK inválida, identidade, lock/release entre sessões e usage separado aprovados.
- Regressões PostgreSQL de Top 50/agregação por tema aprovadas; 100000+200000+350000=650000, BIGINT, parcial, limite e topVideos preservados. EXPLAIN segue usando índices de snapshots.
- HTTP/Chrome: consultas com memberships persistidos, erro de parâmetro, ranking, filtros, loading/retry/empty, vídeos, console e responsividade 1440/768/390 aprovados, sem providers externos nos testes.
- Suíte npm test geral mantém 3 falhas preexistentes (Reddit/@nestjs/config ESM e cache IA/alias src); não corrigidas fora do escopo.
- Frontend de produção não foi modificado nesta correção; regressão de navegador passou com o mesmo contrato. Nenhuma key/chamada OpenAI de frontend foi introduzida. Segredos não aparecem nos relatórios; diagnóstico registra apenas booleano de configuração.

## Limitações e próximos passos
Embeddings aproximam assuntos e formatos, não substituem uma avaliação rotulada. Descrições/tags ruidosas, categoria incorreta e nomes genéricos podem causar erros; o catálogo de entidades é parcial. Nomes de LLM podem ser imprecisos mesmo com schema/confidence. Há um fallback não identificado na amostra final; não foi mascarado. Clusters distintos podem ter o mesmo nome amplo de entidade (ex.: Roblox) quando os subassuntos não atingem complete-link; revisar a granularidade desejada antes de fundi-los.

Complete-link exige memória O(n²) e custo de cálculo O(n²·dimensões + n³); adequado à amostra atual, não a milhões de vídeos. O GET continua leve, mas o job pode precisar de pré-seleção/vetor-index/pgvector no futuro. Vetores ficam em arrays e a identidade por centroid é uma aproximação, sem resolução universal de aliases ou histórico de merges. Mudança de modelo exige novos embeddings e pode produzir novos IDs.

Próximo passo: inspecionar os exemplos/relatórios e criar uma amostra rotulada de assuntos, medir precisão/recall, calibrar threshold/bônus de entidade e decidir a granularidade dos temas. Expandir entidades conforme evidência real. Não implementamos growthRate, Trend Score, IA de oportunidades ou integração de geração/Estúdio.
