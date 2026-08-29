import { applyAvailability, clamp, mulberry32, sampleAvailability } from './simulator.js';
import { baselineFor, playBaselineFor } from './model-baselines.js';

function normal(random) {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function exponential(random, mean) {
  return -Math.log(Math.max(Number.EPSILON, 1 - random())) * mean;
}

function other(side) {
  return side === 'home' ? 'away' : 'home';
}

function startPossession(state, side, yard = 25) {
  state.possession = side;
  state.yard = clamp(yard, 1, 99);
  state.down = 1;
  state.distance = Math.min(10, 100 - state.yard);
  state.drives += 1;
}

function scoreDifference(state, side) {
  return state.score[side] - state.score[other(side)];
}

function choosePass(team, state, random) {
  let probability = Number(team.passRate) / 100;
  const difference = scoreDifference(state, state.possession);
  const late = state.clock <= 900;
  if (state.down === 3) probability += state.distance >= 7 ? 0.22 : state.distance <= 2 ? -0.12 : 0.08;
  if (state.down === 4) probability += state.distance >= 4 ? 0.2 : -0.08;
  if (late && difference <= -8) probability += 0.16;
  else if (late && difference >= 8) probability -= 0.18;
  if (state.clock <= 120 && difference < 0) probability += 0.12;
  return random() < clamp(probability, 0.18, 0.9);
}

function clockRunoff(state, outcome, team, random) {
  const difference = scoreDifference(state, state.possession);
  const lateHalf = state.clock <= 120 || (state.clock > 1800 && state.clock <= 1920);
  if (outcome.clockStopped) return Math.round(5 + random() * 4);
  let seconds = 29 + random() * 12;
  if (lateHalf && difference < 0) seconds = 12 + random() * 13;
  if (state.clock <= 900 && difference >= 8) seconds = 35 + random() * 7;
  const tempoFactor = clamp((Number(team.pace) / 28) * Math.sqrt(63 / Number(team.plays)), 0.65, 1.38);
  return Math.round(seconds * tempoFactor);
}

function applyClock(state, seconds) {
  const before = state.clock;
  state.clock = Math.max(0, state.clock - seconds);
  if (before > 1800 && state.clock < 1800) {
    state.clock = 1800;
    return true;
  }
  return false;
}

function matchup(team, opponent, state = null, baseline = {}) {
  const redZoneEdge = state?.yard >= 80 ? (Number(team.redZoneTdRate) - 55) / 60 : 0;
  const expectedEpa = Number(team.epaPerPlay ?? baseline.epaPerPlay ?? 0)
    + (Number(opponent.epaAllowedPerPlay ?? baseline.epaPerPlay ?? 0) - Number(baseline.epaPerPlay ?? 0));
  const epaEdge = (expectedEpa - Number(baseline.epaPerPlay ?? 0)) * 1.15;
  return clamp(((Number(team.offense) - 50) - (Number(opponent.defense) - 50)) / 100 + redZoneEdge + epaEdge, -0.75, 0.75);
}

function trainedRate(team, opponent, key, fallback, baseline) {
  const offense = Number(team.trained?.offense?.[key]);
  const defense = Number(opponent.trained?.defenseAllowed?.[key]);
  const prior = Number(baseline[key]);
  if (!Number.isFinite(offense) && !Number.isFinite(defense)) return fallback;
  return ((Number.isFinite(offense) ? offense : prior) + (Number.isFinite(defense) ? defense : prior) - prior) / 100;
}

function passPlay(team, opponent, state, random, baseline, playBaseline) {
  const edge = matchup(team, opponent, state, baseline);
  const expectedEfficiency = Number(team.passEfficiency) + (Number(opponent.passDefenseEfficiency) - baseline.passEfficiency);
  const expectedSuccess = Number(team.successRate) + (Number(opponent.successAllowedRate) - baseline.successRate);
  const expectedExplosive = Number(team.explosiveRate) + (Number(opponent.explosiveAllowedRate) - baseline.explosiveRate);
  const obviousPass = state.distance >= 8 || (state.clock <= 900 && scoreDifference(state, state.possession) < 0);
  const turnoverFactor = clamp((Number(team.turnoverRate) + Number(opponent.takeawayRate)) / 22, 0.35, 2.4);
  const fallbackSack = Number(opponent.pressureRate) / 100;
  const sackProbability = clamp(trainedRate(team, opponent, 'sackRate', fallbackSack, playBaseline) * Math.exp(-edge * 0.25) * (obviousPass ? 1.18 : 1), 0.025, 0.16);
  const fallbackInterception = 0.021 * turnoverFactor;
  const interceptionProbability = clamp(trainedRate(team, opponent, 'interceptionRate', fallbackInterception, playBaseline) * Math.exp(-edge * 0.2) * (obviousPass ? 1.12 : 1), 0.006, 0.075);
  const fallbackCompletion = clamp(
    0.64 + (expectedEfficiency - 6.4) * 0.026 + (expectedSuccess - 42) * 0.003 + edge * 0.04,
    0.42,
    0.78
  );
  const completionProbability = clamp(trainedRate(team, opponent, 'completionRate', fallbackCompletion, playBaseline) + edge * 0.025, 0.42, 0.78);
  const draw = random();
  if (draw < sackProbability) {
    return { yards: -Math.max(1, Math.round(5 + exponential(random, 2.1))), turnover: false, clockStopped: false, kind: 'sack' };
  }
  if (draw < sackProbability + interceptionProbability) {
    const airYards = Math.max(0, Math.round(5 + normal(random) * 8));
    return { yards: airYards, turnover: true, clockStopped: true, kind: 'interception' };
  }
  if (draw > sackProbability + interceptionProbability + completionProbability) {
    return { yards: 0, turnover: false, clockStopped: true, kind: 'incomplete' };
  }

  const fallbackExplosive = 0.075 + (expectedExplosive - 10) * 0.009;
  const explosiveChance = clamp(trainedRate(team, opponent, 'passExplosiveRate', fallbackExplosive, playBaseline) + edge * 0.018, 0.025, 0.24);
  let yards;
  if (random() < explosiveChance) yards = 18 + Math.round(exponential(random, 9));
  else yards = Math.round(10.2 + (expectedEfficiency - 6.4) * 0.8 + edge * 1.1 + normal(random) * 5.3);
  yards = clamp(yards, -3, 75);
  const fumble = random() < clamp(0.006 * turnoverFactor, 0.002, 0.02) && random() < 0.5;
  const outOfBounds = state.clock <= 300 && random() < 0.28;
  return { yards, turnover: fumble, clockStopped: outOfBounds, kind: fumble ? 'fumble' : 'completion' };
}

function rushPlay(team, opponent, state, random, baseline, playBaseline) {
  const edge = matchup(team, opponent, state, baseline);
  const expectedEfficiency = Number(team.rushEfficiency) + (Number(opponent.rushDefenseEfficiency) - baseline.rushEfficiency);
  const expectedSuccess = Number(team.successRate) + (Number(opponent.successAllowedRate) - baseline.successRate);
  const expectedExplosive = Number(team.explosiveRate) + (Number(opponent.explosiveAllowedRate) - baseline.explosiveRate);
  const turnoverFactor = clamp((Number(team.turnoverRate) + Number(opponent.takeawayRate)) / 22, 0.35, 2.4);
  const fallbackExplosive = 0.065 + (expectedExplosive - 10) * 0.007;
  const explosiveChance = clamp(trainedRate(team, opponent, 'rushExplosiveRate', fallbackExplosive, playBaseline) + edge * 0.012, 0.02, 0.18);
  let yards;
  if (random() < explosiveChance) yards = 11 + Math.round(exponential(random, 7));
  else yards = Math.round(expectedEfficiency - 0.8 + (expectedSuccess - 42) * 0.035 + edge * 0.7 + normal(random) * 3.5);
  yards = clamp(yards, -6, 70);
  const fallbackFumble = 0.006 * turnoverFactor;
  const fumble = random() < clamp(trainedRate(team, opponent, 'rushFumbleRate', fallbackFumble, playBaseline), 0.002, 0.02);
  const outOfBounds = yards > 4 && state.clock <= 300 && random() < 0.16;
  return { yards, turnover: fumble, clockStopped: outOfBounds, kind: fumble ? 'fumble' : 'rush' };
}

function applyPenalty(state, random) {
  const offensePenalty = random() < 0.57;
  const yards = random() < 0.72 ? 5 : 10;
  if (offensePenalty) {
    state.yard = Math.max(1, state.yard - yards);
    state.distance += yards;
  } else {
    const gain = Math.min(yards, 100 - state.yard);
    state.yard += gain;
    if (gain >= state.distance) {
      state.down = 1;
      state.distance = Math.min(10, 100 - state.yard);
    } else {
      state.distance -= gain;
    }
  }
  return applyClock(state, 4 + Math.round(random() * 5));
}

function fieldGoal(state, random) {
  const side = state.possession;
  const distance = 100 - state.yard + 17;
  const probability = clamp(0.985 - Math.max(0, distance - 32) * 0.018 - Math.max(0, distance - 50) * 0.012, 0.17, 0.98);
  const crossedHalf = applyClock(state, 5 + Math.round(random() * 3));
  if (random() < probability) {
    state.score[side] += 3;
    startPossession(state, other(side), 25);
  } else {
    startPossession(state, other(side), clamp(100 - Math.max(1, state.yard - 7), 20, 99));
  }
  return crossedHalf;
}

function punt(state, random) {
  const side = state.possession;
  const net = clamp(Math.round(41 + normal(random) * 7), 20, 60);
  const landing = state.yard + net;
  const opponentYard = landing >= 100 ? 25 : clamp(100 - landing, 3, 35);
  const crossedHalf = applyClock(state, 7 + Math.round(random() * 4));
  startPossession(state, other(side), opponentYard);
  return crossedHalf;
}

function fourthDownDecision(state, random) {
  const difference = scoreDifference(state, state.possession);
  const late = state.clock <= 600;
  let goProbability = state.distance <= 1 ? 0.58 : state.distance <= 3 ? 0.28 : 0.08;
  if (late && difference < 0) goProbability += 0.45;
  if (state.yard >= 90) goProbability += 0.22;
  if (state.yard >= 55 && state.yard < 65 && state.distance > 4) goProbability -= 0.08;
  if (random() < clamp(goProbability, 0.02, 0.94)) return 'go';
  if (state.yard >= 55) return 'fieldGoal';
  return 'punt';
}

function applyPlayResult(state, result) {
  const side = state.possession;
  const opponent = other(side);
  const previousYard = state.yard;
  const newYard = clamp(previousYard + result.yards, -10, 110);

  if (result.turnover) {
    startPossession(state, opponent, clamp(100 - newYard, 1, 99));
    return;
  }
  if (newYard >= 100) {
    state.score[side] += 7;
    startPossession(state, opponent, 25);
    return;
  }
  if (newYard <= 0) {
    state.score[opponent] += 2;
    startPossession(state, side, 25);
    return;
  }

  state.yard = newYard;
  if (result.yards >= state.distance) {
    state.down = 1;
    state.distance = Math.min(10, 100 - state.yard);
  } else if (state.down === 4) {
    startPossession(state, opponent, 100 - state.yard);
  } else {
    state.down += 1;
    state.distance = Math.max(1, state.distance - result.yards);
  }
}

function simulateGame(config, random) {
  const openingReceiver = random() < 0.5 ? 'home' : 'away';
  const secondHalfReceiver = other(openingReceiver);
  const availability = sampleAvailability(config.players, random);
  const baseline = baselineFor(config.league, config.seasonType);
  const playBaseline = playBaselineFor(config.league, config.seasonType);
  const weather = Number(config.environment?.weatherPenalty || 0);
  const environmentChanges = {
    passEfficiency: -weather * 0.025,
    rushEfficiency: -weather * 0.008,
    successRate: -weather * 0.08,
    explosiveRate: -weather * 0.09,
    turnoverRate: weather * 0.06,
    redZoneTdRate: -weather * 0.22
  };
  const teams = {
    home: applyAvailability(applyAvailability(config.home, availability.teams.home), environmentChanges),
    away: applyAvailability(applyAvailability(config.away, availability.teams.away), environmentChanges)
  };
  const state = {
    score: { home: 0, away: 0 },
    possession: openingReceiver,
    yard: 25,
    down: 1,
    distance: 10,
    clock: 3600,
    drives: 1,
    plays: 0
  };

  while (state.clock > 0 && state.plays < 220) {
    let crossedHalf = false;
    if (state.down === 4) {
      const decision = fourthDownDecision(state, random);
      if (decision === 'fieldGoal') crossedHalf = fieldGoal(state, random);
      else if (decision === 'punt') crossedHalf = punt(state, random);
      if (decision !== 'go') {
        if (crossedHalf) startPossession(state, secondHalfReceiver, 25);
        continue;
      }
    }

    if (random() < 0.052) {
      crossedHalf = applyPenalty(state, random);
      if (crossedHalf) startPossession(state, secondHalfReceiver, 25);
      continue;
    }

    const side = state.possession;
    const team = teams[side];
    const opponent = teams[other(side)];
    const isPass = choosePass(team, state, random);
    const result = isPass
      ? passPlay(team, opponent, state, random, baseline, playBaseline)
      : rushPlay(team, opponent, state, random, baseline, playBaseline);
    state.plays += 1;
    crossedHalf = applyClock(state, clockRunoff(state, result, team, random));
    applyPlayResult(state, result);
    if (crossedHalf && state.clock > 0) startPossession(state, secondHalfReceiver, 25);
  }

  // Totals include overtime. This is a compact sudden-death approximation pending a full rules module.
  if (state.score.home === state.score.away) {
    const winner = random() < 0.5 ? 'home' : 'away';
    state.score[winner] += random() < 0.68 ? 3 : 7;
  }
  return { home: state.score.home, away: state.score.away, total: state.score.home + state.score.away, drives: state.drives, plays: state.plays };
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + remainder * (sorted[lower + 1] - sorted[lower]);
}

export function runPlaySimulation(config, iterations = 200_000, seed = 20260828, onProgress) {
  const random = mulberry32(seed);
  const totals = new Array(iterations);
  let homeTotal = 0;
  let awayTotal = 0;
  let driveTotal = 0;
  let playTotal = 0;
  let over = 0;
  let under = 0;
  let pushes = 0;
  const histogram = new Map();
  const marketTotal = Number(config.marketTotal);

  for (let index = 0; index < iterations; index += 1) {
    const game = simulateGame(config, random);
    totals[index] = game.total;
    homeTotal += game.home;
    awayTotal += game.away;
    driveTotal += game.drives;
    playTotal += game.plays;
    if (game.total > marketTotal) over += 1;
    else if (game.total < marketTotal) under += 1;
    else pushes += 1;
    const bucket = Math.floor(game.total / 3) * 3;
    histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    if (onProgress && index > 0 && index % 2500 === 0) onProgress(index / iterations);
  }

  totals.sort((a, b) => a - b);
  const mean = totals.reduce((sum, value) => sum + value, 0) / iterations;
  const variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / iterations;
  const decisive = Math.max(1, over + under);
  return {
    model: 'play', iterations, seed, mean, median: quantile(totals, 0.5),
    low80: quantile(totals, 0.1), high80: quantile(totals, 0.9), standardDeviation: Math.sqrt(variance),
    homeMean: homeTotal / iterations, awayMean: awayTotal / iterations,
    averageDrives: driveTotal / iterations, averagePlays: playTotal / iterations,
    overProbability: over / decisive, underProbability: under / decisive, pushProbability: pushes / iterations,
    edge: mean - marketTotal,
    histogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, count]) => ({ bucket, count }))
  };
}
