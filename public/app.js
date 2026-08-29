import { americanFairOdds, neutralTeam } from './simulator.js';
import { baselineFor } from './model-baselines.js';
import { applyRatingAdjustment, calculateTeamRatings } from './team-ratings.js';

const STORAGE_KEY = 'sporty-sim:v0.4';
const MODEL_VERSION = '0.4.0';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  games: [],
  selectedGame: null,
  players: [],
  profiles: {},
  worker: null,
  lastSeed: null
};

const elements = {
  league: $('#leagueSelect'),
  date: $('#gameDate'),
  gameList: $('#gameList'),
  feedStatus: $('#feedStatus'),
  loadGames: $('#loadGamesButton'),
  marketTotal: $('#marketTotal'),
  weather: $('#weatherPenalty'),
  modelMode: $('#modelMode'),
  autoRate: $('#autoRateButton'),
  profileSummary: $('#profileSummary'),
  addPlayer: $('#addPlayerButton'),
  playerList: $('#playerList'),
  emptyPlayers: $('#emptyPlayers'),
  dialog: $('#playerDialog'),
  playerForm: $('#playerForm'),
  runButton: $('#runButton'),
  results: $('#resultsPanel'),
  refreshBacktest: $('#refreshBacktestButton'),
  toast: $('#toast')
};

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2400);
}

function formatKickoff(date) {
  if (!date) return 'Kickoff TBD';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit'
  }).format(new Date(date));
}

function teamLogo(team, fallback) {
  return team?.logo
    ? `<img src="${escapeHtml(team.logo)}" alt="" loading="lazy">`
    : `<span>${escapeHtml(team?.abbreviation?.[0] || fallback)}</span>`;
}

