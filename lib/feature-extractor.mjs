import { MODEL_BASELINES as BASELINES, PLAY_BASELINES } from '../public/model-baselines.js';
import { calculateOverallRating } from '../public/team-ratings.js';

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

function expectedPoints(state = {}) {
  const yardsToEndzone = clamp(number(state.yardsToEndzone, 50), 1, 99);
  const yard = 100 - yardsToEndzone;
  const down = clamp(number(state.down, 1), 1, 4);
  const distance = clamp(number(state.distance, 10), 1, 30);
  return clamp(-1.55 + yard * 0.061 - (down - 1) * 0.48 - distance * 0.045, -2.5, 6.5);
}

function estimatedPlayEpa(play) {
  const before = expectedPoints(play.start);
  const text = `${play.type?.text || ''} ${play.text || ''}`.toLowerCase();
  if (play.scoringPlay && /touchdown/.test(text)) return 7 - before;
  if (play.scoringPlay && /safety/.test(text)) return -2 - before;
  if (play.isTurnover) {
    const endYardsToEndzone = clamp(number(play.end?.yardsToEndzone, 50), 1, 99);
    return -expectedPoints({ ...play.end, yardsToEndzone: 100 - endYardsToEndzone }) - before;
  }
  if (play.end && Number.isFinite(number(play.end.yardsToEndzone, Number.NaN))) {
    return expectedPoints(play.end) - before;
  }
  const yards = number(play.statYardage);
  return clamp(yards * 0.055 + (successfulPlay(play) ? 0.3 : -0.28), -4.5, 6.5);
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
  let passExplosive = 0;
  let rushExplosive = 0;
  let interceptions = 0;
  let rushFumbles = 0;
  let estimatedEpa = 0;
  let passEpa = 0;
  let rushEpa = 0;
  for (const play of scrimmagePlays) {
    const classification = classifyPlay(play);
    const text = `${play.type?.text || ''} ${play.text || ''}`.toLowerCase();
    const epa = estimatedPlayEpa(play);
    estimatedEpa += epa;
    if (classification === 'pass') {
      extractedPasses += 1;
      passEpa += epa;
      if (play.isTurnover && /intercept/.test(text)) interceptions += 1;
    } else {
      extractedRushes += 1;
      rushEpa += epa;
      if (play.isTurnover && /fumble/.test(text)) rushFumbles += 1;
    }
    if (successfulPlay(play)) successful += 1;
    const yards = number(play.statYardage);
    if (!play.isTurnover && classification === 'pass' && yards >= 20) {
      explosive += 1;
      passExplosive += 1;
    }
    if (!play.isTurnover && classification === 'rush' && yards >= 10) {
      explosive += 1;
      rushExplosive += 1;
    }
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
      explosive,
      passExplosive,
      rushExplosive,
      interceptions,
      rushFumbles,
      estimatedEpa,
      passEpa,
      rushEpa
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
    pointsPerDrive: safe(counters.drivePoints, counters.drives),
    epaPerPlay: safe(counters.estimatedEpa, counters.extractedPlays),
    passEpa: safe(counters.passEpa, counters.extractedPasses),
    rushEpa: safe(counters.rushEpa, counters.extractedRushes)
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
    pointsPerDrive: shrink(raw.pointsPerDrive, counters.drives, baseline.pointsPerDrive, 28),
    epaPerPlay: shrink(raw.epaPerPlay, counters.extractedPlays, baseline.epaPerPlay, 180),
    passEpa: shrink(raw.passEpa, counters.extractedPasses, baseline.passEpa, 140),
    rushEpa: shrink(raw.rushEpa, counters.extractedRushes, baseline.rushEpa, 120)
  };
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
    pointsPerDrive: counters.drives,
    epaPerPlay: counters.extractedPlays,
    passEpa: counters.extractedPasses,
    rushEpa: counters.extractedRushes
  };
  return { value: adjusted[key], observed: raw[key], baseline: baseline[key], sample: Math.round(sampleMap[key] || 0) };
}

const ADJUSTABLE_METRICS = new Set([
  'passEfficiency', 'rushEfficiency', 'successRate', 'explosiveRate', 'turnoverRate',
  'redZoneTdRate', 'sackRate', 'pointsPerDrive', 'epaPerPlay', 'passEpa', 'rushEpa'
]);

