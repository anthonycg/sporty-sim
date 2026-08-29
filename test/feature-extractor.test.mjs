import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamProfile, extractTeamGame } from '../lib/feature-extractor.mjs';

function team(id, abbreviation, stats) {
  return { team: { id, abbreviation, displayName: abbreviation }, statistics: Object.entries(stats).map(([name, displayValue]) => ({ name, displayValue: String(displayValue) })) };
}

const summary = {
  header: { id: 'game-1', competitions: [{ date: '2026-08-10T00:00:00Z' }] },
  boxscore: { teams: [
    team('1', 'AAA', { totalOffensivePlays: 4, totalDrives: 1, possessionTime: '02:00', completionAttempts: '2/3', sacksYardsLost: '0-0', netPassingYards: 35, rushingAttempts: 1, rushingYards: 5, turnovers: 0, redZoneAttempts: '1-1' }),
    team('2', 'BBB', { totalOffensivePlays: 3, totalDrives: 1, possessionTime: '01:30', completionAttempts: '1/2', sacksYardsLost: '0-0', netPassingYards: 8, rushingAttempts: 1, rushingYards: 2, turnovers: 1, redZoneAttempts: '0-0' })
  ] },
  drives: { previous: [
    { id: 'd1', team: { id: '1' }, result: 'TD', plays: [
      { type: { text: 'Pass Reception' }, statYardage: 25, start: { team: { id: '1' }, down: 1, distance: 10 }, end: { down: 1 }, teamParticipants: [{ id: '1', type: 'offense' }] },
      { type: { text: 'Rush' }, statYardage: 5, start: { team: { id: '1' }, down: 1, distance: 10 }, end: { down: 2 }, teamParticipants: [{ id: '1', type: 'offense' }] },
      { type: { text: 'Pass Incompletion' }, statYardage: 0, start: { team: { id: '1' }, down: 2, distance: 5 }, end: { down: 3 }, teamParticipants: [{ id: '1', type: 'offense' }] },
      { type: { text: 'Pass Reception' }, statYardage: 10, scoringPlay: true, start: { team: { id: '1' }, down: 3, distance: 5 }, end: { down: 1 }, teamParticipants: [{ id: '1', type: 'offense' }] }
    ] },
    { id: 'd2', team: { id: '2' }, result: 'INT', plays: [] }
  ] }
};

test('extractor converts play-by-play and box score into counters', () => {
  const game = extractTeamGame(summary, '1');
  assert.equal(game.counters.dropbacks, 3);
  assert.equal(game.counters.extractedPlays, 4);
  assert.equal(game.counters.explosive, 1);
  assert.equal(game.counters.successful, 3);
  assert.equal(game.counters.drivePoints, 7);
});

test('profile reports observed and shrunk values', () => {
  const offense = extractTeamGame(summary, '1');
  const opponent = extractTeamGame(summary, '2');
  const profile = buildTeamProfile([offense], [opponent], { league: 'nfl', seasonType: 'preseason' });
  assert.equal(profile.games, 1);
  assert.equal(profile.offenseRating, 50);
  assert.equal(profile.defenseRating, 50);
  assert.equal(profile.metrics.passEfficiency.observed, 35 / 3);
  assert.ok(profile.metrics.passEfficiency.value < profile.metrics.passEfficiency.observed);
  assert.ok(profile.metrics.passEfficiency.value > profile.metrics.passEfficiency.baseline);
});
