import { baselineFor } from './model-baselines.js';

export const DEFAULT_TEAM = Object.freeze({
  offense: 50,
  defense: 50,
  offenseAdjustment: 0,
  defenseAdjustment: 0,
  pace: 28,
  plays: 63,
  passRate: 58,
  passEfficiency: 6.4,
  rushEfficiency: 4.2,
  successRate: 42,
  explosiveRate: 10,
  turnoverRate: 11,
  redZoneTdRate: 55,
  epaPerPlay: 0,
  passDefenseEfficiency: 6.4,
  rushDefenseEfficiency: 4.2,
  successAllowedRate: 42,
  explosiveAllowedRate: 10,
  pressureRate: 6.5,
  takeawayRate: 11,
  epaAllowedPerPlay: 0
});

export function neutralTeam(league = 'nfl', seasonType = 'regular') {
  const baseline = baselineFor(league, seasonType);
  return {
    ...DEFAULT_TEAM,
    plays: baseline.plays,
    pace: baseline.pace,
    passRate: baseline.passRate,
    passEfficiency: baseline.passEfficiency,
    rushEfficiency: baseline.rushEfficiency,
    successRate: baseline.successRate,
    explosiveRate: baseline.explosiveRate,
    turnoverRate: baseline.turnoverRate,
    redZoneTdRate: baseline.redZoneTdRate,
    epaPerPlay: baseline.epaPerPlay,
    passDefenseEfficiency: baseline.passEfficiency,
    rushDefenseEfficiency: baseline.rushEfficiency,
    successAllowedRate: baseline.successRate,
    explosiveAllowedRate: baseline.explosiveRate,
    pressureRate: baseline.sackRate,
    takeawayRate: baseline.turnoverRate,
    epaAllowedPerPlay: baseline.epaPerPlay
  };
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const first = Math.max(Number.EPSILON, random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

export function sampleAvailability(players, random) {
  const modifiers = {
    teams: { home: {}, away: {} },
    volatility: 0,
    absences: []
  };
  const missingByUnit = new Map();

  const add = (side, key, amount) => {
    modifiers.teams[side][key] = (modifiers.teams[side][key] || 0) + amount;
  };

  const applyComponentImpact = (player, impact) => {
    const side = player.team;
    const group = player.unitGroup || player.unit;
    if (player.unit === 'offense') {
      if (group === 'quarterback') {
        add(side, 'passEfficiency', -0.32 * impact);
        add(side, 'successRate', -0.65 * impact);
        add(side, 'explosiveRate', -0.22 * impact);
        add(side, 'turnoverRate', 0.25 * impact);
        add(side, 'redZoneTdRate', -1.1 * impact);
        add(side, 'epaPerPlay', -0.012 * impact);
      } else if (group === 'offensive-line') {
        add(side, 'passEfficiency', -0.14 * impact);
        add(side, 'rushEfficiency', -0.12 * impact);
        add(side, 'successRate', -0.5 * impact);
        add(side, 'turnoverRate', 0.18 * impact);
        add(side, 'epaPerPlay', -0.008 * impact);
      } else {
        add(side, 'passEfficiency', -0.15 * impact);
        add(side, 'rushEfficiency', -0.05 * impact);
        add(side, 'successRate', -0.4 * impact);
        add(side, 'explosiveRate', -0.28 * impact);
        add(side, 'redZoneTdRate', -0.8 * impact);
        add(side, 'epaPerPlay', -0.008 * impact);
      }
    } else if (group === 'secondary') {
      add(side, 'passDefenseEfficiency', 0.22 * impact);
      add(side, 'successAllowedRate', 0.35 * impact);
      add(side, 'explosiveAllowedRate', 0.3 * impact);
      add(side, 'takeawayRate', -0.25 * impact);
      add(side, 'epaAllowedPerPlay', 0.01 * impact);
    } else {
      add(side, 'rushDefenseEfficiency', 0.15 * impact);
      add(side, 'passDefenseEfficiency', 0.06 * impact);
      add(side, 'successAllowedRate', 0.35 * impact);
      add(side, 'pressureRate', -0.4 * impact);
      add(side, 'takeawayRate', -0.12 * impact);
      add(side, 'epaAllowedPerPlay', 0.008 * impact);
    }
  };

  for (const player of players || []) {
    const playProbability = clamp(Number(player.playProbability) / 100, 0, 1);
    const limitedProbability = clamp(Number(player.limitedProbability) / 100, 0, playProbability);
    const draw = random();
    let lossFactor = 0;
    let outcome = 'active';
    if (draw > playProbability) {
      lossFactor = 1;
      outcome = 'out';
    } else if (draw < limitedProbability) {
      lossFactor = clamp(Number(player.limitedImpact) / 100, 0, 1);
      outcome = 'limited';
    }

    if (lossFactor > 0) {
      const impact = Math.abs(Number(player.pointsImpact) || 0) * lossFactor * clamp(Number(player.snapShare) / 100, 0.1, 1);
      const affectedSide = player.unit === 'defense'
        ? (player.team === 'home' ? 'away' : 'home')
        : player.team;
      applyComponentImpact(player, impact);
      modifiers.volatility += impact * 0.08;
      modifiers.absences.push({ name: player.name, outcome, impact, affectedSide });
      if (outcome === 'out') {
        const unitKey = `${player.team}:${player.unitGroup || player.unit}`;
        missingByUnit.set(unitKey, (missingByUnit.get(unitKey) || 0) + 1);
      }
    }
  }

  // Unit continuity penalty: a second and third absence in one group matter more.
  for (const [unitKey, count] of missingByUnit) {
    if (count < 2) continue;
    const [team, unit] = unitKey.split(':');
    const continuityImpact = 0.35 * (count - 1);
    applyComponentImpact({ team, unit: ['secondary', 'front-seven'].includes(unit) ? 'defense' : 'offense', unitGroup: unit }, continuityImpact);
    modifiers.volatility += 0.08 * (count - 1);
  }
  return modifiers;
}

export function applyAvailability(team, componentChanges = {}) {
  const adjusted = { ...team };
  for (const [key, change] of Object.entries(componentChanges)) {
    adjusted[key] = Number(adjusted[key]) + change;
  }
  return adjusted;
}

function matchupPointsPerDrive(team, opponent, baseline, environment) {
  const rating = (Number(team.offense) - 50) * 0.004 - (Number(opponent.defense) - 50) * 0.004;
  const expectedPass = Number(team.passEfficiency) + (Number(opponent.passDefenseEfficiency) - baseline.passEfficiency);
  const expectedRush = Number(team.rushEfficiency) + (Number(opponent.rushDefenseEfficiency) - baseline.rushEfficiency);
  const expectedSuccess = Number(team.successRate) + (Number(opponent.successAllowedRate) - baseline.successRate);
  const expectedExplosive = Number(team.explosiveRate) + (Number(opponent.explosiveAllowedRate) - baseline.explosiveRate);
  const expectedTurnover = (Number(team.turnoverRate) + Number(opponent.takeawayRate)) / 2;
  const pass = (expectedPass - baseline.passEfficiency) * 0.075;
  const rush = (expectedRush - baseline.rushEfficiency) * 0.085;
  const success = (expectedSuccess - baseline.successRate) * 0.018;
  const explosive = (expectedExplosive - baseline.explosiveRate) * 0.016;
  const redZone = (Number(team.redZoneTdRate) - baseline.redZoneTdRate) * 0.009;
  const turnover = (expectedTurnover - baseline.turnoverRate) * -0.025;
  const pressure = (Number(opponent.pressureRate) - baseline.sackRate) * -0.014;
  const expectedEpa = Number(team.epaPerPlay ?? baseline.epaPerPlay) + (Number(opponent.epaAllowedPerPlay ?? baseline.epaPerPlay) - baseline.epaPerPlay);
  const epa = (expectedEpa - baseline.epaPerPlay) * 1.35;
  const weather = Number(environment.weatherPenalty || 0) * -0.012;
  const raw = baseline.pointsPerDrive * Math.exp(rating + pass + rush + success + explosive + redZone + turnover + pressure + epa + weather);
  const estimatedDrives = clamp(Number(team.plays) / 6.1, 8.5, 14);
  return clamp(raw, 0.45, 4.1);
}

function scoreDrive(random, pointsPerDrive, team, opponent, volatility) {
  const turnoverRate = clamp((Number(team.turnoverRate) + Number(opponent.takeawayRate)) / 200, 0.03, 0.28);
  const defenseScoreChance = turnoverRate * clamp((Number(opponent.defense) - 35) / 1500, 0.004, 0.022);
  const multiplier = pointsPerDrive / 2.05;
  const touchdown = clamp(0.214 * multiplier, 0.045, 0.47);
  const fieldGoal = clamp(0.184 * Math.sqrt(multiplier), 0.08, 0.28);
  const safety = 0.0025;
  const draw = random();
  const noise = volatility > 0 && random() < Math.min(0.12, volatility * 0.01);

  if (draw < defenseScoreChance) return { offense: 0, defense: 7 };
  if (draw < defenseScoreChance + safety) return { offense: 0, defense: 2 };
  if (draw < defenseScoreChance + safety + touchdown) return { offense: noise && random() < 0.25 ? 8 : 7, defense: 0 };
  if (draw < defenseScoreChance + safety + touchdown + fieldGoal) return { offense: 3, defense: 0 };
  return { offense: 0, defense: 0 };
}

function driveDuration(team, scoreDifference, random) {
  const basePassRate = clamp(Number(team.passRate) / 100, 0.25, 0.82);
  const statePassAdjustment = scoreDifference <= -8 ? 0.1 : scoreDifference >= 8 ? -0.1 : 0;
  const passRate = clamp(basePassRate + statePassAdjustment, 0.25, 0.85);
  const playsFactor = clamp(Number(team.plays) / 63, 0.78, 1.25);
  const paceFactor = clamp(Number(team.pace) / 28, 0.72, 1.32);
  const runClockFactor = 1 + (0.56 - passRate) * 0.42;
  return clamp(161 * paceFactor * runClockFactor / playsFactor + normal(random) * 52, 35, 390);
}

function simulateGame(config, random) {
  const baseline = baselineFor(config.league, config.seasonType);
  const availability = sampleAvailability(config.players, random);
  const homeTeam = applyAvailability(config.home, availability.teams.home);
  const awayTeam = applyAvailability(config.away, availability.teams.away);
  const homePpd = matchupPointsPerDrive(homeTeam, awayTeam, baseline, config.environment);
  const awayPpd = matchupPointsPerDrive(awayTeam, homeTeam, baseline, config.environment);
  let home = 0;
  let away = 0;
  let elapsed = 0;
  let side = random() < 0.5 ? 'home' : 'away';
  let drives = 0;

  while (elapsed < 3600 && drives < 34) {
    const team = side === 'home' ? homeTeam : awayTeam;
    const opponent = side === 'home' ? awayTeam : homeTeam;
    const difference = side === 'home' ? home - away : away - home;
    elapsed += driveDuration(team, difference, random);
    if (elapsed > 3660) break;
    const ppd = side === 'home' ? homePpd : awayPpd;
    const result = scoreDrive(random, ppd, team, opponent, availability.volatility + Number(config.environment.variance || 0));
    if (side === 'home') {
      home += result.offense;
      away += result.defense;
    } else {
      away += result.offense;
      home += result.defense;
    }
    side = side === 'home' ? 'away' : 'home';
    drives += 1;
  }

  // Market totals include overtime. Approximate one scoring opportunity each on ties.
  if (home === away) {
    const first = scoreDrive(random, side === 'home' ? homePpd : awayPpd, config[side], config[side === 'home' ? 'away' : 'home'], 0);
    if (side === 'home') home += first.offense;
    else away += first.offense;
    if (home === away) {
      const other = side === 'home' ? 'away' : 'home';
      const second = scoreDrive(random, other === 'home' ? homePpd : awayPpd, config[other], config[side], 0);
      if (other === 'home') home += second.offense;
      else away += second.offense;
    }
  }

  return { home, away, total: home + away, drives, homePpd, awayPpd, absences: availability.absences };
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const remainder = position - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + remainder * (sorted[lower + 1] - sorted[lower]);
}

export function runSimulation(config, iterations = 200_000, seed = 20260827, onProgress) {
  const random = mulberry32(seed);
  const totals = new Array(iterations);
  let homeTotal = 0;
  let awayTotal = 0;
  let driveTotal = 0;
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
    if (game.total > marketTotal) over += 1;
    else if (game.total < marketTotal) under += 1;
    else pushes += 1;
    const bucket = Math.floor(game.total / 3) * 3;
    histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    if (onProgress && index > 0 && index % 5000 === 0) onProgress(index / iterations);
  }

  totals.sort((a, b) => a - b);
  const mean = totals.reduce((sum, value) => sum + value, 0) / iterations;
  const variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / iterations;
  const decisive = Math.max(1, over + under);
  return {
    iterations,
    seed,
    mean,
    median: quantile(totals, 0.5),
    low80: quantile(totals, 0.1),
    high80: quantile(totals, 0.9),
    standardDeviation: Math.sqrt(variance),
    homeMean: homeTotal / iterations,
    awayMean: awayTotal / iterations,
    averageDrives: driveTotal / iterations,
    overProbability: over / decisive,
    underProbability: under / decisive,
    pushProbability: pushes / iterations,
    edge: mean - marketTotal,
    histogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, count]) => ({ bucket, count }))
  };
}

export function americanFairOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return '—';
  return probability >= 0.5
    ? String(Math.round((-100 * probability) / (1 - probability)))
    : `+${Math.round((100 * (1 - probability)) / probability)}`;
}
