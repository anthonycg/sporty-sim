import { MODEL_BASELINES as BASELINES } from '../public/model-baselines.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function number(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pair(value, separator = /[-/]/) {
  const [first = 0, second = 0] = String(value || '').split(separator).map((item) => number(item));
  return [first, second];
}

function clockSeconds(value) {
  const [minutes = 0, seconds = 0] = String(value || '').split(':').map(Number);
  return minutes * 60 + seconds;
}

function drivePoints(result) {
  const normalized = String(result || '').toUpperCase();
  if (normalized.includes('TD')) return 7;
  if (normalized === 'FG' || normalized.includes('FIELD GOAL')) return 3;
  if (normalized === 'SF' || normalized.includes('SAFETY')) return 2;
  return 0;
}

function offenseTeamId(play) {
  return String(play.teamParticipants?.find((participant) => participant.type === 'offense')?.id || play.start?.team?.id || '');
}

function classifyPlay(play) {
  const type = String(play.type?.text || '').toLowerCase();
  const text = String(play.text || '').toLowerCase();
  if (/kneel|spike/.test(text)) return null;
  if (type === 'rush' || type.includes('rushing')) return 'rush';
  if (type.includes('pass') || type.includes('sack') || type.includes('interception')) return 'pass';
  return null;
}

function successfulPlay(play) {
  if (play.isTurnover) return false;
  if (play.scoringPlay) return true;
  const down = number(play.start?.down);
  const distance = Math.max(1, number(play.start?.distance, 10));
  const yards = number(play.statYardage);
  if (play.end?.down === 1 && down > 1) return true;
  const threshold = down === 1 ? 0.4 : down === 2 ? 0.6 : 1;
  return yards >= distance * threshold;
}

export function extractTeamGame(summary, requestedTeamId) {
  const teamId = String(requestedTeamId);
  const teams = summary.boxscore?.teams || [];
  const teamBox = teams.find((entry) => String(entry.team?.id) === teamId);
  const opponentBox = teams.find((entry) => String(entry.team?.id) !== teamId);
  if (!teamBox || !opponentBox) throw new Error(`Team ${teamId} was not found in the box score.`);
  const stats = Object.fromEntries((teamBox.statistics || []).map((stat) => [stat.name, stat.displayValue]));
  const [completions, attempts] = pair(stats.completionAttempts, /\//);
  const [sacks] = pair(stats.sacksYardsLost, /-/);
  const [redZoneMade, redZoneAttempts] = pair(stats.redZoneAttempts, /-/);
  const rushAttempts = number(stats.rushingAttempts);
  const drives = [...(summary.drives?.previous || []), ...(summary.drives?.current ? [summary.drives.current] : [])]
    .filter((drive, index, all) => all.findIndex((item) => item.id === drive.id) === index);
  const teamDrives = drives.filter((drive) => String(drive.team?.id) === teamId);
  const allPlays = drives.flatMap((drive) => drive.plays || []);
  const scrimmagePlays = allPlays.filter((play) => offenseTeamId(play) === teamId && classifyPlay(play));
  let successful = 0;
  let explosive = 0;
  let extractedPasses = 0;
  let extractedRushes = 0;
  for (const play of scrimmagePlays) {
    const classification = classifyPlay(play);
    if (classification === 'pass') extractedPasses += 1;
    else extractedRushes += 1;
    if (successfulPlay(play)) successful += 1;
    const yards = number(play.statYardage);
    if (!play.isTurnover && ((classification === 'pass' && yards >= 20) || (classification === 'rush' && yards >= 10))) explosive += 1;
  }
  const game = summary.header?.competitions?.[0] || {};

  return {
    eventId: String(summary.header?.id || game.id || ''),
    date: game.date || null,
    team: { id: teamId, name: teamBox.team?.displayName, abbreviation: teamBox.team?.abbreviation },
    opponent: { id: String(opponentBox.team?.id), name: opponentBox.team?.displayName, abbreviation: opponentBox.team?.abbreviation },
    counters: {
      games: 1,
      plays: number(stats.totalOffensivePlays, scrimmagePlays.length),
      drives: number(stats.totalDrives, teamDrives.length),
      drivePoints: teamDrives.reduce((total, drive) => total + drivePoints(drive.result), 0),
      possessionSeconds: clockSeconds(stats.possessionTime),
      dropbacks: attempts + sacks,
      sacks,
      passAttempts: attempts,
      completions,
      netPassingYards: number(stats.netPassingYards),
      rushAttempts,
      rushingYards: number(stats.rushingYards),
      turnovers: number(stats.turnovers),
      redZoneMade,
      redZoneAttempts,
      extractedPlays: scrimmagePlays.length,
      extractedPasses,
      extractedRushes,
      successful,
      explosive
    }
  };
}

function weightedCounters(games) {
  const result = {};
  const ordered = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));
  ordered.forEach((game, index) => {
    const weight = 0.82 ** index;
    for (const [key, value] of Object.entries(game.counters)) {
      result[key] = (result[key] || 0) + value * weight;
    }
  });
  return result;
}

