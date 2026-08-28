import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appPort = 4197;
const debugPort = 9297;
const chromePath = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome';
const chromeProfile = mkdtempSync(join(tmpdir(), 'sporty-sim-smoke-'));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForUrl(url, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(appPort) },
  stdio: 'ignore'
});
let chrome;

try {
  await waitForUrl(`http://127.0.0.1:${appPort}/api/health`);
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, 'about:blank'
  ], { stdio: 'ignore' });
  await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
  const pageResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${appPort}`)}`, { method: 'PUT' });
  const page = await pageResponse.json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };

  await wait(2_000);
  const cards = await evaluate("document.querySelectorAll('.game-card').length");
  assert.ok(cards > 0, 'Expected live matchup cards to load.');
  await evaluate("document.querySelector('#runButton').click(); true");
  let resultReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    resultReady = await evaluate("!document.querySelector('#resultsPanel').classList.contains('is-empty')");
    if (resultReady) break;
    await wait(100);
  }
  assert.ok(resultReady, 'Expected simulation result to render.');
  const summary = await evaluate("({ game: document.querySelector('[data-team-abbr=\"away\"]').textContent, mean: document.querySelector('#meanTotal').textContent, probability: document.querySelector('#leanProbability').textContent })");
  assert.match(summary.mean, /^\d+\.\d$/);
  assert.match(summary.probability, /^\d+\.\d%$/);
  console.log(`Browser smoke passed: ${summary.game}, mean ${summary.mean}, lean ${summary.probability}`);
  socket.close();
} finally {
  chrome?.kill('SIGTERM');
  server.kill('SIGTERM');
  if (chrome && chrome.exitCode === null) await Promise.race([once(chrome, 'exit'), wait(2_000)]);
  try {
    rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A short-lived Chrome helper can retain the disposable profile on macOS.
  }
}
