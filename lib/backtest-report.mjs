const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const probability = (value) => Math.min(1 - 1e-9, Math.max(1e-9, Number(value)));

function summarizeEngine(games, engine) {
  const rows = games
    .filter((game) => game.models?.[engine] && Number.isFinite(game.actual?.total))
    .map((game) => ({ game, model: game.models[engine] }));
  const withMarket = rows.filter(({ game }) => Number.isFinite(game.market?.total));
  const decisive = withMarket.filter(({ game }) => game.actual.total !== game.market.total);
  const errors = rows.map(({ game, model }) => model.mean - game.actual.total);
  const marketErrors = withMarket.map(({ game }) => game.market.total - game.actual.total);
  const correct = decisive.filter(({ game, model }) =>
    (model.overProbability >= 0.5) === (game.actual.total > game.market.total)).length;

  const calibration = [];
  for (let lower = 0; lower < 1; lower += 0.1) {
    const upper = lower + 0.1;
    const bin = decisive.filter(({ model }) => model.overProbability >= lower && (upper >= 1 ? model.overProbability <= upper : model.overProbability < upper));
    if (!bin.length) continue;
    calibration.push({
      range: `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`,
      games: bin.length,
      predictedOver: round(average(bin.map(({ model }) => model.overProbability))),
      actualOver: round(average(bin.map(({ game }) => game.actual.total > game.market.total ? 1 : 0)))
    });
  }

  const edgeDefinitions = [
    ['0–1', 0, 1], ['1–2', 1, 2], ['2–3', 2, 3], ['3–5', 3, 5], ['5+', 5, Infinity]
  ];
  const edgeBuckets = edgeDefinitions.map(([label, minimum, maximum]) => {
    const bin = decisive.filter(({ game, model }) => {
      const edge = Math.abs(model.mean - game.market.total);
      return edge >= minimum && edge < maximum;
    });
    const wins = bin.filter(({ game, model }) =>
      (model.mean >= game.market.total) === (game.actual.total > game.market.total)).length;
    return { edge: label, games: bin.length, accuracy: bin.length ? round(wins / bin.length) : null };
  });

  const meanSquaredError = average(errors.map((value) => value ** 2));
  return {
    games: rows.length,
    gamesWithMarket: withMarket.length,
    meanAbsoluteError: round(average(errors.map(Math.abs))),
    rootMeanSquaredError: Number.isFinite(meanSquaredError) ? round(Math.sqrt(meanSquaredError)) : null,
    bias: round(average(errors)),
    marketMeanAbsoluteError: round(average(marketErrors.map(Math.abs))),
    beatMarketByAbsoluteError: withMarket.length
      ? round(withMarket.filter(({ game, model }) => Math.abs(model.mean - game.actual.total) < Math.abs(game.market.total - game.actual.total)).length / withMarket.length)
      : null,
    leanAccuracy: decisive.length ? round(correct / decisive.length) : null,
    brierScore: decisive.length ? round(average(decisive.map(({ game, model }) => {
      const actual = game.actual.total > game.market.total ? 1 : 0;
      return (probability(model.overProbability) - actual) ** 2;
    }))) : null,
    logLoss: decisive.length ? round(average(decisive.map(({ game, model }) => {
      const actual = game.actual.total > game.market.total ? 1 : 0;
      const predicted = probability(model.overProbability);
      return -(actual * Math.log(predicted) + (1 - actual) * Math.log(1 - predicted));
    }))) : null,
    calibration,
    edgeBuckets
  };
}

