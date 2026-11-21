/** Safe domain errors: messages are authored constants, never model/provider strings. */
export class PlanningValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlanningValidationError';
  }
}
