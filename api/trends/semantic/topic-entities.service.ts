import { Injectable } from '@nestjs/common';
import { YouTubeVideo } from '../../src/sources/youtube/interfaces/youtube-video.interface';

// A small, explicit alias catalog supplements vectors; it is not a general NLP model.
const ENTITIES: Array<{ name: string; aliases: RegExp }> = [
  {
    name: 'Batman',
    aliases: /\bbatman\b|\bbruce wayne\b|\bgotham\b|\barkham\b/,
  },
  { name: 'GTA 6', aliases: /\bgta\s*(6|vi)\b|\bgrand theft auto\s*(6|vi)\b/ },
  { name: 'GTA 5', aliases: /\bgta\s*(5|v)\b|\bgrand theft auto\s*(5|v)\b/ },
  { name: 'Roblox', aliases: /\broblox\b/ },
  { name: 'Homem-Aranha', aliases: /\bspider[ -]?man\b|\bhomem[ -]?aranha\b/ },
  { name: 'Venom', aliases: /\bvenom\b/ },
  { name: 'Iron Man', aliases: /\biron man\b|\bhomem de ferro\b/ },
  { name: 'Roube um Ovo', aliases: /\broube um ovo\b|\bsteal an egg\b/ },
  { name: 'Brookhaven', aliases: /\bbrookhaven\b/ },
  { name: 'Blox Fruits', aliases: /\bblox fruits\b/ },
  { name: 'Vision Quest', aliases: /\bvision quest\b/ },
  { name: 'Marvel', aliases: /\bmarvel\b|\bmcu\b|\bucm\b/ },
  { name: 'Simone Mendes', aliases: /\bsimone mendes\b/ },
  { name: 'Minecraft', aliases: /\bminecraft\b|\bmojang\b/ },
  { name: 'Rockstar Games', aliases: /\brockstar(?: games)?\b/ },
  { name: 'PlayStation', aliases: /\bplaystation\b|\bps[345]\b/ },
  { name: 'Apple', aliases: /\bapple\b|\biphone\b|\bipad\b|\bmacbook\b/ },
  { name: 'OpenAI', aliases: /\bopenai\b|\bchatgpt\b/ },
  { name: 'Fortnite', aliases: /\bfortnite\b/ },
  { name: 'Raça Negra', aliases: /\braca negra\b/ },
];
export interface DetectedEntity {
  name: string;
  weight: number;
  specific: boolean;
}
@Injectable()
export class TopicEntitiesService {
  canonical(value: string): string {
    const normalized = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return (
      ENTITIES.find((e) =>
        new RegExp(`^(?:${e.aliases.source})$`).test(normalized),
      )?.name ?? value.trim()
    );
  }
  key(value: string): string {
    return this.canonical(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }
  primary(video: YouTubeVideo): { name: string; confidence: number } | null {
    const detected = this.extract(video);
    const title = video.snippet.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const description = (video.snippet.description ?? '').slice(0, 1500);
    const tags = (video.snippet.tags ?? []).join(' ').toLowerCase();
    const games = ['GTA 5', 'GTA 6', 'Roblox', 'Minecraft', 'Fortnite'];
    // An explicit game in the title takes precedence over characters or incidental tags.
    const explicitGames = detected.filter(
      (e) =>
        games.includes(e.name) &&
        ENTITIES.find((a) => a.name === e.name)!.aliases.test(title),
    );
    if (explicitGames.length > 1) return null;
    if (explicitGames.length === 1)
      return { name: explicitGames[0].name, confidence: 0.98 };
    const declared = description
      .match(/(?:nome do jogo|game name)\s*:\s*([^\n\r]+)/i)?.[1]
      ?.trim();
    if (
      declared &&
      declared.length >= 2 &&
      declared.length <= 70 &&
      !/https?:|@/.test(declared)
    )
      return { name: this.canonical(declared), confidence: 0.98 };
    const explicit = detected.filter((e) =>
      ENTITIES.find((a) => a.name === e.name)?.aliases.test(title),
    );
    const robloxSubtopics = ['Roube um Ovo', 'Brookhaven', 'Blox Fruits'];
    if (explicit.length === 1 && !robloxSubtopics.includes(explicit[0].name))
      return { name: explicit[0].name, confidence: 0.95 };
    // A tag alone is insufficient: require description or Gaming context, and no competing title subject.
    const gaming =
      video.snippet.categoryId === '20' ||
      /gaming|jogos/i.test(video.categoryTitle ?? '');
    const contextualGames = detected.filter(
      (e) =>
        games.includes(e.name) &&
        (e.weight >= 2.5 || gaming) &&
        tags.includes(e.name.toLowerCase()),
    );
    if (
      (explicit.length === 0 ||
        explicit.every((e) => robloxSubtopics.includes(e.name))) &&
      contextualGames.length === 1
    )
      return { name: contextualGames[0].name, confidence: 0.9 };
    if (
      explicit.length === 1 &&
      robloxSubtopics.includes(explicit[0].name) &&
      (gaming || /\broblox\b/i.test(description))
    )
      return { name: 'Roblox', confidence: 0.9 };
    if (explicit.length === 1)
      return { name: explicit[0].name, confidence: 0.95 };
    if (detected.length === 1 && detected[0].specific)
      return { name: detected[0].name, confidence: 0.9 };
    return null;
  }
  extract(video: YouTubeVideo): DetectedEntity[] {
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const title = normalize(video.snippet.title);
    const tags = normalize((video.snippet.tags ?? []).join(' '));
    const description = normalize(
      (video.snippet.description ?? '').slice(0, 700),
    );
    const detected = ENTITIES.flatMap((entity) => {
      const weight =
        (entity.aliases.test(title) ? 3 : 0) +
        (entity.aliases.test(tags) ? 2 : 0) +
        (entity.aliases.test(description) ? 0.5 : 0);
      return weight >= 2
        ? [
            {
              name: entity.name,
              weight,
              specific:
                [
                  'Batman',
                  'GTA 5',
                  'GTA 6',
                  'Minecraft',
                  'Roblox',
                  'Fortnite',
                  'Simone Mendes',
                  'Raça Negra',
                ].includes(entity.name) && entity.aliases.test(title),
            },
          ]
        : [];
    });
    if (
      video.snippet.categoryId === '10' ||
      /music|m[uú]sica/i.test(video.categoryTitle ?? '')
    ) {
      const artistName = video.snippet.channelTitle
        .replace(/\s*-\s*Topic$|\s+Oficial$/i, '')
        .trim();
      const artistNormalize = (value: string) =>
        normalize(value)
          .replace(/&/g, 'e')
          .replace(/[^a-z0-9]/g, '');
      const corroborated =
        artistName.length >= 3 &&
        artistName.length <= 70 &&
        artistName.split(/\s+/).length <= 7 &&
        artistNormalize(video.snippet.title).includes(
          artistNormalize(artistName),
        );
      if (
        corroborated &&
        !detected.some(
          (e) => artistNormalize(e.name) === artistNormalize(artistName),
        )
      )
        detected.push({ name: artistName, weight: 3, specific: true });
      const prefix = video.snippet.title
        .split(/\s[-|]\s/)[0]
        .replace(/[^\p{L}\p{N}\s,&]/gu, '')
        .trim();
      if (
        prefix !== video.snippet.title &&
        prefix.length >= 3 &&
        prefix.length <= 70 &&
        !/\d|playlist|melhores|trailer|oficial|vota|rap do|musicas|partido/i.test(
          prefix,
        )
      ) {
        for (const artist of prefix.split(/,|\sfeat\.?\s|\spart\.?\s/i)) {
          const name = artist.trim();
          if (
            name &&
            name.split(/\s+/).length <= 7 &&
            (artistNormalize(video.snippet.channelTitle).includes(
              artistNormalize(name),
            ) ||
              new RegExp(
                `vocals:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
                'i',
              ).test(video.snippet.description ?? '')) &&
            !detected.some((e) => normalize(e.name) === normalize(name))
          )
            detected.push({ name, weight: 3, specific: true });
        }
      }
    }
    return detected.sort(
      (a, b) => b.weight - a.weight || a.name.localeCompare(b.name),
    );
  }
  keywords(videos: YouTubeVideo[], primaryName: string): string[] {
    const text = videos
      .map((v) => [v.snippet.title, ...(v.snippet.tags ?? [])].join(' '))
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const contextual: Array<[string, RegExp]> = [
      ['Gotham', /\bgotham\b/],
      ['Joker', /\bjoker\b/],
      ['Bruce Wayne', /\bbruce wayne\b/],
      ['Arkham', /\barkham\b/],
      ['Rockstar', /\brockstar\b/],
      ['Trailer', /\btrailer\b/],
      ['Gameplay', /\bgameplay\b/],
      ['Shows', /\bshow|\bshows|\bapresentacao/],
      ['Sertanejo', /\bsertanejo\b/],
      ['Sobrevivência', /\bsurvival|\bsobrevivencia/],
      ['Roblox', /\broblox\b/],
      ['Minecraft', /\bminecraft\b/],
    ];
    return [
      ...new Set([
        primaryName,
        ...this.dominant(videos)
          .filter((e) => e.confidence >= 0.8)
          .map((e) => e.name),
        ...contextual
          .filter(([, pattern]) => pattern.test(text))
          .map(([name]) => name),
      ]),
    ].slice(0, 8);
  }

  dominant(videos: YouTubeVideo[]) {
    const counts = new Map<string, { support: number; weight: number }>();
    for (const video of videos)
      for (const entity of this.extract(video)) {
        const previous = counts.get(entity.name) ?? { support: 0, weight: 0 };
        counts.set(entity.name, {
          support: previous.support + 1,
          weight: previous.weight + entity.weight,
        });
      }
    return [...counts.entries()]
      .map(([name, data]) => ({
        name,
        ...data,
        confidence: data.support / videos.length,
      }))
      .sort(
        (a, b) =>
          b.support - a.support ||
          b.weight - a.weight ||
          a.name.localeCompare(b.name),
      );
  }
}
