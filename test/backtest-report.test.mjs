import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBacktestReport, formatBacktestMarkdown, formatBacktestReport } from '../lib/backtest-report.mjs';

const games = [
  { week: 1, profiles: { home: { games: 0 }, away: { games: 0 } }, actual: { total: 48 }, market: { total: 44 }, models: { drive: { mean: 46, overProbability: 0.65 }, play: { mean: 45, overProbability: 0.58 } } },
  { week: 2, profiles: { home: { games: 1 }, away: { games: 1 } }, actual: { total: 35 }, market: { total: 40 }, models: { drive: { mean: 38, overProbability: 0.3 }, play: { mean: 42, overProbability: 0.6 } } }
];

test('walk-forward report compares both engines with outcomes and market totals', () => {
  const report = buildBacktestReport(games);
  assert.equal(report.completedGames, 2);
  assert.equal(report.drive.meanAbsoluteError, 2.5);
  assert.equal(report.play.meanAbsoluteError, 5);
  assert.equal(report.drive.leanAccuracy, 1);
  assert.equal(report.play.leanAccuracy, 0.5);
  assert.ok(report.drive.brierScore < report.play.brierScore);
  assert.equal(report.byWeek[1].games, 1);
  assert.equal(report.byProfileWindow.coldStart.games, 1);
  assert.equal(report.byProfileWindow.partial.games, 1);
  assert.match(formatBacktestReport(report), /Model MAE/);
  assert.match(formatBacktestMarkdown(report, { league: 'nfl', season: 2026, iterations: 200_000 }), /200,000 per engine/);
});
