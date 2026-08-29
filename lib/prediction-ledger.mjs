import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const clampProbability = (value) => Math.min(1 - 1e-9, Math.max(1e-9, Number(value)));

async function readRecords(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRecords(filePath, records) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`);
}

export function summarizePredictions(records) {
  const officialByGame = new Map();
  records.forEach((record, index) => {
    const key = record.eventId
      ? `${record.eventId}:${record.modelVersion || 'unknown'}:${record.engine || 'unknown'}`
      : record.id || `unkeyed-${index}`;
    const current = officialByGame.get(key);
    if (!current || Date.parse(record.recordedAt || 0) >= Date.parse(current.recordedAt || 0)) officialByGame.set(key, record);
  });
  const official = [...officialByGame.values()];
  const settled = official.filter((record) => Number.isFinite(record.outcome?.total));
  const decisive = settled.filter((record) => record.outcome.total !== record.marketTotal);
  const absoluteErrors = settled.map((record) => Math.abs(record.projectedTotal - record.outcome.total));
  const marketErrors = settled.map((record) => Math.abs(record.marketTotal - record.outcome.total));
  const brier = decisive.map((record) => {
    const actualOver = record.outcome.total > record.marketTotal ? 1 : 0;
    return (clampProbability(record.overProbability) - actualOver) ** 2;
  });
  const logLoss = decisive.map((record) => {
    const actualOver = record.outcome.total > record.marketTotal ? 1 : 0;
    const probability = clampProbability(record.overProbability);
    return -(actualOver * Math.log(probability) + (1 - actualOver) * Math.log(1 - probability));
  });
  const correct = decisive.filter((record) =>
    (record.overProbability >= 0.5) === (record.outcome.total > record.marketTotal)).length;
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  const calibration = [];
  for (let lower = 0; lower < 1; lower += 0.1) {
    const upper = lower + 0.1;
    const bin = decisive.filter((record) => record.overProbability >= lower && (upper >= 1 ? record.overProbability <= upper : record.overProbability < upper));
    if (!bin.length) continue;
    calibration.push({
      lower,
      upper,
      forecasts: bin.length,
      predictedOver: average(bin.map((record) => record.overProbability)),
      actualOver: average(bin.map((record) => record.outcome.total > record.marketTotal ? 1 : 0))
    });
  }

  return {
    runs: records.length,
    recorded: official.length,
    settled: settled.length,
    pending: official.length - settled.length,
    decisive: decisive.length,
    meanAbsoluteError: average(absoluteErrors),
    marketMeanAbsoluteError: average(marketErrors),
    brierScore: average(brier),
    logLoss: average(logLoss),
    leanAccuracy: decisive.length ? correct / decisive.length : null,
    calibration
  };
}

export function createPredictionLedger(filePath) {
  let queue = Promise.resolve();
  const serialized = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };

  return {
    list() {
      return serialized(() => readRecords(filePath));
    },
    record(input) {
      return serialized(async () => {
        const requiredNumbers = ['marketTotal', 'projectedTotal', 'overProbability', 'underProbability'];
        if (!input || !/^\d+$/.test(String(input.eventId || '')) || !input.kickoff || requiredNumbers.some((key) => !Number.isFinite(Number(input[key])))) {
          throw new Error('Prediction is missing a game, kickoff, market total, projection, or probability.');
        }
        if (Date.now() >= Date.parse(input.kickoff)) throw new Error('Predictions can only be recorded before kickoff.');
        const records = await readRecords(filePath);
        const record = {
          id: crypto.randomUUID(),
          recordedAt: new Date().toISOString(),
          eventId: String(input.eventId),
          kickoff: new Date(input.kickoff).toISOString(),
          league: String(input.league || ''),
          seasonType: String(input.seasonType || 'regular'),
          matchup: String(input.matchup || ''),
          modelVersion: String(input.modelVersion || 'unknown'),
          engine: String(input.engine || 'unknown'),
          seed: String(input.seed || ''),
          marketTotal: Number(input.marketTotal),
          projectedTotal: Number(input.projectedTotal),
          projectedHome: Number(input.projectedHome),
          projectedAway: Number(input.projectedAway),
          overProbability: Number(input.overProbability),
          underProbability: Number(input.underProbability),
          profileMethod: String(input.profileMethod || ''),
          profileGames: Number(input.profileGames || 0)
        };
        records.push(record);
        await writeRecords(filePath, records);
        return record;
      });
    },
    settle(outcomeLoader) {
      return serialized(async () => {
        const records = await readRecords(filePath);
        const pending = records
          .filter((record) => !record.outcome && Date.now() > Date.parse(record.kickoff))
          .map((record) => ({ eventId: record.eventId, league: record.league }));
        const eventIds = [...new Map(pending.map((item) => [item.eventId, item])).values()];
        const outcomes = new Map();
        for (const item of eventIds) {
          const outcome = await outcomeLoader(item.eventId, item.league).catch(() => null);
          if (outcome?.completed && Number.isFinite(outcome.total)) outcomes.set(item.eventId, outcome);
        }
        let updated = 0;
        for (const record of records) {
          const outcome = outcomes.get(record.eventId);
          if (!record.outcome && outcome) {
            record.outcome = {
              homeScore: outcome.homeScore,
              awayScore: outcome.awayScore,
              total: outcome.total,
              settledAt: new Date().toISOString()
            };
            updated += 1;
          }
        }
        if (updated) await writeRecords(filePath, records);
        return { updated, records, summary: summarizePredictions(records) };
      });
    },
    async summary() {
      return summarizePredictions(await this.list());
    }
  };
}
