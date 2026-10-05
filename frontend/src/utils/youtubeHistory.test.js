import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRankingHistory, formatHistoryDuration } from './youtubeHistory.js';

test('explains identical rankings when only one capture is available', () => {
  assert.match(describeRankingHistory([{ actualHistorySeconds: 0, hasFullPeriodData: false }]), /duas coletas/);
});
test('explains shared partial history across longer periods', () => {
  assert.match(describeRankingHistory([{ actualHistorySeconds: 7200, hasFullPeriodData: false }]), /mesmos valores/);
});
test('distinguishes empty and complete history', () => {
  assert.match(describeRankingHistory([]), /Aguarde/);
  assert.match(describeRankingHistory([{ actualHistorySeconds: 86400, hasFullPeriodData: true }]), /Ranking atualizado/);
});
test('shows hours and minutes instead of zero days for recent history', () => {
  assert.equal(formatHistoryDuration(7200), '2 h');
  assert.equal(formatHistoryDuration(1800), '30 min');
  assert.equal(formatHistoryDuration(86400), '1 dia');
  assert.equal(formatHistoryDuration(172800), '2 dias');
});
