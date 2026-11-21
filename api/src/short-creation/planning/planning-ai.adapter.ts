import {
  planningProviderResponseSchema,
  normalizeProviderResponse,
} from './planning-model.schema';
import type { LlmProvider, LlmUsage } from '../../ai/llm.provider';
import { planningLimits } from './planning.schema';
import type { buildPlanningPrompt } from './planning-prompt';
export type PlanningPrompt = ReturnType<typeof buildPlanningPrompt>;
export interface PlanningAdapter {
  readonly mode: 'SIMULATED' | 'AI';
  generate(
    prompt: PlanningPrompt,
    signal: AbortSignal,
  ): Promise<{ data: unknown; usage?: LlmUsage }>;
}
/** Fixture is caller-owned test data. It never selects an external provider. */
export class SimulatedPlanningAdapter implements PlanningAdapter {
  readonly mode = 'SIMULATED' as const;
  constructor(private readonly fixture: unknown) {}
  async generate(_prompt: PlanningPrompt, signal: AbortSignal) {
    signal.throwIfAborted();
    return { data: structuredClone(this.fixture) };
  }
}
/** Explicit opt-in per instance. Not registered in a Nest module or any production job. */
export class LlmPlanningAdapter implements PlanningAdapter {
  readonly mode = 'AI' as const;
  constructor(
    private readonly provider: LlmProvider,
    private readonly model: string,
    private readonly authorization: { allowPaidPlanning: true },
  ) {}
  async generate(prompt: PlanningPrompt, signal: AbortSignal) {
    if (this.authorization?.allowPaidPlanning !== true || !this.model?.trim())
      throw Error(
        'Planejamento real exige autorização explícita e modelo configurado.',
      );
    const result = await this.provider.generateStructuredOutput({
      model: this.model,
      schemaName: 'short_editorial_plan_v1',
      schema: planningProviderResponseSchema,
      ...prompt,
      signal,
      maxOutputTokens: planningLimits.maxOutputTokens,
      disableRetries: true,
    });
    return {
      data: normalizeProviderResponse(
        planningProviderResponseSchema.parse(result.data),
      ),
      usage: result.usage,
    };
  }
}
