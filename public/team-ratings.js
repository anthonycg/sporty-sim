const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function value(metrics, key, fallback) {
  const parsed = Number(metrics?.[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateOverallRating(metrics, baseline, defense = false) {
  const quality =
    ((value(metrics, 'epaPerPlay', baseline.epaPerPlay) - baseline.epaPerPlay) / 0.15) * 0.28 +
    ((value(metrics, 'passEfficiency', baseline.passEfficiency) - baseline.passEfficiency) / 0.9) * 0.2 +
    ((value(metrics, 'rushEfficiency', baseline.rushEfficiency) - baseline.rushEfficiency) / 0.7) * 0.1 +
    ((value(metrics, 'successRate', baseline.successRate) - baseline.successRate) / 6) * 0.17 +
    ((value(metrics, 'explosiveRate', baseline.explosiveRate) - baseline.explosiveRate) / 4) * 0.1 -
    ((value(metrics, 'turnoverRate', baseline.turnoverRate) - baseline.turnoverRate) / 5) * 0.08 +
    ((value(metrics, 'redZoneTdRate', baseline.redZoneTdRate) - baseline.redZoneTdRate) / 12) * 0.04 -
    ((value(metrics, 'sackRate', baseline.sackRate) - baseline.sackRate) / 2.5) * 0.03;
  return Math.round(clamp(50 + (defense ? -1 : 1) * quality * 14, 10, 90));
}

export function calculateTeamRatings(team, baseline) {
  const offense = calculateOverallRating({
    passEfficiency: team.passEfficiency,
    rushEfficiency: team.rushEfficiency,
    successRate: team.successRate,
    explosiveRate: team.explosiveRate,
    turnoverRate: team.turnoverRate,
    redZoneTdRate: team.redZoneTdRate,
    sackRate: baseline.sackRate,
    epaPerPlay: team.epaPerPlay
  }, baseline);
  const defense = calculateOverallRating({
    passEfficiency: team.passDefenseEfficiency,
    rushEfficiency: team.rushDefenseEfficiency,
    successRate: team.successAllowedRate,
    explosiveRate: team.explosiveAllowedRate,
    turnoverRate: team.takeawayRate,
    redZoneTdRate: baseline.redZoneTdRate,
    sackRate: team.pressureRate,
    epaPerPlay: team.epaAllowedPerPlay
  }, baseline, true);
  return { offense, defense };
}

export function applyRatingAdjustment(rating, adjustment) {
  return Math.round(clamp(Number(rating) + Number(adjustment || 0), 0, 100));
}