async function loadGames() {
  elements.gameList.innerHTML = '<div class="loading-state"><span></span>Loading slate…</div>';
  elements.feedStatus.textContent = 'Fetching schedule';
  try {
    const query = new URLSearchParams({ league: elements.league.value, date: elements.date.value });
    const response = await fetch(`/api/games?${query}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load the schedule.');
    state.games = payload.games;
    elements.feedStatus.textContent = `Updated ${new Date(payload.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    renderGames();
    const savedId = readSavedState()?.selectedGameId;
    const preferred = state.games.find((game) => game.id === savedId)
      || state.games.find((game) => game.status === 'Scheduled')
      || state.games[0];
    if (preferred) selectGame(preferred.id, { preserveInputs: Boolean(savedId === preferred.id) });
  } catch (error) {
    state.games = [];
    elements.feedStatus.textContent = 'Feed unavailable';
    elements.gameList.innerHTML = `<div class="error-state">${escapeHtml(error.message)} You can still use the manual model below.</div>`;
    showToast('Schedule feed unavailable; manual inputs still work.');
  }
}

function renderGames() {
  if (!state.games.length) {
    elements.gameList.innerHTML = '<div class="error-state">No games found on this date. Try another date or league.</div>';
    return;
  }
  elements.gameList.innerHTML = state.games.map((game) => `
    <button type="button" class="game-card ${state.selectedGame?.id === game.id ? 'is-selected' : ''}" data-game-id="${game.id}">
      <span class="game-card-top"><span>${escapeHtml(formatKickoff(game.kickoff))}</span><span>${escapeHtml(game.broadcast || game.status)}</span></span>
      <span class="game-card-teams">
        <span class="game-card-team">${teamLogo(game.away, 'A')}<strong>${escapeHtml(game.away.name)}</strong><span>${escapeHtml(game.away.record)}</span></span>
        <span class="game-card-team">${teamLogo(game.home, 'H')}<strong>${escapeHtml(game.home.name)}</strong><span>${escapeHtml(game.home.record)}</span></span>
      </span>
      <span class="game-card-market"><span>${escapeHtml(game.market.provider || 'No market line')}</span><strong>${game.market.total ? `O/U ${game.market.total}` : 'Total —'}</strong></span>
    </button>
  `).join('');
  $$('.game-card', elements.gameList).forEach((card) => {
    card.addEventListener('click', () => selectGame(card.dataset.gameId));
  });
}

function setLogo(side, team) {
  $$(`[data-team-logo="${side}"]`).forEach((element) => {
    element.innerHTML = teamLogo(team, side === 'home' ? 'H' : 'A');
  });
}

function selectGame(id, options = {}) {
  const game = state.games.find((item) => item.id === id);
  if (!game) return;
  state.selectedGame = game;
  renderGames();
  ['home', 'away'].forEach((side) => {
    const team = game[side];
    $$(`[data-team-name="${side}"]`).forEach((node) => { node.textContent = team.name; });
    $$(`[data-team-abbr="${side}"]`).forEach((node) => { node.textContent = team.abbreviation || side.toUpperCase(); });
    setLogo(side, team);
  });
  $('#kickoffLabel').textContent = formatKickoff(game.kickoff);
  $('#venueLabel').textContent = [game.venue, game.city].filter(Boolean).join(' · ') || 'Venue TBD';
  if (!options.preserveInputs && Number.isFinite(game.market.total)) elements.marketTotal.value = game.market.total;
  if (!options.preserveInputs) {
    resetTeamInputs(false);
    state.players = [];
    state.profiles = {};
    renderPlayers();
  }
  elements.weather.value = game.indoor ? '0' : elements.weather.value;
  elements.results.classList.add('is-empty');
  elements.profileSummary.classList.remove('is-visible');
  elements.profileSummary.innerHTML = '';
  renderOverallRatings();
  persistState();
}

function setInputValue(side, key, value) {
  const input = document.querySelector(`[name="${side}.${key}"]`);
  if (!input || !Number.isFinite(value)) return;
  input.value = ['offense', 'defense'].includes(key)
    ? Math.round(value)
    : ['epaPerPlay', 'epaAllowedPerPlay'].includes(key) ? Number(value).toFixed(3) : Number(value).toFixed(1);
}

async function autoRateTeams() {
  const game = state.selectedGame;
  if (!game?.home?.id || !game?.away?.id || !game.kickoff) {
    showToast('Choose a scheduled matchup before auto-rating.');
    return;
  }
  elements.autoRate.disabled = true;
  elements.autoRate.textContent = 'Analyzing recent plays…';
  try {
    const load = async (side) => {
      const query = new URLSearchParams({
        league: game.league,
        teamId: game[side].id,
        before: game.kickoff,
        seasonType: game.seasonType,
        seasonYear: String(game.seasonYear),
        limit: '3'
      });
      const response = await fetch(`/api/team-profile?${query}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Could not rate ${game[side].name}.`);
      return payload;
    };
    const [away, home] = await Promise.all([load('away'), load('home')]);
    if (!away.profile || !home.profile) throw new Error('Both teams need at least one completed game before kickoff.');
    for (const [side, payload] of [['away', away], ['home', home]]) {
      const profile = payload.profile;
      state.profiles[side] = profile;
      for (const key of ['plays', 'pace', 'passRate', 'passEfficiency', 'rushEfficiency', 'successRate', 'explosiveRate', 'turnoverRate', 'redZoneTdRate', 'epaPerPlay']) {
        setInputValue(side, key, profile.metrics[key]?.value);
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
      for (const [inputKey, profileKey] of Object.entries(defenseMap)) {
        setInputValue(side, inputKey, profile.defenseAllowed[profileKey]?.value);
      }
    }
    elements.profileSummary.innerHTML = [['away', away], ['home', home]].map(([side, payload]) => `
      <div class="profile-card">
        <div><strong>${escapeHtml(game[side].name)}</strong><span>${payload.profile.games} games · ${payload.opponentContexts || 0} opponent-adjusted · trained on ${payload.profile.playModel.sample.passPlays} pass / ${payload.profile.playModel.sample.rushPlays} rush · EPA ${payload.profile.metrics.epaPerPlay.value.toFixed(2)}</span></div>
        <b>Calculated O ${payload.profile.summaryOffenseRating} · D ${payload.profile.summaryDefenseRating}</b>
      </div>
    `).join('');
    elements.profileSummary.classList.add('is-visible');
    elements.results.classList.add('is-empty');
    renderOverallRatings();
    persistState();
    showToast('Opponent-adjusted EPA profiles and trained play rates applied.');
  } catch (error) {
    showToast(error.message || 'Could not build recent-game profiles.');
  } finally {
    elements.autoRate.disabled = false;
    elements.autoRate.textContent = '↯ Auto-rate recent games';
  }
}

function resetTeamInputs(notify = true) {
  const defaults = neutralTeam(state.selectedGame?.league || elements.league.value, state.selectedGame?.seasonType || 'regular');
  $$('[name^="home."], [name^="away."]').forEach((input) => {
    const key = input.name.split('.')[1];
    input.value = defaults[key];
  });
  state.profiles = {};
  renderOverallRatings();
  if (notify) showToast('Team assumptions reset to neutral.');
  elements.results.classList.add('is-empty');
  persistState();
}

function readTeamInputs(side) {
  const team = {};
  $$(`[name^="${side}."]`).forEach((input) => {
    team[input.name.split('.')[1]] = Number(input.value);
  });
  return team;
}

function ratingDetails(side) {
  const team = readTeamInputs(side);
  const baseline = baselineFor(elements.league.value, state.selectedGame?.seasonType || 'regular');
  const calculated = calculateTeamRatings(team, baseline);
  return {
    team,
    calculated,
    overall: {
      offense: applyRatingAdjustment(calculated.offense, team.offenseAdjustment),
      defense: applyRatingAdjustment(calculated.defense, team.defenseAdjustment)
    }
  };
}

function renderOverallRatings() {
  for (const side of ['away', 'home']) {
    const { overall } = ratingDetails(side);
    $(`#${side}OffenseRating`).textContent = overall.offense;
    $(`#${side}DefenseRating`).textContent = overall.defense;
  }
}

function readTeam(side) {
  const { team, overall } = ratingDetails(side);
  // Components create the calculated grade. Only the independent manual adjustment
  // enters the 50-centered rating term so the same production is not counted twice.
  team.offense = applyRatingAdjustment(50, team.offenseAdjustment);
  team.defense = applyRatingAdjustment(50, team.defenseAdjustment);
  team.overallOffense = overall.offense;
  team.overallDefense = overall.defense;
  if (state.profiles[side]?.playModel) team.trained = structuredClone(state.profiles[side].playModel);
  return team;
}

function configFromForm() {
  return {
    league: elements.league.value,
    seasonType: state.selectedGame?.seasonType || 'regular',
    marketTotal: Number(elements.marketTotal.value),
    home: readTeam('home'),
    away: readTeam('away'),
    players: structuredClone(state.players),
    environment: {
      weatherPenalty: Number(elements.weather.value),
      variance: state.selectedGame?.seasonType === 'preseason' ? 10 : 4
    }
  };
}

function openPlayerDialog(player = null) {
  const game = state.selectedGame;
  $('#playerTeam').options[0].textContent = game?.away?.shortName || game?.away?.name || 'Away';
  $('#playerTeam').options[1].textContent = game?.home?.shortName || game?.home?.name || 'Home';
  const values = player || {
    id: '', name: '', team: 'away', unit: 'offense', unitGroup: 'quarterback',
    playProbability: 50, limitedProbability: 20, pointsImpact: 2,
    limitedImpact: 40, snapShare: 80
  };
  $('#editPlayerId').value = values.id;
  $('#playerName').value = values.name;
  $('#playerTeam').value = values.team;
  $('#playerUnit').value = values.unit;
  $('#playerGroup').value = values.unitGroup;
  $('#playProbability').value = values.playProbability;
  $('#limitedProbability').value = values.limitedProbability;
  $('#pointsImpact').value = values.pointsImpact;
  $('#limitedImpact').value = values.limitedImpact;
  $('#snapShare').value = values.snapShare;
  elements.dialog.showModal();
  requestAnimationFrame(() => $('#playerName').focus());
}

function savePlayer(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') {
    elements.dialog.close();
    return;
  }
  const form = elements.playerForm;
  if (!form.reportValidity()) return;
  const playProbability = Number($('#playProbability').value);
  const limitedProbability = Number($('#limitedProbability').value);
  if (limitedProbability > playProbability) {
    showToast('Limited probability cannot exceed chance to play.');
    return;
  }
  const id = $('#editPlayerId').value || crypto.randomUUID();
  const player = {
    id,
    name: $('#playerName').value.trim(),
    team: $('#playerTeam').value,
    unit: $('#playerUnit').value,
    unitGroup: $('#playerGroup').value,
    playProbability,
    limitedProbability,
    pointsImpact: Number($('#pointsImpact').value),
    limitedImpact: Number($('#limitedImpact').value),
    snapShare: Number($('#snapShare').value)
  };
  const index = state.players.findIndex((item) => item.id === id);
  if (index >= 0) state.players[index] = player;
  else state.players.push(player);
  elements.dialog.close();
  renderPlayers();
  persistState();
  showToast(index >= 0 ? 'Availability scenario updated.' : 'Availability scenario added.');
}

function renderPlayers() {
  elements.emptyPlayers.classList.toggle('is-hidden', state.players.length > 0);
  elements.playerList.innerHTML = state.players.map((player) => {
    const team = state.selectedGame?.[player.team];
    const unavailable = 100 - player.playProbability;
    return `
      <div class="player-card" data-player-id="${player.id}">
        <div class="player-card-main">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${escapeHtml(team?.abbreviation || player.team.toUpperCase())} · ${escapeHtml(player.unitGroup.replaceAll('-', ' '))} · <b>${player.playProbability}% play</b> / ${unavailable}% out · ${player.pointsImpact.toFixed(2)} pts at risk</span>
        </div>
        <div class="player-actions">
          <button type="button" data-action="edit" aria-label="Edit ${escapeHtml(player.name)}">✎</button>
          <button type="button" data-action="remove" aria-label="Remove ${escapeHtml(player.name)}">×</button>
        </div>
      </div>`;
  }).join('');

  $$('.player-card', elements.playerList).forEach((card) => {
    card.addEventListener('click', (event) => {
      const action = event.target.closest('button')?.dataset.action;
      if (!action) return;
      const player = state.players.find((item) => item.id === card.dataset.playerId);
      if (action === 'edit') openPlayerDialog(player);
      if (action === 'remove') {
        state.players = state.players.filter((item) => item.id !== card.dataset.playerId);
        renderPlayers();
        persistState();
      }
    });
  });
}

function runModel() {
  const config = configFromForm();
  if (!Number.isFinite(config.marketTotal)) {
    showToast('Enter a valid market total.');
    elements.marketTotal.focus();
    return;
  }
  if (state.worker) state.worker.terminate();
  state.worker = new Worker('/sim-worker.js', { type: 'module' });
  elements.runButton.disabled = true;
  const mode = elements.modelMode.value;
  $('.button-label', elements.runButton).textContent = mode === 'compare' ? 'Running both 200k-game models…' : 'Simulating 200k games…';
  $('.button-progress', elements.runButton).style.width = '4%';
  let seed;
  do {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (seed === state.lastSeed);
  state.lastSeed = seed;
  state.worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      $('.button-progress', elements.runButton).style.width = `${Math.max(4, data.progress * 100)}%`;
    } else if (data.type === 'complete') {
      $('.button-progress', elements.runButton).style.width = '100%';
      renderResults(data.result, config);
      recordPrediction(data.result, config);
      setTimeout(resetRunButton, 250);
      persistState();
    } else if (data.type === 'error') {
      showToast(data.error);
      resetRunButton();
    }
  };
  state.worker.onerror = () => {
    showToast('The simulation worker stopped unexpectedly.');
    resetRunButton();
  };
  state.worker.postMessage({ config, iterations: 200_000, seed, mode });
}

function runButtonMarkup() {
  const label = elements.modelMode.value === 'compare'
    ? 'Run 200k × 2 models'
    : elements.modelMode.value === 'play'
      ? 'Run 200k play-level games'
      : 'Run 200k drive-level games';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z"/></svg> ${label}`;
}

function resetRunButton() {
  elements.runButton.disabled = false;
  $('.button-label', elements.runButton).innerHTML = runButtonMarkup();
  $('.button-progress', elements.runButton).style.width = '0';
  state.worker?.terminate();
  state.worker = null;
}

function percentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function renderBacktest(summary) {
  $('#backtestRecorded').textContent = summary.recorded ?? 0;
  $('#backtestSettled').textContent = summary.settled ?? 0;
  $('#backtestMae').textContent = formatMetric(summary.meanAbsoluteError, 1);
  $('#backtestMarketMae').textContent = formatMetric(summary.marketMeanAbsoluteError, 1);
  $('#backtestBrier').textContent = formatMetric(summary.brierScore, 3);
  $('#backtestAccuracy').textContent = Number.isFinite(summary.leanAccuracy) ? percentage(summary.leanAccuracy) : '—';
  $('#backtestStatus').textContent = summary.settled
    ? `${summary.runs} stored runs collapsed to one final forecast per game/model · ${summary.pending} pending · ${summary.decisive} graded without pushes.`
    : `${summary.pending || 0} pending forecast${summary.pending === 1 ? '' : 's'} from ${summary.runs || 0} stored runs. Accuracy metrics need a substantial out-of-sample set.`;
}

async function loadBacktest(refresh = false) {
  if (refresh) {
    elements.refreshBacktest.disabled = true;
    elements.refreshBacktest.textContent = 'Checking finals…';
  }
  try {
    const response = await fetch(refresh ? '/api/backtest/settle' : '/api/backtest', refresh ? { method: 'POST' } : undefined);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not load the scorecard.');
    renderBacktest(payload.summary || payload);
    if (refresh) showToast(payload.updated ? `${payload.updated} forecast${payload.updated === 1 ? '' : 's'} graded.` : 'No new final scores yet.');
  } catch (error) {
    $('#backtestStatus').textContent = error.message || 'Could not load the scorecard.';
  } finally {
    if (refresh) {
      elements.refreshBacktest.disabled = false;
      elements.refreshBacktest.textContent = 'Refresh results';
    }
  }
}

async function recordPrediction(rawResult, config) {
  const game = state.selectedGame;
  if (!game?.id || Date.now() >= Date.parse(game.kickoff)) return;
  const result = rawResult.primary || rawResult;
  try {
    const response = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: game.id,
        kickoff: game.kickoff,
        league: game.league,
        seasonType: game.seasonType,
        matchup: game.name,
        modelVersion: MODEL_VERSION,
        engine: rawResult.mode === 'compare' ? 'play-comparison-primary' : result.model,
        seed: rawResult.mode === 'compare' ? `${rawResult.drive.seed}/${rawResult.play.seed}` : result.seed,
        marketTotal: config.marketTotal,
        projectedTotal: result.mean,
        projectedHome: result.homeMean,
        projectedAway: result.awayMean,
        overProbability: result.overProbability,
        underProbability: result.underProbability,
        profileMethod: state.profiles.home?.method || 'manual assumptions',
        profileGames: (state.profiles.home?.games || 0) + (state.profiles.away?.games || 0)
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Forecast could not be recorded.');
    renderBacktest(payload.summary);
  } catch (error) {
    showToast(error.message || 'Simulation completed, but its forecast was not recorded.');
  }
}

function renderResults(result, config) {
  const comparison = result.mode === 'compare' ? result : null;
  result = result.primary || result;
  const overLean = result.overProbability >= result.underProbability;
  const leanProbability = overLean ? result.overProbability : result.underProbability;
  const lean = overLean ? 'OVER' : 'UNDER';
  const direction = result.edge >= 0 ? '+' : '';
  $('#leanLabel').textContent = `${lean} ${config.marketTotal.toFixed(1)}`;
  $('#edgeLabel').textContent = `${direction}${result.edge.toFixed(1)} points vs market`;
  $('#leanProbability').textContent = percentage(leanProbability);
  $('#confidenceRing').style.setProperty('--probability', leanProbability * 100);
  $('#awayProjection').textContent = result.awayMean.toFixed(1);
  $('#homeProjection').textContent = result.homeMean.toFixed(1);
  $('#meanTotal').textContent = result.mean.toFixed(1);
  $('#medianTotal').textContent = result.median.toFixed(1);
  $('#rangeTotal').textContent = `${Math.round(result.low80)}–${Math.round(result.high80)}`;
  $('#fairOdds').textContent = americanFairOdds(leanProbability);
  $('#overLine').textContent = config.marketTotal.toFixed(1);
  $('#underLine').textContent = config.marketTotal.toFixed(1);
  $('#overProbability').textContent = percentage(result.overProbability);
  $('#underProbability').textContent = percentage(result.underProbability);
  $('#overBar').style.width = percentage(result.overProbability);
  $('#underBar').style.width = percentage(result.underProbability);
  const seedLabel = comparison ? `${comparison.drive.seed}/${comparison.play.seed}` : result.seed;
  $('#runTimestamp').textContent = `${comparison ? '400k total runs' : '200k runs'} · seed ${seedLabel}`;
  const comparisonPanel = $('#modelComparison');
  comparisonPanel.classList.toggle('is-visible', Boolean(comparison));
  if (comparison) {
    $('#driveModelMean').textContent = comparison.drive.mean.toFixed(1);
    $('#playModelMean').textContent = comparison.play.mean.toFixed(1);
    $('#driveModelLean').textContent = `${comparison.drive.overProbability >= .5 ? 'Over' : 'Under'} ${percentage(Math.max(comparison.drive.overProbability, comparison.drive.underProbability))}`;
    $('#playModelLean').textContent = `${comparison.play.overProbability >= .5 ? 'Over' : 'Under'} ${percentage(Math.max(comparison.play.overProbability, comparison.play.underProbability))}`;
  }
  renderHistogram(result.histogram, config.marketTotal);
  elements.results.classList.remove('is-empty');
  elements.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderHistogram(histogram, marketTotal) {
  const useful = histogram.filter(({ count }) => count >= 25);
  const max = Math.max(...useful.map(({ count }) => count));
  const nearestLine = useful.reduce((nearest, item) =>
    Math.abs(item.bucket - marketTotal) < Math.abs(nearest.bucket - marketTotal) ? item : nearest, useful[0]);
  $('#histogram').innerHTML = useful.map(({ bucket, count }) => `
    <div class="histogram-bar ${bucket >= marketTotal ? 'is-over' : ''} ${bucket === nearestLine.bucket ? 'is-line' : ''}"
      style="height:${Math.max(2, count / max * 100)}%" title="${bucket}–${bucket + 2}: ${count.toLocaleString()} games"></div>
  `).join('');
  const first = useful[0]?.bucket ?? 0;
  const last = (useful.at(-1)?.bucket ?? -2) + 2;
  $('#chartAxis').innerHTML = `<span>${first}</span><span>${Math.round((first + last) / 2)}</span><span>${last}</span>`;
}

function persistState() {
  const inputs = {};
  $$('input[name^="home."], input[name^="away."]').forEach((input) => { inputs[input.name] = input.value; });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    league: elements.league.value,
    date: elements.date.value,
    selectedGameId: state.selectedGame?.id,
    marketTotal: elements.marketTotal.value,
    weather: elements.weather.value,
    modelMode: elements.modelMode.value,
    inputs,
    players: state.players,
    profiles: state.profiles
  }));
}

