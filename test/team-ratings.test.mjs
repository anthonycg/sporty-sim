import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineFor } from '../public/model-baselines.js';
import { applyRatingAdjustment, calculateTeamRatings } from '../public/team-ratings.js';
import { neutralTeam } from '../public/simulator.js';

test('neutral underlying metrics calculate to 50 offense and defense', () => {
  const baseline = baselineFor('nfl', 'regular');
  assert.deepEqual(calculateTeamRatings(neutralTeam('nfl', 'regular'), baseline), { offense: 50, defense: 50 });
});

test('overall ratings respond to underlying production and manual adjustment', () => {
  const baseline = baselineFor('nfl', 'regular');
  const team = {
    ...neutralTeam('nfl', 'regular'),
    passEfficiency: 7.5,
    successRate: 48,
    epaPerPlay: 0.16,
    passDefenseEfficiency: 7.5,
    successAllowedRate: 49,
    epaAllowedPerPlay: 0.17
  };
  const ratings = calculateTeamRatings(team, baseline);
  assert.ok(ratings.offense > 50);
  assert.ok(ratings.defense < 50);
  assert.equal(applyRatingAdjustment(ratings.offense, 6), ratings.offense + 6);
  assert.equal(applyRatingAdjustment(ratings.defense, -4), ratings.defense - 4);
});
