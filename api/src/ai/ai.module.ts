import { Module } from '@nestjs/common';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisCacheService } from './cache/ai-analysis-cache.service';
import { AiAnalysisFingerprintService } from './ai-analysis-fingerprint.service';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';

@Module({
  providers: [
    AiAnalysisService,
    AiAnalysisCacheService,
    AiAnalysisFingerprintService,
    PostgresDatabaseService,
  ],
  exports: [
    AiAnalysisService,
    AiAnalysisCacheService,
    AiAnalysisFingerprintService,
  ],
})
export class AiModule {}
