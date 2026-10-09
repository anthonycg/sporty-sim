import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAvailabilityPlayers } from '../lib/injury-profile.mjs';

const injuries = [{
  team: { id: '27' },
  injuries: [
    {
      status: 'Out',
      athlete: { id: 'qb1', displayName: 'Starting QB', position: { abbreviation: 'QB' } },
      details: { type: 'Thumb' }
    },
    {
      status: 'Questionable',
      athlete: { id: 'wr2', displayName: 'Reserve receiver', position: { abbreviation: 'WR' } },
      details: { type: 'Hamstring' }
    },
    {
      status: 'Healthy',
      athlete: { id: 'cb1', displayName: 'Healthy corner', position: { abbreviation: 'CB' } }
    }
  ]
}];

const depthCharts = {
  27: { depthchart: [{ positions: {
    qb: { athletes: [{ id: 'qb1', displayName: 'Starting QB' }, { id: 'qb2', displayName: 'Backup QB' }] },
    wr1: { athletes: [{ id: 'wr1', displayName: 'Starting receiver' }, { id: 'wr2', displayName: 'Reserve receiver' }] }
  } }] }
};

test('automatic availability maps status, position, and depth chart role', () => {
  const players = buildAvailabilityPlayers(injuries, depthCharts);
  assert.equal(players.length, 2);
  const quarterback = players.find((player) => player.athleteId === 'qb1');
  const receiver = players.find((player) => player.athleteId === 'wr2');
  assert.equal(quarterback.playProbability, 0);
  assert.equal(quarterback.unitGroup, 'quarterback');
  assert.equal(quarterback.depthRole, 'starter');
  assert.equal(quarterback.replacement, 'Backup QB');
  assert.equal(quarterback.pointsImpact, 6);
  assert.equal(receiver.playProbability, 60);
  assert.equal(receiver.depthRole, 'rotation');
  assert.ok(receiver.pointsImpact < 1);
});

test('inactive fantasy designation is treated as unavailable', () => {
  const players = buildAvailabilityPlayers([{
    team: { id: '6' },
    injuries: [{
      athlete: { id: 's1', displayName: 'Safety', position: { abbreviation: 'S' } },
      details: { fantasyStatus: { displayDescription: 'Inactive' } }
    }]
  }], {});
  assert.equal(players[0].playProbability, 0);
  assert.equal(players[0].unit, 'defense');
  assert.equal(players[0].unitGroup, 'secondary');
});
