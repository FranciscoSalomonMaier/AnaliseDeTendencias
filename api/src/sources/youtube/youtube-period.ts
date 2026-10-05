import { BadRequestException } from '@nestjs/common';

export const COLLECTION_INTERVAL_MS = 60 * 60 * 1000;
export const PERIOD_DAYS = { today: 0, '7d': 7, '30d': 30, '1y': 365 };
export type YoutubePeriod = keyof typeof PERIOD_DAYS;

export function periodStart(period: string, now = new Date()): Date {
  if (!Object.prototype.hasOwnProperty.call(PERIOD_DAYS, period)) {
    throw new BadRequestException('Período inválido: use today, 7d, 30d ou 1y');
  }
  if (period === 'today') {
    // São Paulo currently has a fixed UTC-03 offset; independent of host timezone.
    const local = new Date(now.getTime() - 3 * COLLECTION_INTERVAL_MS);
    return new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate(),
        3,
      ),
    );
  }
  return new Date(
    now.getTime() -
      PERIOD_DAYS[period as YoutubePeriod] * 24 * COLLECTION_INTERVAL_MS,
  );
}
