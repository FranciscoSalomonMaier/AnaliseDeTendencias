import { Injectable } from '@nestjs/common';
import { AnalyzedTrendItem } from './interfaces/analyzed-trend-item/analyzed-trend-item.interface';
import { TopicClusterMetrics } from './interfaces/topic-cluster-metrics/topic-cluster-metrics.interface';
import { TopicCluster } from './interfaces/topic-cluster/topic-cluster.interface';

type WeightedTerms = Map<string, number>;

interface PreparedItem {
  item: AnalyzedTrendItem;
  terms: WeightedTerms;
  titleTerms: WeightedTerms;
}

interface ClusterDraft {
  members: PreparedItem[];
}

@Injectable()
export class TopicClusteringService {
  private static readonly TITLE_WEIGHT = 3;
  private static readonly TAG_WEIGHT = 2;
  private static readonly DESCRIPTION_WEIGHT = 1;
  private static readonly CATEGORY_WEIGHT = 0.5;

  // Um valor moderado funciona bem para títulos curtos sem unir assuntos
  // apenas por uma palavra genérica ou pela categoria do YouTube.
  private static readonly SIMILARITY_THRESHOLD = 0.32;
  private static readonly TITLE_SIMILARITY_SHARE = 0.75;
  private static readonly FULL_TEXT_SIMILARITY_SHARE = 0.2;
  private static readonly CATEGORY_SIMILARITY_SHARE = 0.05;
  private static readonly MAX_DESCRIPTION_TOKENS = 20;

  private static readonly STOPWORDS = new Set([
    'a',
    'o',
    'as',
    'os',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'em',
    'para',
    'por',
    'com',
    'um',
    'uma',
    'e',
    'ou',
    'que',
    'no',
    'na',
    'nos',
    'nas',
    'ao',
    'aos',
    'se',
    'seu',
    'sua',
    'seus',
    'suas',
    'the',
    'an',
    'of',
    'to',
    'in',
    'for',
    'on',
    'with',
    'and',
    'or',
    'is',
    'are',
    'this',
  ]);

  private static readonly GENERIC_TERMS = new Set([
    'video',
    'oficial',
    'official',
    'novo',
    'nova',
    'hoje',
    'melhor',
    'trailer',
    'react',
    'reaction',
    'review',
    'live',
  ]);

  groupByTopic(items: AnalyzedTrendItem[]): TopicCluster[] {
    if (items.length === 0) {
      return [];
    }

    const preparedItems = items.map((item) => this.prepareItem(item));
    const drafts: ClusterDraft[] = [];

    for (const prepared of preparedItems) {
      const candidate = this.findBestCluster(prepared, drafts);

      if (candidate) {
        candidate.members.push(prepared);
      } else {
        drafts.push({ members: [prepared] });
      }
    }

    const clusters = drafts.map((draft) => this.createCluster(draft));
    const maximumViewsPerHour = Math.max(
      ...clusters.map((cluster) => cluster.metrics.averageViewsPerHour),
      0,
    );

    return clusters
      .map((cluster) => ({
        ...cluster,
        relevanceScore: this.calculateRelevanceScore(
          cluster,
          maximumViewsPerHour,
        ),
      }))
      .sort(
        (first, second) =>
          second.relevanceScore - first.relevanceScore ||
          first.id.localeCompare(second.id),
      );
  }

  private prepareItem(item: AnalyzedTrendItem): PreparedItem {
    const titleTokens = this.tokenize(item.title);
    const tagTokens = this.tokenize(item.tags.join(' '));
    const descriptionTokens = this.tokenize(item.description).slice(
      0,
      TopicClusteringService.MAX_DESCRIPTION_TOKENS,
    );
    const categoryTokens = this.tokenize(item.category ?? '');
    const titleTerms = this.createWeightedTerms([
      [titleTokens, TopicClusteringService.TITLE_WEIGHT],
      [tagTokens, TopicClusteringService.TAG_WEIGHT],
    ]);
    const terms = this.createWeightedTerms([
      [titleTokens, TopicClusteringService.TITLE_WEIGHT],
      [tagTokens, TopicClusteringService.TAG_WEIGHT],
      [descriptionTokens, TopicClusteringService.DESCRIPTION_WEIGHT],
      [categoryTokens, TopicClusteringService.CATEGORY_WEIGHT],
    ]);

    return { item, terms, titleTerms };
  }