function opponentAdjustedRaw(games, contexts, baseline, perspective) {
  if (!contexts?.length) return rawMetrics(weightedCounters(games));
  const totals = {};
  const weights = {};
  const ordered = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));
  ordered.forEach((game, index) => {
    const recency = 0.82 ** index;
    const metrics = rawMetrics(game.counters);
    const context = contexts.find((item) => item?.eventId === game.eventId)?.profile;
    for (const [key, observed] of Object.entries(metrics)) {
      if (!Number.isFinite(observed)) continue;
      const opponentMetric = perspective === 'offense' ? context?.defenseAllowed?.[key]?.value : context?.metrics?.[key]?.value;
      const normalized = ADJUSTABLE_METRICS.has(key) && Number.isFinite(opponentMetric)
        ? observed - (opponentMetric - baseline[key])
        : observed;
      totals[key] = (totals[key] || 0) + normalized * recency;
      weights[key] = (weights[key] || 0) + recency;
    }
  });
  return Object.fromEntries(Object.keys(totals).map((key) => [key, totals[key] / weights[key]]));
}

function playModel(counters, baseline) {
  const rate = (numerator, denominator, prior, priorSample) => shrink(
    denominator > 0 ? numerator / denominator * 100 : null,
    denominator,
    prior,
    priorSample
  );
  return {
    completionRate: rate(counters.completions, counters.passAttempts, baseline.completionRate, 160),
    sackRate: rate(counters.sacks, counters.dropbacks, baseline.sackRate, 180),
    interceptionRate: rate(counters.interceptions, counters.dropbacks, baseline.interceptionRate, 220),
    passExplosiveRate: rate(counters.passExplosive, counters.extractedPasses, baseline.passExplosiveRate, 220),
    rushExplosiveRate: rate(counters.rushExplosive, counters.extractedRushes, baseline.rushExplosiveRate, 180),
    rushFumbleRate: rate(counters.rushFumbles, counters.extractedRushes, baseline.rushFumbleRate, 260)
  };
}

export function buildTeamProfile(teamGames, opponentGames, { league = 'nfl', seasonType = 'regular', opponentContexts = [] } = {}) {
  const baseline = BASELINES[league]?.[seasonType] || BASELINES.nfl.regular;
  const playBaseline = PLAY_BASELINES[league]?.[seasonType] || PLAY_BASELINES.nfl.regular;
  const teamCounters = weightedCounters(teamGames);
  const opponentCounters = weightedCounters(opponentGames);
  const teamRaw = rawMetrics(teamCounters);
  const opponentRaw = rawMetrics(opponentCounters);
  const teamOpponentAdjusted = opponentAdjustedRaw(teamGames, opponentContexts, baseline, 'offense');
  const allowedOpponentAdjusted = opponentAdjustedRaw(opponentGames, opponentContexts, baseline, 'defense');
  const teamAdjusted = adjustedMetrics(teamOpponentAdjusted, teamCounters, baseline);
  const allowedAdjusted = adjustedMetrics(allowedOpponentAdjusted, opponentCounters, baseline);
  const keys = Object.keys(teamAdjusted);
  const offenseRating = calculateOverallRating(teamAdjusted, baseline);
  const defenseRating = calculateOverallRating(allowedAdjusted, baseline, true);
  return {
    games: teamGames.length,
    plays: Math.round(teamGames.reduce((total, game) => total + game.counters.plays, 0)),
    offenseRating,
    defenseRating,
    summaryOffenseRating: offenseRating,
    summaryDefenseRating: defenseRating,
    metrics: Object.fromEntries(keys.map((key) => [key, { ...metricDetail(key, teamRaw, teamAdjusted, teamCounters, baseline), opponentAdjusted: teamOpponentAdjusted[key] }])),
    defenseAllowed: Object.fromEntries(keys.map((key) => [key, { ...metricDetail(key, opponentRaw, allowedAdjusted, opponentCounters, baseline), opponentAdjusted: allowedOpponentAdjusted[key] }])),
    playModel: {
      offense: playModel(teamCounters, playBaseline),
      defenseAllowed: playModel(opponentCounters, playBaseline),
      baseline: playBaseline,
      sample: { passPlays: Math.round(teamCounters.extractedPasses || 0), rushPlays: Math.round(teamCounters.extractedRushes || 0) }
    },
    baseline,
    method: opponentContexts.some((context) => context?.profile)
      ? 'Opponent-adjusted estimated EPA and play outcomes with recency weighting and empirical-Bayes shrinkage'
      : 'Estimated EPA and play outcomes with recency weighting and empirical-Bayes shrinkage'
  };
}

export { BASELINES };
