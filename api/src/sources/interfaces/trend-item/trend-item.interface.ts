export type TrendSource = 'youtube' | 'reddit' | 'google-trents';

export interface TrendItem {
    externalId: string;
    source: TrendSource;

    title: string;
    description: string;
    url: string;
    author: string;

    publishedAt: Date;
    collectedAt: Date;

    category?: string;
    tags: string[];

    metrics: {
        views?: number;
        likes?: number;
        comments?: number;
        score?: number;
    };

    raw:? unknown;
}