  private findBestCluster(
    item: PreparedItem,
    clusters: ClusterDraft[],
  ): ClusterDraft | undefined {
    let bestCluster: ClusterDraft | undefined;
    let bestAverageSimilarity = TopicClusteringService.SIMILARITY_THRESHOLD;

    for (const cluster of clusters) {
      const similarities = cluster.members.map((member) =>
        this.calculateItemSimilarity(item, member),
      );
      const averageSimilarity = this.average(similarities);

      if (averageSimilarity >= bestAverageSimilarity) {
        bestAverageSimilarity = averageSimilarity;
        bestCluster = cluster;
      }
    }

    return bestCluster;
  }

  private calculateItemSimilarity(
    first: PreparedItem,
    second: PreparedItem,
  ): number {
    const titleSimilarity = this.weightedJaccard(
      first.titleTerms,
      second.titleTerms,
    );
    const fullTextSimilarity = this.weightedJaccard(first.terms, second.terms);
    const sameCategory = Boolean(
      first.item.category && first.item.category === second.item.category,
    );

    const similarity =
      titleSimilarity * TopicClusteringService.TITLE_SIMILARITY_SHARE +
      fullTextSimilarity * TopicClusteringService.FULL_TEXT_SIMILARITY_SHARE +
      (sameCategory ? TopicClusteringService.CATEGORY_SIMILARITY_SHARE : 0);
    const firstNumbers = this.numericTerms(first.titleTerms);
    const secondNumbers = this.numericTerms(second.titleTerms);
    const conflictingNumbers =
      firstNumbers.length > 0 &&
      secondNumbers.length > 0 &&
      !firstNumbers.some((number) => secondNumbers.includes(number));

    return conflictingNumbers ? similarity * 0.25 : similarity;
  }

  private numericTerms(terms: WeightedTerms): string[] {
    return [...terms.keys()].filter((term) => /^\d+$/.test(term));
  }

  private weightedJaccard(first: WeightedTerms, second: WeightedTerms): number {
    const terms = new Set([...first.keys(), ...second.keys()]);
    let intersection = 0;
    let union = 0;

    for (const term of terms) {
      const firstWeight = first.get(term) ?? 0;
      const secondWeight = second.get(term) ?? 0;
      intersection += Math.min(firstWeight, secondWeight);
      union += Math.max(firstWeight, secondWeight);
    }

    return union === 0 ? 0 : intersection / union;
  }

  private createWeightedTerms(
    fields: Array<[tokens: string[], weight: number]>,
  ): WeightedTerms {
    const terms: WeightedTerms = new Map();

    for (const [tokens, weight] of fields) {
      for (const token of tokens) {
        terms.set(token, Math.max(terms.get(token) ?? 0, weight));
      }
    }

    return terms;
  }

  private tokenize(value: string): string[] {
    const normalized = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) {
      return [];
    }

