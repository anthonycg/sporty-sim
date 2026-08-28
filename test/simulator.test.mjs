import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEAM, americanFairOdds, runSimulation } from '../public/simulator.js';

const baseConfig = {
  league: 'nfl',
  seasonType: 'regular',
  marketTotal: 44.5,
  home: { ...DEFAULT_TEAM },
  away: { ...DEFAULT_TEAM },
  players: [],
  environment: { weatherPenalty: 0, variance: 0 }
};

test('simulation is deterministic with a fixed seed', () => {
  const first = runSimulation(baseConfig, 2_000, 42);
  const second = runSimulation(baseConfig, 2_000, 42);
  assert.equal(first.mean, second.mean);
  assert.equal(first.overProbability, second.overProbability);
});

test('neutral preseason baseline stays in a plausible current range', () => {
  const result = runSimulation({ ...baseConfig, seasonType: 'preseason' }, 12_000, 2026);
  assert.ok(result.mean > 34 && result.mean < 40, `neutral preseason mean was ${result.mean}`);
});

test('stronger offenses produce a higher expected total', () => {
  const baseline = runSimulation(baseConfig, 8_000, 17);
  const stronger = runSimulation({
    ...baseConfig,
    home: { ...DEFAULT_TEAM, offense: 78, passEfficiency: 7.7, successRate: 48 }
  }, 8_000, 17);
  assert.ok(stronger.mean > baseline.mean + 2, `${stronger.mean} should exceed ${baseline.mean}`);
});

test('probable offensive absence discounts expected scoring', () => {
  const healthy = runSimulation(baseConfig, 8_000, 99);
  const injured = runSimulation({
    ...baseConfig,
    players: [{
      name: 'Starting QB', team: 'home', unit: 'offense', unitGroup: 'quarterback',
      playProbability: 0, limitedProbability: 0, limitedImpact: 40, pointsImpact: 6, snapShare: 100
    }]
  }, 8_000, 99);
  assert.ok(injured.homeMean < healthy.homeMean - 3, `${injured.homeMean} should be below ${healthy.homeMean}`);
});

test('probable defensive absence raises opponent scoring', () => {
  const healthy = runSimulation(baseConfig, 8_000, 101);
  const injured = runSimulation({
    ...baseConfig,
    players: [{
      name: 'Star corner', team: 'home', unit: 'defense', unitGroup: 'secondary',
      playProbability: 0, limitedProbability: 0, limitedImpact: 40, pointsImpact: 4, snapShare: 100
    }]
  }, 8_000, 101);
  assert.ok(injured.awayMean > healthy.awayMean + 2, `${injured.awayMean} should exceed ${healthy.awayMean}`);
});

test('fair American odds are formatted from probability', () => {
  assert.equal(americanFairOdds(0.6), '-150');
  assert.equal(americanFairOdds(0.4), '+150');
});
