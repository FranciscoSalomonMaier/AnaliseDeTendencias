import { periodStart } from './youtube-period';
describe('YouTube periods', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  it('rejects invalid periods', () =>
    expect(() => periodStart('invalid', now)).toThrow());
  it('uses midnight in Brasilia', () =>
    expect(periodStart('today', now).toISOString()).toBe(
      '2026-10-04T03:00:00.000Z',
    ));
  it.each([
    ['7d', 7],
    ['30d', 30],
    ['1y', 365],
  ])('converts %s centrally', (period, days) => {
    expect(now.getTime() - periodStart(period, now).getTime()).toBe(
      Number(days) * 86400000,
    );
  });
});
