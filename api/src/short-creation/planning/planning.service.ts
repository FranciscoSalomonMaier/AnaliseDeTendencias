import { PlanningValidationError } from './planning-diagnostics';
import {
  buildPlanningContext,
  type PlanningAuthority,
} from './planning-context';
import { buildPlanningPrompt } from './planning-prompt';
import { validatePlanningResponse } from './planning-validator';
import { planningLimits, type PlanningDiagnostic } from './planning.schema';
import type { PlanningAdapter } from './planning-ai.adapter';
export type PlanningResult =
  | {
      ok: true;
      mode: 'SIMULATED' | 'AI';
      validation: ReturnType<typeof validatePlanningResponse>;
      compatibility: {
        contractVersion: 1;
        productionEnabled: false;
        executionPreflightRequired: true;
      };
      usage?: unknown;
    }
  | { ok: false; diagnostics: PlanningDiagnostic[]; usage?: unknown };
/** Stateless isolated planning. No database, storage, process runner, endpoints or job hooks. */
export class EditorialPlanningService {
  constructor(
    private readonly adapter: PlanningAdapter,
    private readonly authority: PlanningAuthority,
    private readonly timeoutMs: number = planningLimits.modelTimeoutMs,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw Error('Timeout de planejamento inválido.');
  }
  async plan(raw: unknown, signal?: AbortSignal): Promise<PlanningResult> {
    let usage: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    let phase = 'CONTEXT_INVALID';
    try {
      controller.signal.throwIfAborted();
      const context = buildPlanningContext(raw, this.authority);
      phase = 'PROMPT_INVALID';
      const prompt = buildPlanningPrompt(context);
      phase = 'PROVIDER_FAILURE';
      // Race enforces a deadline even when an adapter fails to honor cancellation.
      const expired = new Promise<never>((_, reject) => {
        const rejectAbort = () =>
          reject(
            Error(signal?.aborted ? 'PLANNING_CANCELLED' : 'PLANNING_TIMEOUT'),
          );
        controller.signal.addEventListener('abort', rejectAbort, {
          once: true,
        });
        timer = setTimeout(() => controller.abort(), this.timeoutMs);
      });
      const response = await Promise.race([
        this.adapter.generate(prompt, controller.signal),
        expired,
      ]);
      usage = response.usage;
      phase = 'PLAN_INVALID';
      const validation = validatePlanningResponse(response.data, context);
      if (validation.diagnostics.some((d) => d.level === 'ERROR'))
        return { ok: false, diagnostics: validation.diagnostics, usage };
      return {
        ok: true,
        mode: this.adapter.mode,
        validation,
        compatibility: {
          contractVersion: 1,
          productionEnabled: false,
          executionPreflightRequired: true,
        },
        usage,
      };
    } catch (error) {
      const known = controller.signal.aborted
        ? signal?.aborted
          ? 'PLANNING_CANCELLED'
          : 'PLANNING_TIMEOUT'
        : error instanceof Error &&
            ['PLANNING_TIMEOUT', 'PLANNING_CANCELLED'].includes(error.message)
          ? error.message
          : phase;
      // Never return provider payloads, credentials, paths or raw prompts in errors.
      if (error instanceof PlanningValidationError)
        return {
          ok: false,
          usage,
          diagnostics: [
            { level: 'ERROR', code: error.code, message: error.message },
          ],
        };
      return {
        ok: false,
        usage,
        diagnostics: [
          {
            level: 'ERROR',
            code: known,
            message:
              known === 'PLANNING_TIMEOUT'
                ? 'Tempo limite do planejamento atingido; nenhuma nova tentativa automática.'
                : known === 'PLANNING_CANCELLED'
                  ? 'Planejamento cancelado.'
                  : phase === 'CONTEXT_INVALID'
                    ? 'Contexto inválido, sem autorização suficiente ou acima dos limites.'
                    : phase === 'PLAN_INVALID'
                      ? 'Plano rejeitado: contrato, fontes, regras ou timeline incompatíveis.'
                      : 'Não foi possível obter um plano válido; nenhuma nova tentativa automática.',
          },
        ],
      };
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
