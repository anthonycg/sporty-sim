import { buildTeamProfile, extractTeamGame } from './feature-extractor.mjs';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const responseCache = new Map();

async function cachedJson(url, ttl = 300_000) {
  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.createdAt < ttl) return cached.value;
  const response = await fetch(url, {
    headers: { 'user-agent': 'SportySim/0.2 local analytics prototype' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Historical data provider returned ${response.status}`);
  const value = await response.json();
  responseCache.set(url, { createdAt: Date.now(), value });
  return value;
}

export async function loadHistoricalProfile({ league, teamId, before, limit = 3, seasonType = 'regular', seasonYear }) {
  const cutoff = new Date(before);
  const scheduleUrl = `${ESPN_BASE}/${league}/teams/${teamId}/schedule?season=${seasonYear || cutoff.getUTCFullYear()}`;
  const schedule = await cachedJson(scheduleUrl, 120_000);
  const events = (schedule.events || [])
    .filter((event) => new Date(event.date) < cutoff)
    .filter((event) => event.status?.type?.completed || event.competitions?.[0]?.status?.type?.completed)
    .filter((event) => event.competitions?.[0]?.competitors?.some((entry) => String(entry.team?.id) === String(teamId)))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  if (!events.length) {
    return { teamId: String(teamId), cutoff: cutoff.toISOString(), profile: null, games: [], warning: 'No completed games were found before kickoff.' };
  }

  const summaries = await Promise.all(events.map((event) => cachedJson(`${ESPN_BASE}/${league}/summary?event=${event.id}`)));
  const teamGames = summaries.map((summary) => extractTeamGame(summary, teamId));
  const opponentGames = summaries.map((summary, index) => extractTeamGame(summary, teamGames[index].opponent.id));
  const profile = buildTeamProfile(teamGames, opponentGames, { league, seasonType });
  return {
    teamId: String(teamId),
    cutoff: cutoff.toISOString(),
    profile,
    games: teamGames.map((game) => ({ eventId: game.eventId, date: game.date, opponent: game.opponent, plays: game.counters.plays })),
    warning: profile.games < 2 ? 'Only one completed game was available; estimates are heavily shrunk.' : null
  };
}
