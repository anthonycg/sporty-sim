import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadHistoricalProfile } from '../lib/historical-profile.mjs';
import { buildBacktestReport, formatBacktestMarkdown, formatBacktestReport } from '../lib/backtest-report.mjs';
import { runPlaySimulation } from '../public/play-simulator.js';
import { runSimulation, neutralTeam } from '../public/simulator.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const MODEL_VERSION = '0.4.0';

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const [key, inline] = item.slice(2).split('=');
    result[key] = inline ?? (argv[index + 1]?.startsWith('--') ? true : argv[++index]) ?? true;
  }
  return result;
}

const args = argumentsFrom(process.argv.slice(2));
const league = args.league || 'nfl';
const season = Number(args.season || new Date().getUTCFullYear());
const seasonType = args['season-type'] === 'preseason' ? 'preseason' : 'regular';
const seasonTypeNumber = seasonType === 'preseason' ? 1 : 2;
const iterations = Number(args.iterations || 200_000);
const maximumWeek = Number(args['week-end'] || (league === 'nfl' ? 18 : 16));
const minimumWeek = Number(args['week-start'] || 1);
const through = args.through ? new Date(args.through) : new Date();
const eventFilter = args.event ? String(args.event) : null;
const gameLimit = args.limit ? Number(args.limit) : Infinity;
const outputPath = resolve(args.output || `data/backtests/${league}-${season}-${seasonType}-v${MODEL_VERSION}.json`);
const engines = args.models === 'drive' ? ['drive'] : args.models === 'play' ? ['play'] : ['drive', 'play'];

if (!['nfl', 'college-football'].includes(league)) throw new Error('Use --league nfl or --league college-football.');
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('--iterations must be a positive integer.');
if (Number.isNaN(through.getTime())) throw new Error('--through must be a valid ISO date or timestamp.');

const fetchCache = new Map();
async function fetchJson(url, attempts = 3) {
  if (fetchCache.has(url)) return fetchCache.get(url);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'SportySim/0.4 local walk-forward backtest' },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`Historical provider returned ${response.status}`);
      const value = await response.json();
      fetchCache.set(url, value);
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolveWait) => setTimeout(resolveWait, 500 * attempt));
    }
  }
  throw lastError;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeEvent(event, week) {
  const competition = event.competitions?.[0] || {};
  const home = competition.competitors?.find((team) => team.homeAway === 'home') || {};
  const away = competition.competitors?.find((team) => team.homeAway === 'away') || {};
  return {
    eventId: String(event.id),
    week,
    kickoff: event.date,
    name: event.name,
    completed: Boolean(competition.status?.type?.completed || event.status?.type?.completed),
    home: { id: String(home.team?.id || ''), name: home.team?.displayName || 'Home', score: Number(home.score) },
    away: { id: String(away.team?.id || ''), name: away.team?.displayName || 'Away', score: Number(away.score) },
    scoreboardTotal: Number(competition.odds?.[0]?.overUnder)
  };
}

async function loadSchedule() {
  const events = new Map();
  for (let week = minimumWeek; week <= maximumWeek; week += 1) {
    const url = `${ESPN_BASE}/${league}/scoreboard?dates=${season}&seasontype=${seasonTypeNumber}&week=${week}&limit=200`;
    const payload = await fetchJson(url);
    for (const event of payload.events || []) events.set(String(event.id), normalizeEvent(event, week));
  }
  return [...events.values()]
    .filter((game) => game.completed && Date.parse(game.kickoff) <= through.getTime())
    .filter((game) => !eventFilter || game.eventId === eventFilter)
    .sort((first, second) => Date.parse(first.kickoff) - Date.parse(second.kickoff))
    .slice(0, gameLimit);
}

async function historicalMarket(game) {
  const summary = await fetchJson(`${ESPN_BASE}/${league}/summary?event=${game.eventId}`);
  const pick = summary.pickcenter?.find((item) => Number.isFinite(Number(item.overUnder))) || summary.pickcenter?.[0];
  const total = Number.isFinite(Number(pick?.overUnder)) ? Number(pick.overUnder) : game.scoreboardTotal;
  return {
    total: Number.isFinite(total) ? total : null,
    provider: pick?.provider?.name || null,
    overOdds: Number.isFinite(Number(pick?.overOdds)) ? Number(pick.overOdds) : null,
    underOdds: Number.isFinite(Number(pick?.underOdds)) ? Number(pick.underOdds) : null,
    source: pick ? 'ESPN archived pickcenter' : 'ESPN scoreboard'
  };
}

function teamFromProfile(profile) {
  const team = neutralTeam(league, seasonType);
  if (!profile) return team;
  for (const key of ['plays', 'pace', 'passRate', 'passEfficiency', 'rushEfficiency', 'successRate', 'explosiveRate', 'turnoverRate', 'redZoneTdRate', 'epaPerPlay']) {
    if (Number.isFinite(profile.metrics?.[key]?.value)) team[key] = profile.metrics[key].value;
  }
  const defenseMap = {
    passDefenseEfficiency: 'passEfficiency',
    rushDefenseEfficiency: 'rushEfficiency',
    successAllowedRate: 'successRate',
    explosiveAllowedRate: 'explosiveRate',
    pressureRate: 'sackRate',
    takeawayRate: 'turnoverRate',
    epaAllowedPerPlay: 'epaPerPlay'
  };
  for (const [teamKey, profileKey] of Object.entries(defenseMap)) {
    if (Number.isFinite(profile.defenseAllowed?.[profileKey]?.value)) team[teamKey] = profile.defenseAllowed[profileKey].value;
  }
  team.trained = profile.playModel;
  return team;
}

