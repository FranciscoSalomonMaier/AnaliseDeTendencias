jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
import { consolidateTopics, ClassifiedCluster } from './topic-consolidation';
import { TopicEntitiesService } from './topic-entities.service';
import { TopicNamingService } from './topic-naming.service';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../../src/ai/llm.provider';
const entities = new TopicEntitiesService();
const naming = new TopicNamingService(
  entities,
  {} as LlmProvider,
  { get: () => undefined } as unknown as ConfigService,
);
function group(
  id: string,
  title: string,
  vector: number[],
  tags: string[] = [],
  description = '',
  category = 'Gaming',
): ClassifiedCluster {
  const video = {
    id,
    snippet: {
      title,
      tags,
      description,
      channelTitle: 'Channel',
      publishedAt: '2026-01-01',
    },
    categoryTitle: category,
  };
  const cluster = {
    members: [
      {
        video,
        vector,
        sourceHash: id,
        entities: entities.extract(video).map((e) => e.name),
      },
    ],
    centroid: vector,
  };
  return {
    cluster,
    description: naming.heuristic(cluster) ?? naming.fallback(cluster),
  };
}
describe('canonical primary subjects and consolidation', () => {
  it('canonicalizes GTA aliases and Spider-Man', () => {
    for (const title of ['GTA V', 'GTA 5', 'Grand Theft Auto V'])
      expect(
        entities.primary(group('x', title, [1, 0]).cluster.members[0].video)
          ?.name,
      ).toBe('GTA 5');
    expect(entities.canonical('Spider-Man')).toBe('Homem-Aranha');
  });
  it('consolidates independently evidenced Roblox games despite different titles and moderate vectors', () => {
    const result = consolidateTopics(
      [
        group('a', 'Brookhaven Roblox', [1, 0]),
        group(
          'b',
          'Roube um Ovo atualização',
          [0.6, 0.8],
          ['Roblox'],
          'Roblox gameplay',
        ),
      ],
      entities,
    );
    expect(result).toHaveLength(1);
    expect(result[0].description.primaryTopic).toBe('Roblox');
    expect(result[0].cluster.members).toHaveLength(2);
  });
  it('selects GTA 5 as primary and retains superhero entities', () => {
    const g = group('a', 'Batman e Spider-Man no GTA V', [1, 0]);
    expect(g.description.primaryTopic).toBe('GTA 5');
    expect(g.description.entities).toEqual(
      expect.arrayContaining(['Batman', 'Homem-Aranha', 'GTA 5']),
    );
  });
  it('does not merge different subjects with identical vectors or incidental shared tags', () => {
    expect(
      consolidateTopics(
        [
          group('a', 'Minecraft survival', [1, 0], ['Roblox']),
          group('b', 'Roblox Brookhaven', [1, 0]),
        ],
        entities,
      ),
    ).toHaveLength(2);
  });
  it('generic category and tag-only evidence are insufficient', () => {
    expect(
      group('a', 'Receita de bolo', [1, 0], ['Roblox'], '', 'Entertainment')
        .description.primaryTopic,
    ).toBeUndefined();
    expect(
      consolidateTopics(
        [group('a', 'Novo jogo', [1, 0]), group('b', 'Outro jogo', [1, 0])],
        entities,
      ),
    ).toHaveLength(2);
  });
  it('rejects unrelated embeddings even for equal detected entities', () => {
    expect(
      consolidateTopics(
        [
          group('a', 'Roblox gameplay', [1, 0]),
          group('b', 'Roblox news', [0, 1]),
        ],
        entities,
      ),
    ).toHaveLength(2);
  });
  it('does not merge by display name or chain through a semantic bridge', () => {
    const a = group('a', 'Unknown', [1, 0]),
      b = group('b', 'Other', [1, 0]);
    a.description.name = b.description.name = 'Roblox';
    expect(consolidateTopics([a, b], entities)).toHaveLength(2);
    expect(
      consolidateTopics(
        [
          group('a', 'Roblox', [1, 0]),
          group('b', 'Roblox', [0.8, 0.6]),
          group('c', 'Roblox', [0.28, 0.96]),
        ],
        entities,
      ),
    ).toHaveLength(2);
  });
  it('requires artist corroboration and does not treat a song prefix as an artist', () => {
    const g = group(
      'a',
      'Se Cuida Aí | Cleber & Cauan, Panda',
      [1, 0],
      [],
      '',
      'Music',
    );
    g.cluster.members[0].video.snippet.channelTitle = 'Cleber & Cauan';
    expect(entities.primary(g.cluster.members[0].video)?.name).toBe(
      'Cleber & Cauan',
    );
    expect(
      entities.extract(g.cluster.members[0].video).map((e) => e.name),
    ).not.toContain('Se Cuida Aí');
  });
  it('identifies explicitly declared game instead of an ice cream business', () => {
    expect(
      group(
        'a',
        'Vendi sorvete na madrugada',
        [1, 0],
        ['The Sweet Spot'],
        'Nome do Jogo: The Sweet Spot',
      ).description.primaryTopic,
    ).toBe('The Sweet Spot');
  });
});
