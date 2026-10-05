import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LlmProvider } from 'src/ai/llm.provider';
import { PostgresDatabaseService } from 'src/database/postgres-database.service';
import { YoutubeService } from 'src/sources/youtube/youtube.service';
import { ContentGenerationRepository } from './content-generation.repository';
import { TrendsModule } from './trends.module';

jest.mock('src/sources/youtube/youtube.service', () => ({
  YoutubeService: class {},
}));

jest.mock('src/ai/ai-analysis.service', () => ({
  AiAnalysisService: class {},
}));
jest.mock('src/ai/openai-llm.provider', () => ({
  OpenAiLlmProvider: class {},
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => undefined } }],
  exports: [ConfigService],
})
class TestConfigModule {}

describe('TrendsModule dependency graph', () => {
  it('resolves the content repository from the database provider exported by AiModule', async () => {
    const module = await Test.createTestingModule({
      imports: [TestConfigModule, TrendsModule],
    })
      .overrideProvider(PostgresDatabaseService)
      .useValue({ query: jest.fn() })
      .overrideProvider(YoutubeService)
      .useValue({})
      .overrideProvider(LlmProvider)
      .useValue({ generateStructuredOutput: jest.fn() })
      .compile();

    expect(module.get(ContentGenerationRepository)).toBeInstanceOf(
      ContentGenerationRepository,
    );
    await module.close();
  });
});