    return [
      ...new Set(
        normalized
          .split(' ')
          .filter(
            (token) =>
              (token.length >= 3 || /^\d+$/.test(token)) &&
              !TopicClusteringService.STOPWORDS.has(token) &&
              !TopicClusteringService.GENERIC_TERMS.has(token),
          ),
      ),
    ];
  }

  private createCluster(draft: ClusterDraft): TopicCluster {
    const aggregateTerms = new Map<string, number>();

    for (const member of draft.members) {
      for (const [term, weight] of member.terms) {
        aggregateTerms.set(term, (aggregateTerms.get(term) ?? 0) + weight);
      }
    }

    const keywords = [...aggregateTerms.entries()]
      .sort(
        ([firstTerm, firstWeight], [secondTerm, secondWeight]) =>
          secondWeight - firstWeight || firstTerm.localeCompare(secondTerm),
      )
      .slice(0, 8)
      .map(([term]) => term);
    const items = draft.members.map(({ item }) => this.withoutRawPayload(item));
    const metrics = this.calculateMetrics(items);

    return {
      id: this.createStableId(keywords, items),
      topic: this.createTopic(keywords, items[0].title),
      keywords: keywords.slice(0, Math.max(3, Math.min(8, keywords.length))),
      categories: [
        ...new Set(
          items
            .map((item) => item.category)
            .filter((category): category is string => Boolean(category)),
        ),
      ],
      sources: [...new Set(items.map((item) => item.source))],
      items,
      metrics,
      isRecurringTopic: items.length >= 2,
      relevanceScore: 0,
    };
  }

  private withoutRawPayload(item: AnalyzedTrendItem): AnalyzedTrendItem {
    const publicItem = { ...item };
    delete publicItem.raw;

    return {
      ...publicItem,
      tags: [...item.tags],
      metrics: { ...item.metrics },
      calculatedMetrics: { ...item.calculatedMetrics },
    };
  }

  private calculateMetrics(items: AnalyzedTrendItem[]): TopicClusterMetrics {
    const itemCount = items.length;
    const totalViews = this.sum(items, (item) => item.metrics.views ?? 0);
    const totalLikes = this.sum(items, (item) => item.metrics.likes ?? 0);
    const totalComments = this.sum(items, (item) => item.metrics.comments ?? 0);
    const engagementRates = items.map((item) =>
      this.finiteOrZero(item.calculatedMetrics.engagementRate),
    );
    const viewsPerHour = items.map((item) =>
      this.finiteOrZero(item.calculatedMetrics.viewsPerHour),
    );
    const trendScores = items.map((item) =>
      this.finiteOrZero(item.calculatedMetrics.trendScore),
    );

    return {
      itemCount,
      totalViews,
      totalLikes,
      totalComments,
      averageEngagementRate: this.round(this.average(engagementRates)),
      averageViewsPerHour: this.round(this.average(viewsPerHour)),
      highestTrendScore: this.round(Math.max(...trendScores, 0)),
      averageTrendScore: this.round(this.average(trendScores)),
    };
  }

  private calculateRelevanceScore(
    cluster: TopicCluster,
    maximumViewsPerHour: number,
  ): number {
    const normalizedVelocity =
      maximumViewsPerHour > 0
        ? (cluster.metrics.averageViewsPerHour / maximumViewsPerHour) * 100
        : 0;
    const score =
      cluster.metrics.highestTrendScore * 0.45 +
      cluster.metrics.averageTrendScore * 0.25 +
      normalizedVelocity * 0.2 +
      (cluster.isRecurringTopic ? 10 : 0);

    return this.round(Math.min(100, this.finiteOrZero(score)));
  }

  private createStableId(
    keywords: string[],
    items: AnalyzedTrendItem[],
  ): string {
    const base = keywords.slice(0, 4).join('-') || items[0].externalId;
    return base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
  }

  private createTopic(keywords: string[], fallbackTitle: string): string {
    const topicTerms = keywords.slice(0, 5);

    if (topicTerms.length > 0) {
      return topicTerms
        .map((term) => term.charAt(0).toUpperCase() + term.slice(1))
        .join(' ');
    }

    return fallbackTitle.trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  private sum(
    items: AnalyzedTrendItem[],
    selector: (item: AnalyzedTrendItem) => number,
  ): number {
    return items.reduce(
      (total, item) => total + this.finiteOrZero(selector(item)),
      0,
    );
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  private finiteOrZero(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
