import { SemanticCluster } from './semantic-topic.interface';
import { TopicName } from './topic-naming.service';
import { TopicEntitiesService } from './topic-entities.service';
import { centroid, cosineSimilarity } from './semantic-math';

export interface ClassifiedCluster {
  cluster: SemanticCluster;
  description: TopicName;
}

// Complete-link over original cluster centroids prevents a sequence of weak merges.
// .55 is a rejection gate for independently evidenced canonical subjects, not
// a replacement for the initial .75 semantic threshold. LLM-only evidence requires .75.
export function compatibleTopics(
  a: ClassifiedCluster,
  b: ClassifiedCluster,
  entities: TopicEntitiesService,
): boolean {
  const left = a.description,
    right = b.description;
  if (
    !left.primaryTopic ||
    !right.primaryTopic ||
    (left.confidence ?? 0) < 0.8 ||
    (right.confidence ?? 0) < 0.8 ||
    entities.key(left.primaryTopic) !== entities.key(right.primaryTopic)
  )
    return false;
  if (!a.cluster.centroid.length || !b.cluster.centroid.length) return false;
  const evidenced = [a, b].every((group) =>
    group.cluster.members.every((m) => {
      const primary = entities.primary(m.video);
      return (
        primary &&
        entities.key(primary.name) ===
          entities.key(group.description.primaryTopic!)
      );
    }),
  );
  return (
    cosineSimilarity(a.cluster.centroid, b.cluster.centroid) >=
    (evidenced ? 0.55 : 0.75)
  );
}

export function consolidateTopics(
  input: ClassifiedCluster[],
  entities: TopicEntitiesService,
): ClassifiedCluster[] {
  const groups: ClassifiedCluster[][] = [];
  for (const item of [...input].sort(
    (a, b) =>
      b.cluster.members.length - a.cluster.members.length ||
      a.cluster.members[0].video.id.localeCompare(
        b.cluster.members[0].video.id,
      ),
  )) {
    const target = groups.find((group) =>
      group.every((previous) => compatibleTopics(previous, item, entities)),
    );
    if (target) target.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => {
    if (group.length === 1) return group[0];
    const members = group
      .flatMap((g) => g.cluster.members)
      .sort((a, b) => a.video.id.localeCompare(b.video.id));
    const primaryTopic = group[0].description.primaryTopic!;
    return {
      cluster: { members, centroid: centroid(members.map((m) => m.vector)) },
      description: {
        ...group[0].description,
        name: primaryTopic,
        primaryTopic,
        entities: [
          ...new Set(
            group
              .flatMap((g) => g.description.entities ?? [])
              .concat(primaryTopic),
          ),
        ],
        keywords: [
          ...new Set([
            ...entities.keywords(
              members.map((m) => m.video),
              primaryTopic,
            ),
            ...group.flatMap((g) => g.description.keywords),
          ]),
        ].slice(0, 8),
        confidence: Math.min(
          ...group.map((g) => g.description.confidence ?? 0),
        ),
      },
    };
  });
}
