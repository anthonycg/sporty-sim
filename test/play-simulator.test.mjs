import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEAM, neutralTeam } from '../public/simulator.js';
import { runPlaySimulation } from '../public/play-simulator.js';

const config = {
  league: 'nfl', seasonType: 'regular', marketTotal: 44.5,
  home: { ...DEFAULT_TEAM }, away: { ...DEFAULT_TEAM }, players: [], environment: { weatherPenalty: 0 }
};

test('play simulation is deterministic and produces complete games', () => {
  const first = runPlaySimulation(config, 3_000, 88);
  const second = runPlaySimulation(config, 3_000, 88);
  assert.equal(first.mean, second.mean);
  assert.ok(first.averagePlays > 105 && first.averagePlays < 145);
  assert.ok(first.averageDrives > 16 && first.averageDrives < 25);
});

test('neutral play model is calibrated to a plausible NFL scoring environment', () => {
  const result = runPlaySimulation(config, 8_000, 19);
  assert.ok(result.mean > 40 && result.mean < 47, `neutral mean was ${result.mean}`);
});

test('play model applies a lower preseason scoring environment', () => {
  const regular = runPlaySimulation(config, 6_000, 21);
  const preseasonTeam = neutralTeam('nfl', 'preseason');
  const preseason = runPlaySimulation({ ...config, seasonType: 'preseason', home: preseasonTeam, away: preseasonTeam }, 6_000, 21);
  assert.ok(preseason.mean < regular.mean - 3, `${preseason.mean} should be below ${regular.mean}`);
});

test('play model responds in the correct direction to stronger offense', () => {
  const baseline = runPlaySimulation(config, 6_000, 31);
  const strong = runPlaySimulation({ ...config, home: { ...DEFAULT_TEAM, offense: 75, passEfficiency: 7.6, successRate: 48 } }, 6_000, 31);
  assert.ok(strong.homeMean > baseline.homeMean + 2, `${strong.homeMean} should exceed ${baseline.homeMean}`);
});

test('faster pace produces more plays and scoring opportunities', () => {
  const baseline = runPlaySimulation(config, 5_000, 44);
  const fast = runPlaySimulation({
    ...config,
    home: { ...DEFAULT_TEAM, pace: 23, plays: 72 },
    away: { ...DEFAULT_TEAM, pace: 23, plays: 72 }
  }, 5_000, 44);
  assert.ok(fast.averagePlays > baseline.averagePlays + 12, `${fast.averagePlays} should exceed ${baseline.averagePlays}`);
  assert.ok(fast.mean > baseline.mean + 3, `${fast.mean} should exceed ${baseline.mean}`);
});

test('play model uses defensive pass components directly', () => {
  const baseline = runPlaySimulation(config, 6_000, 55);
  const porous = runPlaySimulation({
    ...config,
    home: { ...DEFAULT_TEAM, passDefenseEfficiency: 8.2, successAllowedRate: 49, explosiveAllowedRate: 15, pressureRate: 4 }
  }, 6_000, 55);
  assert.ok(porous.awayMean > baseline.awayMean + 2, `${porous.awayMean} should exceed ${baseline.awayMean}`);
});
