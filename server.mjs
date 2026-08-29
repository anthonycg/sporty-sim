import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHistoricalProfile } from './lib/historical-profile.mjs';
import { createPredictionLedger } from './lib/prediction-ledger.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const LEAGUES = new Set(['nfl', 'college-football']);
const cache = new Map();
const predictionLedger = createPredictionLedger(process.env.PREDICTIONS_FILE || join(ROOT, 'data', 'predictions.json'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function compactDate(value) {
  return value.replaceAll('-', '');
}

function recordFor(competitor) {
  return competitor.records?.find((record) => record.type === 'total')?.summary || '—';
}

function normalizeGame(event, league) {
  const competition = event.competitions?.[0] || {};
  const homeRaw = competition.competitors?.find((team) => team.homeAway === 'home') || {};
  const awayRaw = competition.competitors?.find((team) => team.homeAway === 'away') || {};
  const odds = competition.odds?.[0] || {};

  const normalizeTeam = (team) => ({
    id: team.team?.id || '',
    name: team.team?.displayName || 'Unknown team',
    shortName: team.team?.shortDisplayName || team.team?.name || '',
    abbreviation: team.team?.abbreviation || '',
    color: team.team?.color ? `#${team.team.color}` : null,
    alternateColor: team.team?.alternateColor ? `#${team.team.alternateColor}` : null,
    logo: team.team?.logo || null,
    record: recordFor(team)
  });

  return {
    id: event.id,
    league,
    seasonYear: event.season?.year || new Date(event.date).getUTCFullYear(),
    seasonType: event.season?.type === 1 ? 'preseason' : 'regular',
    name: event.name,
    shortName: event.shortName,
    kickoff: event.date,
    status: competition.status?.type?.description || event.status?.type?.description || 'Scheduled',
    statusDetail: competition.status?.type?.shortDetail || '',
    venue: competition.venue?.fullName || '',
    city: [competition.venue?.address?.city, competition.venue?.address?.state].filter(Boolean).join(', '),
    indoor: Boolean(competition.venue?.indoor),
    broadcast: competition.broadcasts?.flatMap((item) => item.names || []).join(', '),
    home: normalizeTeam(homeRaw),
    away: normalizeTeam(awayRaw),
    market: {
      total: Number.isFinite(odds.overUnder) ? odds.overUnder : null,
      spread: Number.isFinite(odds.spread) ? odds.spread : null,
      details: odds.details || null,
      provider: odds.provider?.name || null,
      overPrice: odds.total?.over?.close?.odds || null,
      underPrice: odds.total?.under?.close?.odds || null
    }
  };
}

async function fetchGames(league, date) {
  const key = `${league}:${date}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < 60_000) return cached.value;

  const endpoint = `${ESPN_BASE}/${league}/scoreboard?dates=${compactDate(date)}&limit=100`;
  const response = await fetch(endpoint, {
    headers: { 'user-agent': 'SportySim/0.1 local analytics prototype' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Schedule provider returned ${response.status}`);
  const raw = await response.json();
  const value = {
    source: 'ESPN public scoreboard feed',
    fetchedAt: new Date().toISOString(),
    games: (raw.events || []).map((event) => normalizeGame(event, league))
  };
  cache.set(key, { createdAt: Date.now(), value });
  return value;
}

async function fetchOutcome(eventId, league) {
  if (!LEAGUES.has(league)) throw new Error('Unknown league in prediction ledger.');
  const endpoint = `${ESPN_BASE}/${league}/summary?event=${eventId}`;
  const response = await fetch(endpoint, {
    headers: { 'user-agent': 'SportySim/0.4 local analytics prototype' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Final-score provider returned ${response.status}`);
  const payload = await response.json();
  const competition = payload.header?.competitions?.[0] || {};
  const home = competition.competitors?.find((team) => team.homeAway === 'home');
  const away = competition.competitors?.find((team) => team.homeAway === 'away');
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);
  return {
    completed: Boolean(competition.status?.type?.completed),
    homeScore,
    awayScore,
    total: Number.isFinite(homeScore) && Number.isFinite(awayScore) ? homeScore + awayScore : null
  };
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'cache-control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, version: '0.4.0' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/games') {
    const league = url.searchParams.get('league') || 'nfl';
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    if (!LEAGUES.has(league) || !validDate(date)) {
      sendJson(response, 400, { error: 'Use league=nfl|college-football and date=YYYY-MM-DD.' });
      return;
    }
    try {
      sendJson(response, 200, await fetchGames(league, date));
    } catch (error) {
      sendJson(response, 502, { error: error.message || 'Could not load schedule.' });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/team-profile') {
    const league = url.searchParams.get('league') || 'nfl';
    const teamId = url.searchParams.get('teamId') || '';
    const before = url.searchParams.get('before') || '';
    const seasonType = url.searchParams.get('seasonType') === 'preseason' ? 'preseason' : 'regular';
    const seasonYear = Number(url.searchParams.get('seasonYear')) || new Date(before).getUTCFullYear();
    const limit = Math.min(6, Math.max(1, Number(url.searchParams.get('limit')) || 3));
    if (!LEAGUES.has(league) || !/^\d+$/.test(teamId) || !Number.isFinite(Date.parse(before))) {
      sendJson(response, 400, { error: 'Use a valid league, numeric teamId, and ISO before timestamp.' });
      return;
    }
    try {
      sendJson(response, 200, await loadHistoricalProfile({ league, teamId, before, limit, seasonType, seasonYear }));
    } catch (error) {
      sendJson(response, 502, { error: error.message || 'Could not build the historical profile.' });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/backtest') {
    try {
      sendJson(response, 200, { summary: await predictionLedger.summary() });
    } catch (error) {
      sendJson(response, 500, { error: error.message || 'Could not load the prediction ledger.' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/predictions') {
    try {
      const record = await predictionLedger.record(await readJsonBody(request));
      sendJson(response, 201, { record, summary: await predictionLedger.summary() });
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Could not record the prediction.' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/backtest/settle') {
    try {
      const { updated, summary } = await predictionLedger.settle(fetchOutcome);
      sendJson(response, 200, { updated, summary });
    } catch (error) {
      sendJson(response, 502, { error: error.message || 'Could not refresh final scores.' });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD, POST' });
    response.end();
    return;
  }
  await serveStatic(request, response, decodeURIComponent(url.pathname));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sporty Sim is running at http://127.0.0.1:${PORT}`);
});
