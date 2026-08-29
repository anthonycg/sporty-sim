import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePredictions } from '../lib/prediction-ledger.mjs';

test('backtest summary scores totals, probabilities, and the market baseline', () => {
  const records = [
    { marketTotal: 44, projectedTotal: 48, overProbability: 0.7, outcome: { total: 50 } },
    { marketTotal: 40, projectedTotal: 38, overProbability: 0.3, outcome: { total: 35 } },
    { marketTotal: 42, projectedTotal: 41, overProbability: 0.45 }
  ];
  const summary = summarizePredictions(records);
  assert.equal(summary.recorded, 3);
  assert.equal(summary.runs, 3);
  assert.equal(summary.settled, 2);
  assert.equal(summary.pending, 1);
  assert.equal(summary.leanAccuracy, 1);
  assert.equal(summary.meanAbsoluteError, 2.5);
  assert.equal(summary.marketMeanAbsoluteError, 5.5);
  assert.ok(Math.abs(summary.brierScore - 0.09) < 1e-10);
});

test('backtest uses only the latest run for each game and model', () => {
  const records = [
    { id: 'a', eventId: '1', modelVersion: '0.4', engine: 'play', recordedAt: '2026-01-01T10:00:00Z', marketTotal: 40, projectedTotal: 50, overProbability: 0.8, outcome: { total: 35 } },
    { id: 'b', eventId: '1', modelVersion: '0.4', engine: 'play', recordedAt: '2026-01-01T11:00:00Z', marketTotal: 40, projectedTotal: 36, overProbability: 0.2, outcome: { total: 35 } }
  ];
  const summary = summarizePredictions(records);
  assert.equal(summary.runs, 2);
  assert.equal(summary.recorded, 1);
  assert.equal(summary.meanAbsoluteError, 1);
  assert.equal(summary.leanAccuracy, 1);
});
