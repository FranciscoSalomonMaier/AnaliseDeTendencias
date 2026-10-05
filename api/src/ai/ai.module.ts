import { Module } from '@nestjs/common';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisCacheService } from './cache/ai-analysis-cache.service';
import { AiAnalysisFingerprintService } from './ai-analysis-fingerprint.service';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';
import { LlmProvider } from './llm.provider';
import { OpenAiLlmProvider } from './openai-llm.provider';

@Module({
  providers: [
    AiAnalysisService,
    AiAnalysisCacheService,
    AiAnalysisFingerprintService,
    PostgresDatabaseService,
    { provide: LlmProvider, useClass: OpenAiLlmProvider },
  ],
  exports: [
    AiAnalysisService,
    AiAnalysisCacheService,
    AiAnalysisFingerprintService,
    LlmProvider,
    PostgresDatabaseService,
  ],
})
export class AiModule {}
