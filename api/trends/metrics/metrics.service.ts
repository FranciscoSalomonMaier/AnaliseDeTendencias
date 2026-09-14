import { Injectable } from '@nestjs/common';
import { TrendItem } from 'src/sources/interfaces/trend-item/trend-item.interface';
import { AnalyzedTrendItem } from 'trends/interfaces/analyzed-trend-item/analyzed-trend-item.interface';

@Injectable()
export class MetricsService {
    calculateMany(items: TrendItem[]): AnalyzedTrendItem[] {
        if (items.length === 0) {
            return [];
        }

        const preparedItems = items.map((item) => {
            const ageInHours = this.calculateAgeInHours(item.publishedAt);
            const views = item.metrics.views ?? 0;
            const likes = item.metrics.likes ?? 0;
            const comments = item.metrics.comments ?? 0;

            return {
                item,
                ageInHours,
                views,
                viewsPerHour: this.calculateViewsPerHour(
                    views,
                    ageInHours,
                ),
                engagementRate: this.calculateEngagementRate(
                    views,
                    likes,
                    comments
                ),
            };
        });

        const maximumViewsPerHour = Math.max(
            ...preparedItems.map((item) => item.viewsPerHour),
            0,
        );

        const maximumEngagementRate = Math.max(
            ...preparedItems.map((item) => item.engagementRate),
            0,
        );

        const analyzedItems = preparedItems.map((prepared) => {
            const popularityScore = this.normalizeScore(
                prepared.viewsPerHour,
                maximumViewsPerHour
            );

            const engagementScore = this.normalizeScore(
                prepared.engagementRate,
                maximumEngagementRate,
            );

            const recencyScore = this.calculateRecencyScore(
                prepared.ageInHours,
            );

            const trendScore = this.calculateTrendScore({
                popularityScore,
                engagementScore,
                recencyScore,
            });

            return {
                ...prepared.item,

                calculatedMetrics: {
                    ageInHours: this.round(prepared.ageInHours, 2),
                    viewsPerHour: this.round(prepared.viewsPerHour, 2),
                    engagementRate: this.round(
                        prepared.engagementRate,
                        2,
                    ),

                    popularityScore: this.round(popularityScore, 2),
                    engagementScore: this.round(engagementScore, 2),
                    recencyScore: this.round(recencyScore, 2),
                    trendScore: this.round(trendScore, 2),

                    rank: 0,
                },
            };
        });

        return analyzedItems
            .sort(
                (first, second) => 
                    second.calculatedMetrics.trendScore - first.calculatedMetrics.trendScore
            )
            .map((item, index) => ({
                ...item,
                calculatedMetrics: {
                    ...item.calculatedMetrics,
                    rank: index + 1,
                },
            }));
    }

    private calculateAgeInHours(publishedAt: Date): number {
        const publishedTimestamp = publishedAt.getTime();

        if (!Number.isFinite(publishedTimestamp)) {
            return 0;
        }

        const differenceInMilliseconds = Date.now() - publishedTimestamp;

        if (differenceInMilliseconds <= 0 ) {
            return 0;
        }

        return differenceInMilliseconds / (1000 * 60 * 60);
    }

    private calculateViewsPerHour(
        views: number,
        ageInHours: number,
    ): number {
        if (views <= 0) {
            return 0;
        }

        /*
        * Usamos no mínimo uma hora para impedir que um vídeo
        * publicado há poucos minutos produza um valor exagerado.
        */

        const safeAgeInHours = Math.max(ageInHours, 1);
        
        return views / safeAgeInHours;
    }

    private calculateEngagementRate(
        views: number,
        likes: number,
        comments: number,
    ): number {
        if (views <= 0) {
            return 0;
        } 

        return ((likes + comments) / views) * 100;
    }

    private calculateRecencyScore(ageInHours: number): number {
        if (ageInHours <= 6) {
        return 100;
        }

        if (ageInHours <= 12) {
        return 90;
        }

        if (ageInHours <= 24) {
        return 75;
        }

        if (ageInHours <= 48) {
        return 50;
        }

        if (ageInHours <= 72) {
        return 25;
        }

        return 10;
    }

    private normalizeScore(
        value: number,
        maximumValue: number,
    ) : number {
        if (value <= 0 || maximumValue <= 0) {
            return 0;
        }

        return Math.min((value / maximumValue) * 100, 100);
    }

    private calculateTrendScore(scores: {
        popularityScore: number;
        engagementScore: number;
        recencyScore: number;
    }): number {
        return (
        scores.popularityScore * 0.5 +
        scores.engagementScore * 0.3 +
        scores.recencyScore * 0.2
        );
    }

    private round(value: number, decimalPlaces: number): number {
        const multiplier = 10 ** decimalPlaces;

        return Math.round(value * multiplier) / multiplier;
    }
    
}