async function loadProfile(teamId, kickoff) {
  return loadHistoricalProfile({
    league,
    teamId,
    before: kickoff,
    limit: 3,
    seasonType,
    seasonYear: season
  });
}

function compactResult(result) {
  return {
    iterations: result.iterations,
    seed: result.seed,
    mean: result.mean,
    median: result.median,
    low80: result.low80,
    high80: result.high80,
    standardDeviation: result.standardDeviation,
    homeMean: result.homeMean,
    awayMean: result.awayMean,
    overProbability: result.overProbability,
    underProbability: result.underProbability,
    pushProbability: result.pushProbability,
    edge: result.edge
  };
}

async function readCheckpoint() {
  try {
    const value = JSON.parse(await readFile(outputPath, 'utf8'));
    if (value.metadata?.modelVersion !== MODEL_VERSION || value.metadata?.iterations !== iterations) {
      throw new Error(`Existing checkpoint uses model ${value.metadata?.modelVersion} and ${value.metadata?.iterations} iterations. Choose another --output path.`);
    }
    return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      metadata: { modelVersion: MODEL_VERSION, league, season, seasonType, iterations, engines, startedAt: new Date().toISOString(), through: through.toISOString() },
      games: [],
      summary: buildBacktestReport([])
    };
  }
}

async function checkpoint(value) {
  value.summary = buildBacktestReport(value.games);
  value.metadata.updatedAt = new Date().toISOString();
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, outputPath);
  const markdownPath = outputPath.endsWith('.json') ? outputPath.replace(/\.json$/, '.md') : `${outputPath}.md`;
  await writeFile(markdownPath, formatBacktestMarkdown(value.summary, value.metadata));
}

const schedule = await loadSchedule();
const checkpointData = await readCheckpoint();
for (const [key, expected] of Object.entries({ league, season, seasonType })) {
  if (checkpointData.metadata[key] !== expected) throw new Error(`Existing checkpoint ${key} is ${checkpointData.metadata[key]}, not ${expected}. Choose another --output path.`);
}
checkpointData.metadata.through = through.toISOString();
const complete = new Set(checkpointData.games
  .filter((game) => engines.every((engine) => game.models?.[engine]))
  .map((game) => game.eventId));

console.log(`Walk-forward backtest: ${league} ${season} ${seasonType}`);
console.log(`${schedule.length} completed games · ${iterations.toLocaleString()} simulations per engine · ${engines.join(' + ')}`);
console.log(`Checkpoint: ${outputPath}`);

let position = 0;
for (const game of schedule) {
  position += 1;
  if (complete.has(game.eventId)) {
    console.log(`[${position}/${schedule.length}] ${game.name} already complete`);
    continue;
  }
  const started = Date.now();
  console.log(`[${position}/${schedule.length}] Building ${game.name} (${game.kickoff})`);
  const [homeHistory, awayHistory, market] = await Promise.all([
    loadProfile(game.home.id, game.kickoff),
    loadProfile(game.away.id, game.kickoff),
    historicalMarket(game)
  ]);
  const config = {
    league,
    seasonType,
    marketTotal: market.total ?? (game.home.score + game.away.score),
    home: teamFromProfile(homeHistory.profile),
    away: teamFromProfile(awayHistory.profile),
    players: [],
    environment: { weatherPenalty: 0, variance: seasonType === 'preseason' ? 10 : 4 }
  };
  const existingIndex = checkpointData.games.findIndex((item) => item.eventId === game.eventId);
  const record = existingIndex >= 0 ? checkpointData.games[existingIndex] : {
    eventId: game.eventId,
    week: game.week,
    kickoff: game.kickoff,
    matchup: game.name,
    home: { id: game.home.id, name: game.home.name },
    away: { id: game.away.id, name: game.away.name },
    actual: { home: game.home.score, away: game.away.score, total: game.home.score + game.away.score },
    market,
    profiles: {
      home: { games: homeHistory.profile?.games || 0, opponentContexts: homeHistory.opponentContexts || 0, method: homeHistory.profile?.method || 'Neutral fallback' },
      away: { games: awayHistory.profile?.games || 0, opponentContexts: awayHistory.opponentContexts || 0, method: awayHistory.profile?.method || 'Neutral fallback' }
    },
    models: {}
  };
  if (engines.includes('drive') && !record.models.drive) {
    const seed = hashSeed(`${MODEL_VERSION}:${game.eventId}:drive`);
    record.models.drive = compactResult(runSimulation(config, iterations, seed));
    console.log(`  drive ${record.models.drive.mean.toFixed(1)} vs ${record.actual.total} actual`);
  }
  if (engines.includes('play') && !record.models.play) {
    const seed = hashSeed(`${MODEL_VERSION}:${game.eventId}:play`);
    record.models.play = compactResult(runPlaySimulation(config, iterations, seed));
    console.log(`  play  ${record.models.play.mean.toFixed(1)} vs ${record.actual.total} actual`);
  }
  if (existingIndex >= 0) checkpointData.games[existingIndex] = record;
  else checkpointData.games.push(record);
  await checkpoint(checkpointData);
  console.log(`  saved in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

checkpointData.metadata.completedAt = new Date().toISOString();
await checkpoint(checkpointData);
console.log('\n' + formatBacktestReport(checkpointData.summary));