function readSavedState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function restoreState() {
  const saved = readSavedState();
  elements.date.value = saved?.date || localDateString();
  elements.league.value = saved?.league || 'nfl';
  if (!saved) return;
  elements.marketTotal.value = saved.marketTotal || '44.5';
  elements.weather.value = saved.weather || '0';
  elements.modelMode.value = saved.modelMode || 'compare';
  Object.entries(saved.inputs || {}).forEach(([name, value]) => {
    const input = document.querySelector(`[name="${CSS.escape(name)}"]`);
    if (input) input.value = value;
  });
  state.players = Array.isArray(saved.players) ? saved.players : [];
  state.profiles = saved.profiles && typeof saved.profiles === 'object' ? saved.profiles : {};
  renderPlayers();
  renderOverallRatings();
}

function resetEverything() {
  localStorage.removeItem(STORAGE_KEY);
  resetTeamInputs(false);
  state.players = [];
  state.profiles = {};
  renderPlayers();
  elements.weather.value = '0';
  if (state.selectedGame?.market.total) elements.marketTotal.value = state.selectedGame.market.total;
  else elements.marketTotal.value = '44.5';
  elements.results.classList.add('is-empty');
  persistState();
  showToast('All assumptions cleared.');
}

elements.loadGames.addEventListener('click', loadGames);
elements.addPlayer.addEventListener('click', () => openPlayerDialog());
elements.autoRate.addEventListener('click', autoRateTeams);
elements.playerForm.addEventListener('submit', savePlayer);
elements.runButton.addEventListener('click', runModel);
elements.refreshBacktest.addEventListener('click', () => loadBacktest(true));
$('#presetButton').addEventListener('click', () => resetTeamInputs());
$('#resetButton').addEventListener('click', resetEverything);
elements.league.addEventListener('change', loadGames);
elements.date.addEventListener('change', loadGames);
elements.modelMode.addEventListener('change', () => {
  $('.button-label', elements.runButton).innerHTML = runButtonMarkup();
});
$$('input, select').forEach((input) => {
  input.addEventListener('input', () => {
    if (input.matches('[name^="home."], [name^="away."]')) renderOverallRatings();
  });
  input.addEventListener('change', () => {
    if (input.closest('#playerDialog')) return;
    if (input.matches('[name^="home."], [name^="away."]')) renderOverallRatings();
    elements.results.classList.add('is-empty');
    persistState();
  });
});

restoreState();
renderOverallRatings();
$('.button-label', elements.runButton).innerHTML = runButtonMarkup();
loadGames();
loadBacktest();
