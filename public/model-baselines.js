export const MODEL_BASELINES = Object.freeze({
  nfl: {
    regular: { plays: 63, pace: 28, passRate: 58, passEfficiency: 6.4, rushEfficiency: 4.2, successRate: 42, explosiveRate: 10, turnoverRate: 11, redZoneTdRate: 55, sackRate: 6.5, pointsPerDrive: 2.05 },
    preseason: { plays: 62, pace: 28.5, passRate: 55, passEfficiency: 6.1, rushEfficiency: 4.1, successRate: 41, explosiveRate: 9.5, turnoverRate: 12, redZoneTdRate: 52, sackRate: 7, pointsPerDrive: 1.6 }
  },
  'college-football': {
    regular: { plays: 69, pace: 25.5, passRate: 51, passEfficiency: 7, rushEfficiency: 4.7, successRate: 44, explosiveRate: 12, turnoverRate: 11, redZoneTdRate: 58, sackRate: 7, pointsPerDrive: 2.32 },
    preseason: { plays: 69, pace: 25.5, passRate: 51, passEfficiency: 7, rushEfficiency: 4.7, successRate: 44, explosiveRate: 12, turnoverRate: 11, redZoneTdRate: 58, sackRate: 7, pointsPerDrive: 2.32 }
  }
});

export function baselineFor(league = 'nfl', seasonType = 'regular') {
  return MODEL_BASELINES[league]?.[seasonType] || MODEL_BASELINES.nfl.regular;
}
