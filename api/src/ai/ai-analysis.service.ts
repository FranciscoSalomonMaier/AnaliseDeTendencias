import { ConfigService } from '@nestjs/config';
import { AiAnalysisResult, AiAnalysisResultSchema } from './schemas/ai-trend-analysis.schema';
import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod.mjs';
import { TopicCluster } from 'trends/interfaces/topic-cluster/topic-cluster.interface';
import { TREND_ANALYSIS_SYSTEM_PROMPT } from './prompts/trend-analysis.prompt';

interface AiClusterPayload {
  clusterId: string;
  topic: string;
  keywords: string[];
  categories: string[];
  sources: string[];
  isRecurringTopic: boolean;
  relevanceScore: number;

  metrics: {
    itemCount: number;
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    averageEngagementRate: number;
    averageViewsPerHour: number;
    highestTrendScore: number;
    averageTrendScore: number;
  };

  items: Array<{
    title: string;
    author: string;
    publishedAt: string;
    tags: string[];
    category?: string;
  }>;
}

@Injectable()
export class AiAnalysisService {
    private readonly model: string;
    private readonly analysisLimit: number;

    constructor(
        private readonly configService: ConfigService,
    ) {
        this.model =
        this.configService.get<string>('OPENAI_MODEL') ??
        'gpt-5.6-luna';

        const configuredLimit = Number(
        this.configService.get<string>(
            'OPENAI_AI_ANALYSIS_LIMIT',
        ) ?? 10,
        );

        this.analysisLimit = Math.min(
        Math.max(configuredLimit, 1),
        20,
        );
    }

    async analyzeTopicClusters(
        clusters: TopicCluster[],
    ): Promise<AiAnalysisResult> {
        
        if (clusters.length === 0) {
            return {
                analyses: [],
            }
        }

        const apiKey = this.configService.get<string>('OPENAI_API_KEY');

        if (!apiKey) {
            throw new ServiceUnavailableException(
                'A análise com IA não está configurada'
            );
        }
        
        const selectedClusters = [...clusters]
            .sort(
                (first, second) => second.relevanceScore - first.relevanceScore
            )
            .slice(0, this.analysisLimit);

        const payload = this.buildPayload(selectedClusters);

        const openai = new OpenAI({
            apiKey,
            timeout: 30_000,
            maxRetries: 1,
        });

        try {
            const response = await openai.responses.parse({
                model: this.model,

                input: [
                    {
                        role: 'system',
                        content: TREND_ANALYSIS_SYSTEM_PROMPT,
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            clusters: payload
                        }),
                    },
                ],

                text: {
                    format: zodTextFormat(
                        AiAnalysisResultSchema,
                        'trend_analysis',
                    ),
                },
            });

            const result = response.output_parsed;

            if (!result) {
                throw new BadGatewayException(
                'A IA não retornou uma análise válida',
                );
            }

            this.validateClusterIds(
                selectedClusters,
                result,
            );

            return result;
        } catch (error) {
            if (error instanceof BadGatewayException) {
                throw error;
            }

            throw new ServiceUnavailableException(
                'Não foi possível realizar a análise com IA',
            );
        }
    }

    private buildPayload(
        clusters: TopicCluster[],
    ): AiClusterPayload[] {
        return clusters.map((cluster) => ({
        clusterId: cluster.id,
        topic: cluster.topic,
        keywords: [...cluster.keywords],
        categories: [...cluster.categories],
        sources: [...cluster.sources],
        isRecurringTopic: cluster.isRecurringTopic,
        relevanceScore: cluster.relevanceScore,
        metrics: {
            ...cluster.metrics,
        },

        items: cluster.items.slice(0, 5).map((item) => ({
            title: item.title.slice(0, 200),
            author: item.author.slice(0, 100),
            publishedAt: item.publishedAt.toISOString(),
            tags: item.tags.slice(0, 10),
            category: item.category,
        })),
        }));
    }

    private validateClusterIds(
        clusters: TopicCluster[],
        result: AiAnalysisResult,
    ): void {
        const expectedIds = new Set(
            clusters.map((cluster) => cluster.id),
        );

        const returnedIds = result.analyses.map(
            (analysis) => analysis.clusterId,
        );

        const uniqueReturnedIds = new Set(returnedIds);

        if (uniqueReturnedIds.size !== returnedIds.length) {
            throw new BadGatewayException(
                'A IA retornou análises duplicadas',
            );
        }

        const containsUnknownId = returnedIds.some(
           (id) => !expectedIds.has(id),
        );

        if (containsUnknownId) {
            throw new BadGatewayException(
                'A IA retornou um grupo desconhecido',
            );
        }

        if (uniqueReturnedIds.size !== expectedIds.size) {
            throw new BadGatewayException(
                'A IA não analisou todos os grupos enviados',
            );
        }
    }
}
