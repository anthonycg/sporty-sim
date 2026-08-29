export const MODEL_BASELINES = Object.freeze({
  nfl: {
    regular: { plays: 63, pace: 28, passRate: 58, passEfficiency: 6.4, rushEfficiency: 4.2, successRate: 42, explosiveRate: 10, turnoverRate: 11, redZoneTdRate: 55, sackRate: 6.5, pointsPerDrive: 2.05, epaPerPlay: 0, passEpa: 0.04, rushEpa: -0.03 },
    preseason: { plays: 62, pace: 28.5, passRate: 55, passEfficiency: 6.1, rushEfficiency: 4.1, successRate: 41, explosiveRate: 9.5, turnoverRate: 12, redZoneTdRate: 52, sackRate: 7, pointsPerDrive: 1.6, epaPerPlay: -0.04, passEpa: 0, rushEpa: -0.07 }
  },
  'college-football': {
    regular: { plays: 69, pace: 25.5, passRate: 51, passEfficiency: 7, rushEfficiency: 4.7, successRate: 44, explosiveRate: 12, turnoverRate: 11, redZoneTdRate: 58, sackRate: 7, pointsPerDrive: 2.32, epaPerPlay: 0.04, passEpa: 0.08, rushEpa: 0 },
    preseason: { plays: 69, pace: 25.5, passRate: 51, passEfficiency: 7, rushEfficiency: 4.7, successRate: 44, explosiveRate: 12, turnoverRate: 11, redZoneTdRate: 58, sackRate: 7, pointsPerDrive: 2.32, epaPerPlay: 0.04, passEpa: 0.08, rushEpa: 0 }
  }
});

export const PLAY_BASELINES = Object.freeze({
  nfl: {
    regular: { completionRate: 64, sackRate: 6.5, interceptionRate: 2.1, passExplosiveRate: 7.5, rushExplosiveRate: 6.5, rushFumbleRate: 0.6 },
    preseason: { completionRate: 61, sackRate: 7, interceptionRate: 2.6, passExplosiveRate: 7, rushExplosiveRate: 6, rushFumbleRate: 0.8 }
  },
  'college-football': {
    regular: { completionRate: 62, sackRate: 7, interceptionRate: 2.4, passExplosiveRate: 9, rushExplosiveRate: 8, rushFumbleRate: 0.8 },
    preseason: { completionRate: 62, sackRate: 7, interceptionRate: 2.4, passExplosiveRate: 9, rushExplosiveRate: 8, rushFumbleRate: 0.8 }
  }
});

export function baselineFor(league = 'nfl', seasonType = 'regular') {
  return MODEL_BASELINES[league]?.[seasonType] || MODEL_BASELINES.nfl.regular;
}

export function playBaselineFor(league = 'nfl', seasonType = 'regular') {
  return PLAY_BASELINES[league]?.[seasonType] || PLAY_BASELINES.nfl.regular;
}