export function buildBacktestReport(games, profileGames = 3) {
  const segment = (items) => ({
    games: items.length,
    drive: summarizeEngine(items, 'drive'),
    play: summarizeEngine(items, 'play')
  });
  const weeks = [...new Set(games.map((game) => game.week).filter(Number.isFinite))].sort((a, b) => a - b);
  const profileWindows = {
    coldStart: games.filter((game) => (game.profiles?.home?.games || 0) === 0 || (game.profiles?.away?.games || 0) === 0),
    partial: games.filter((game) => {
      const home = game.profiles?.home?.games || 0;
      const away = game.profiles?.away?.games || 0;
      return home > 0 && away > 0 && (home < profileGames || away < profileGames);
    }),
    full: games.filter((game) => (game.profiles?.home?.games || 0) >= profileGames && (game.profiles?.away?.games || 0) >= profileGames)
  };
  return {
    generatedAt: new Date().toISOString(),
    completedGames: games.length,
    drive: summarizeEngine(games, 'drive'),
    play: summarizeEngine(games, 'play'),
    byWeek: Object.fromEntries(weeks.map((week) => [week, segment(games.filter((game) => game.week === week))])),
    byProfileWindow: Object.fromEntries(Object.entries(profileWindows).map(([key, items]) => [key, segment(items)]))
  };
}

export function formatBacktestReport(report) {
  const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const metric = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const lines = ['Engine  Games  Model MAE  Line MAE  RMSE   Bias   Lean   Brier'];
  for (const engine of ['drive', 'play']) {
    const item = report[engine];
    lines.push([
      engine.padEnd(6),
      String(item.games).padStart(5),
      metric(item.meanAbsoluteError).padStart(9),
      metric(item.marketMeanAbsoluteError).padStart(8),
      metric(item.rootMeanSquaredError).padStart(6),
      metric(item.bias).padStart(6),
      percent(item.leanAccuracy).padStart(6),
      metric(item.brierScore, 3).padStart(6)
    ].join('  '));
  }
  return lines.join('\n');
}

export function formatBacktestMarkdown(report, metadata = {}) {
  const metric = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  const row = (label, summary) => `| ${label} | ${summary.games} | ${metric(summary.meanAbsoluteError)} | ${metric(summary.marketMeanAbsoluteError)} | ${metric(summary.rootMeanSquaredError)} | ${metric(summary.bias)} | ${percent(summary.leanAccuracy)} | ${metric(summary.brierScore, 3)} | ${percent(summary.beatMarketByAbsoluteError)} |`;
  const lines = [
    `# Sporty Sim walk-forward backtest`,
    '',
    `- League: ${metadata.league || '—'}`,
    `- Season: ${metadata.season || '—'} ${metadata.seasonType || ''}`,
    `- Model: ${metadata.modelVersion || '—'}`,
    `- Simulations: ${Number(metadata.iterations || 0).toLocaleString()} per engine per game`,
    `- Profile window: up to ${Number(metadata.profileGames || 3)} completed games per team`,
    `- Completed games: ${report.completedGames}`,
    '',
    '## Overall',
    '',
    '| Engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    row('Drive', report.drive),
    row('Play', report.play),
    '',
    '## By week',
    '',
    '| Week / engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const [week, segment] of Object.entries(report.byWeek || {})) {
    lines.push(row(`Week ${week} drive`, segment.drive), row(`Week ${week} play`, segment.play));
  }
  lines.push('', '## By available profile window', '', '| Window / engine | Games | Model MAE | Line MAE | RMSE | Bias | Lean accuracy | Brier | Beat line MAE |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [window, segment] of Object.entries(report.byProfileWindow || {})) {
    lines.push(row(`${window} drive`, segment.drive), row(`${window} play`, segment.play));
  }
  lines.push(
    '',
    `Cold start means at least one team had no earlier same-season game; partial means both teams had history but at least one had fewer than ${Number(metadata.profileGames || 3)} games; full means both had the complete ${Number(metadata.profileGames || 3)}-game window.`,
    '',
    'Historical runs use archived ESPN totals and neutral weather/player availability. Lower MAE, RMSE, Brier, and log loss are better. Bias is projected total minus actual total.'
  );
  return `${lines.join('\n')}\n`;
}