function rawMetrics(counters) {
  const safe = (numerator, denominator, scale = 1) => denominator > 0 ? numerator / denominator * scale : null;
  return {
    plays: safe(counters.plays, counters.games),
    pace: safe(counters.possessionSeconds, counters.plays),
    passRate: safe(counters.dropbacks, counters.dropbacks + counters.rushAttempts, 100),
    passEfficiency: safe(counters.netPassingYards, counters.dropbacks),
    rushEfficiency: safe(counters.rushingYards, counters.rushAttempts),
    successRate: safe(counters.successful, counters.extractedPlays, 100),
    explosiveRate: safe(counters.explosive, counters.extractedPlays, 100),
    turnoverRate: safe(counters.turnovers, counters.drives, 100),
    redZoneTdRate: safe(counters.redZoneMade, counters.redZoneAttempts, 100),
    sackRate: safe(counters.sacks, counters.dropbacks, 100),
    pointsPerDrive: safe(counters.drivePoints, counters.drives)
  };
}

function shrink(observed, sample, baseline, priorSample) {
  if (!Number.isFinite(observed) || sample <= 0) return baseline;
  return (observed * sample + baseline * priorSample) / (sample + priorSample);
}

function adjustedMetrics(raw, counters, baseline) {
  return {
    plays: shrink(raw.plays, counters.games, baseline.plays, 2),
    pace: shrink(raw.pace, counters.plays, baseline.pace, 100),
    passRate: shrink(raw.passRate, counters.dropbacks + counters.rushAttempts, baseline.passRate, 110),
    passEfficiency: shrink(raw.passEfficiency, counters.dropbacks, baseline.passEfficiency, 140),
    rushEfficiency: shrink(raw.rushEfficiency, counters.rushAttempts, baseline.rushEfficiency, 120),
    successRate: shrink(raw.successRate, counters.extractedPlays, baseline.successRate, 150),
    explosiveRate: shrink(raw.explosiveRate, counters.extractedPlays, baseline.explosiveRate, 200),
    turnoverRate: shrink(raw.turnoverRate, counters.drives, baseline.turnoverRate, 40),
    redZoneTdRate: shrink(raw.redZoneTdRate, counters.redZoneAttempts, baseline.redZoneTdRate, 30),
    sackRate: shrink(raw.sackRate, counters.dropbacks, baseline.sackRate, 180),
    pointsPerDrive: shrink(raw.pointsPerDrive, counters.drives, baseline.pointsPerDrive, 28)
  };
}

function strengthRating(metrics, baseline, defense = false) {
  const score =
    ((metrics.pointsPerDrive - baseline.pointsPerDrive) / 0.6) * 0.28 +
    ((metrics.passEfficiency - baseline.passEfficiency) / 0.9) * 0.2 +
    ((metrics.rushEfficiency - baseline.rushEfficiency) / 0.7) * 0.1 +
    ((metrics.successRate - baseline.successRate) / 6) * 0.18 +
    ((metrics.explosiveRate - baseline.explosiveRate) / 4) * 0.1 -
    ((metrics.turnoverRate - baseline.turnoverRate) / 5) * 0.09 +
    ((metrics.redZoneTdRate - baseline.redZoneTdRate) / 12) * 0.05 -
    ((metrics.sackRate - baseline.sackRate) / 2.5) * 0.05;
  return Math.round(clamp(50 + (defense ? -1 : 1) * score * 14, 10, 90));
}

function metricDetail(key, raw, adjusted, counters, baseline) {
  const sampleMap = {
    plays: counters.games,
    pace: counters.plays,
    passRate: counters.dropbacks + counters.rushAttempts,
    passEfficiency: counters.dropbacks,
    rushEfficiency: counters.rushAttempts,
    successRate: counters.extractedPlays,
    explosiveRate: counters.extractedPlays,
    turnoverRate: counters.drives,
    redZoneTdRate: counters.redZoneAttempts,
    sackRate: counters.dropbacks,
    pointsPerDrive: counters.drives
  };
  return { value: adjusted[key], observed: raw[key], baseline: baseline[key], sample: Math.round(sampleMap[key] || 0) };
}

export function buildTeamProfile(teamGames, opponentGames, { league = 'nfl', seasonType = 'regular' } = {}) {
  const baseline = BASELINES[league]?.[seasonType] || BASELINES.nfl.regular;
  const teamCounters = weightedCounters(teamGames);
  const opponentCounters = weightedCounters(opponentGames);
  const teamRaw = rawMetrics(teamCounters);
  const opponentRaw = rawMetrics(opponentCounters);
  const teamAdjusted = adjustedMetrics(teamRaw, teamCounters, baseline);
  const allowedAdjusted = adjustedMetrics(opponentRaw, opponentCounters, baseline);
  const keys = Object.keys(teamAdjusted);
  return {
    games: teamGames.length,
    plays: Math.round(teamGames.reduce((total, game) => total + game.counters.plays, 0)),
    offenseRating: 50,
    defenseRating: 50,
    summaryOffenseRating: strengthRating(teamAdjusted, baseline),
    summaryDefenseRating: strengthRating(allowedAdjusted, baseline, true),
    metrics: Object.fromEntries(keys.map((key) => [key, metricDetail(key, teamRaw, teamAdjusted, teamCounters, baseline)])),
    defenseAllowed: Object.fromEntries(keys.map((key) => [key, metricDetail(key, opponentRaw, allowedAdjusted, opponentCounters, baseline)])),
    baseline,
    method: 'Recency-weighted recent games with empirical-Bayes league shrinkage'
  };
}

export { BASELINES };
