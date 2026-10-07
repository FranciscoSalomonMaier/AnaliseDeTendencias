import { youtubeCollectionEvents } from '../../src/sources/youtube/youtube-collection-events';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'node:crypto';
import { TopicClusteringService } from '../topic-clustering.service';
import {
  SemanticTopicsRepository,
  TopicPublication,
} from './semantic-topics.repository';
import { SemanticTextBuilder } from './semantic-text.builder';
import { TopicEntitiesService } from './topic-entities.service';
import { TopicNamingService, TopicName } from './topic-naming.service';
import {
  SemanticCluster,
  SemanticVideo,
  StoredTopic,
} from './semantic-topic.interface';
import { consolidateTopics } from './topic-consolidation';
import { cosineSimilarity } from './semantic-math';
import { LlmProvider, LlmUsage } from '../../src/ai/llm.provider';

@Injectable()
export class SemanticTopicsProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SemanticTopicsProcessor.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly onCollected = () => {
    void this.process();
  };
  private nextEmbeddingRetry = 0;
  private readonly checkpoints = new Map<
    string,
    { hash: string; retryAt: number }
  >();
  constructor(
    private readonly repository: SemanticTopicsRepository,
    private readonly builder: SemanticTextBuilder,
    private readonly entities: TopicEntitiesService,
    private readonly clustering: TopicClusteringService,
    private readonly naming: TopicNamingService,
    private readonly provider: LlmProvider,
    private readonly config: ConfigService,
  ) {}
  settings() {
    const model =
      this.config.get<string>('OPENAI_EMBEDDING_MODEL') ??
      'text-embedding-3-small';
    const threshold = Number(
      this.config.get<string>('TOPIC_CLUSTER_SIMILARITY_THRESHOLD') ?? 0.75,
    );
    if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.95)
      throw new Error(
        'TOPIC_CLUSTER_SIMILARITY_THRESHOLD deve estar entre 0.5 e 0.95',
      );
    return { model, dimensions: 1536, threshold };
  }
  onApplicationBootstrap() {
    // Timer is a recovery/backfill worker. A successful collection also notifies it.
    youtubeCollectionEvents.on('updated', this.onCollected);
    this.timer = setInterval(() => void this.process(), 60_000);
    this.timer.unref();
    void this.process();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    youtubeCollectionEvents.off('updated', this.onCollected);
  }
  match(
    cluster: SemanticCluster,
    existing: StoredTopic[],
    used: Set<string>,
    description?: TopicName,
  ): StoredTopic | undefined {
    const ids = new Set(cluster.members.map((m) => m.video.id));
    const entities = this.entities
      .dominant(cluster.members.map((m) => m.video))
      .filter((e) => e.confidence >= 0.8)
      .map((e) => e.name);
    return existing
      .filter((t) => !used.has(t.id))
      .map((topic) => {
        const intersection = topic.member_ids.filter((id) =>
          ids.has(id),
        ).length;
        const overlap =
          intersection / (ids.size + topic.member_ids.length - intersection);
        const similarity = cosineSimilarity(cluster.centroid, topic.centroid);
        const sameEntity = entities.some((e) => topic.entities.includes(e));
        const samePrimary =
          description?.primaryTopic &&
          topic.primary_topic &&
          this.entities.key(description.primaryTopic) === topic.canonical_key &&
          (description.confidence ?? 0) >= 0.8 &&
          (topic.confidence ?? 0) >= 0.8;
        const compatiblePrimary =
          !description?.primaryTopic ||
          !topic.primary_topic ||
          this.entities.key(description.primaryTopic) === topic.canonical_key;
        const eligible =
          compatiblePrimary &&
          ((overlap >= 0.5 &&
            (similarity >= 0.75 ||
              (!cluster.centroid.length && overlap === 1))) ||
            (sameEntity && similarity >= 0.82) ||
            similarity >= 0.92 ||
            (samePrimary && similarity >= 0.55));
        return {
          topic,
          score: eligible
            ? overlap + similarity + (samePrimary ? 1 : sameEntity ? 0.1 : 0)
            : -1,
        };
      })
      .filter((t) => t.score >= 0)
      .sort(
        (a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id),
      )[0]?.topic;
  }
  async process() {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.repository.exclusive(async (client) => {
        const { model, dimensions, threshold } = this.settings();
        const summaries: Array<{
          region: string;
          diagnostics: Record<string, unknown>;
        }> = [];
        for (const region of await this.repository.regions(client)) {
          const videos = await this.repository.videos(client, region);
          const prepared = videos.map((video) => ({
            video,
            ...this.builder.build(video),
          }));
          const fingerprint = createHash('sha256')
            .update(
              JSON.stringify({
                model,
                threshold,
                version: 3,
                sources: prepared.map((item) => [item.video.id, item.hash]),
              }),
            )
            .digest('hex');
          const checkpoint = this.checkpoints.get(region);
          if (
            checkpoint?.hash === fingerprint &&
            Date.now() < checkpoint.retryAt
          )
            continue;
          const cache = new Map(
            (
              await this.repository.embeddings(
                client,
                videos.map((v) => v.id),
                model,
              )
            ).map((row) => [row.video_id, row]),
          );
          const missing = prepared.filter(
            (item) => cache.get(item.video.id)?.source_hash !== item.hash,
          );
          const embeddingUsage: LlmUsage = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          };
          let generated = 0,
            failed = 0;
          for (
            let offset = 0;
            offset < missing.length && Date.now() >= this.nextEmbeddingRetry;
            offset += 50
          ) {
            const batch = missing.slice(offset, offset + 50);
            try {
              const response = await this.provider.generateEmbeddings({
                model,
                dimensions,
                inputs: batch.map((item) => item.text),
              });
              if (response.vectors.length !== batch.length)
                throw new Error('Incomplete embedding batch');
              const rows = batch.map((item, i) => ({
                video_id: item.video.id,
                source_hash: item.hash,
                vector: response.vectors[i],
              }));
              await this.repository.saveEmbeddings(client, rows, model);
              rows.forEach((row) => cache.set(row.video_id, row));
              generated += rows.length;
              embeddingUsage.inputTokens += response.usage.inputTokens;
              embeddingUsage.outputTokens += response.usage.outputTokens;
              embeddingUsage.totalTokens += response.usage.totalTokens;
            } catch {
              this.nextEmbeddingRetry = Date.now() + 15 * 60_000;
              failed += batch.length;
              this.logger.warn(
                `Embeddings indisponíveis: região=${region} vídeos=${batch.length}. Próxima tentativa em segundo plano.`,
              );
            }
          }
          const semantic: SemanticVideo[] = prepared
            .filter(
              (item) => cache.get(item.video.id)?.source_hash === item.hash,
            )
            .map((item) => ({
              video: item.video,
              sourceHash: item.hash,
              vector: cache.get(item.video.id)!.vector,
              entities: this.entities.extract(item.video).map((e) => e.name),
              specificEntities: this.entities
                .extract(item.video)
                .filter((e) => e.specific)
                .map((e) => e.name),
            }));
          const ready = new Set(semantic.map((item) => item.video.id));
          const clusters = this.clustering.groupSemantically(
            semantic,
            threshold,
          );
          // Missing embeddings remain isolated; no invented semantic relationship.
          for (const item of prepared.filter(
            (item) => !ready.has(item.video.id),
          ))
            clusters.push({
              members: [
                {
                  video: item.video,
                  sourceHash: item.hash,
                  vector: [],
                  entities: this.entities
                    .extract(item.video)
                    .map((e) => e.name),
                },
              ],
              centroid: [],
            });
          clusters.sort(
            (a, b) =>
              b.members.length - a.members.length ||
              a.members[0].video.id.localeCompare(b.members[0].video.id),
          );
          const existing = await this.repository.existing(
              client,
              region,
              model,
            ),
            used = new Set<string>();
          const classificationCache = new Map(
            Object.values(existing).flatMap((topic) =>
              Object.entries(topic.classification_cache ?? {}),
            ),
          );
          const pending: Array<{ id: string; cluster: SemanticCluster }> = [];
          const descriptions = new Map<string, TopicName>();
          const assignments = clusters.map((cluster) => {
            const previous = this.match(
                cluster,
                existing,
                used,
                this.naming.heuristic(cluster) ?? undefined,
              ),
              id = previous?.id ?? randomUUID();
            used.add(id);
            const heuristic = this.naming.heuristic(cluster);
            const meaningful =
              !previous || previous.naming_hash !== this.naming.hash(cluster);
            const retry =
              previous?.naming_source === 'fallback' &&
              (!previous.retry_after ||
                previous.retry_after.getTime() <= Date.now());
            const cached = classificationCache.get(this.naming.hash(cluster));
            if (heuristic) descriptions.set(id, heuristic);
            else if (
              cached &&
              (cached.source !== 'fallback' ||
                (cached.retryAfter &&
                  new Date(cached.retryAfter).getTime() > Date.now()))
            )
              descriptions.set(id, cached);
            else if (previous && !meaningful && !retry)
              descriptions.set(id, {
                name: previous.name,
                primaryTopic: previous.primary_topic ?? undefined,
                entities: previous.entities,
                confidence: previous.confidence ?? 0,
                keywords: previous.keywords,
                source: previous.naming_source as TopicName['source'],
                hash: previous.naming_hash,
              });
            else if (cluster.centroid.length) pending.push({ id, cluster });
            else descriptions.set(id, this.naming.fallback(cluster));
            return { id, cluster, previous };
          });
          const named = await this.naming.nameAmbiguous(pending);
          named.names.forEach((value, id) => descriptions.set(id, value));
          const consolidated = consolidateTopics(
            assignments.map(({ id, cluster }) => ({
              cluster,
              description:
                descriptions.get(id) ?? this.naming.fallback(cluster),
            })),
            this.entities,
          );
          used.clear();
          const finalAssignments = consolidated.map(
            ({ cluster, description }) => {
              const previous = this.match(cluster, existing, used, description);
              const id = previous?.id ?? randomUUID();
              used.add(id);
              return { id, cluster, previous, description };
            },
          );
          const publications: TopicPublication[] = finalAssignments.map(
            ({ id, cluster, previous, description: name }) => {
              return {
                id,
                name: name.name,
                keywords: name.keywords,
                classification_cache: Object.fromEntries(
                  assignments
                    .filter((a) =>
                      a.cluster.members.every((m) =>
                        cluster.members.some(
                          (member) => member.video.id === m.video.id,
                        ),
                      ),
                    )
                    .map((a) => {
                      const value =
                        descriptions.get(a.id) ??
                        this.naming.fallback(a.cluster);
                      const hash = this.naming.hash(a.cluster);
                      const previousRetry =
                        classificationCache.get(hash)?.retryAfter;
                      const retryAfter =
                        value.source !== 'fallback'
                          ? null
                          : previousRetry &&
                              new Date(previousRetry).getTime() > Date.now()
                            ? previousRetry
                            : new Date(Date.now() + 86400000).toISOString();
                      return [hash, { ...value, retryAfter }];
                    }),
                ),
                primary_topic: name.primaryTopic ?? null,
                canonical_key: name.primaryTopic
                  ? this.entities.key(name.primaryTopic)
                  : null,
                confidence: name.confidence ?? 0,
                entities: name.entities ?? [],
                centroid: cluster.centroid,
                naming_source: name.source,
                naming_hash: this.naming.hash(cluster),
                member_ids: cluster.members.map((m) => m.video.id),
                retry_after:
                  name.source === 'fallback'
                    ? previous?.retry_after &&
                      previous.retry_after.getTime() > Date.now()
                      ? previous.retry_after
                      : new Date(Date.now() + 86400000)
                    : null,
              };
            },
          );
          const memberships = finalAssignments.flatMap(({ id, cluster }) =>
            cluster.members.map((m) => ({
              video_id: m.video.id,
              topic_id: id,
              source_hash: m.sourceHash,
            })),
          );
          await this.repository.publish(
            client,
            region,
            model,
            publications,
            memberships,
          );
          const diagnostics = {
            namingModel:
              this.config.get<string>('OPENAI_TOPIC_NAMING_MODEL') ??
              this.config.get<string>('OPENAI_MODEL') ??
              'gpt-5.6-luna',
            ...this.clustering.diagnostics(
              consolidated.map((c) => c.cluster.members.length),
            ),
            initialClusters: clusters.length,
            consolidatedClusters: consolidated.length,
            generated,
            reused: prepared.length - missing.length,
            failed,
            namingCalls: named.calls,
            heuristicNames: publications.filter(
              (p) => p.naming_source === 'entity',
            ).length,
            unidentified: publications.filter(
              (p) => p.naming_source === 'fallback',
            ).length,
          };
          // Skip unchanged runs to avoid a growing diagnostics log every minute.
          if (
            generated ||
            failed ||
            named.calls ||
            existing.length !== publications.length
          )
            await this.repository.record(
              client,
              region,
              model,
              threshold,
              diagnostics,
              embeddingUsage,
              named.usage,
            );
          if (this.config.get<string>('NODE_ENV') !== 'production')
            this.logger.debug(JSON.stringify({ region, ...diagnostics }));
          const namingRetry = publications
            .filter((p) => p.retry_after)
            .map((p) => p.retry_after!.getTime());
          const retryAt = Math.min(
            ...namingRetry,
            ready.size < prepared.length ? this.nextEmbeddingRetry : Infinity,
          );
          this.checkpoints.set(region, { hash: fingerprint, retryAt });
          summaries.push({ region, diagnostics });
        }
        return summaries;
      });
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error
          ? error.message
          : 'Falha no processamento semântico',
      );
      return null;
    } finally {
      this.running = false;
    }
  }
}
