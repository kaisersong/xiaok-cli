#!/usr/bin/env node
// Dev loop orchestrator: tsc --watch (main) + vite (renderer) + Electron with auto-restart.
// No external watcher dependency. Restarts Electron on dist/main change after debounce.

import { spawn } from 'node:child_process';
import { existsSync, watch, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..');
const distMain = resolve(desktopDir, 'dist/main');
const mainEntry = resolve(distMain, 'desktop/electron/main.js');
const preloadSrc = resolve(desktopDir, 'electron/preload.cjs');
const preloadDst = resolve(distMain, 'desktop/electron/preload.cjs');
const VITE_PORT = 5173;
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;

const procs = new Set();
let electron = null;
let electronStartedAt = 0;
let restartTimer = null;
let shuttingDown = false;
const RESTART_DEBOUNCE_MS = 1500;
const RESTART_MIN_AGE_MS = 3000;

function log(scope, line) {
  process.stdout.write(`[${scope}] ${line}`);
}

function tail(scope, child) {
  child.stdout?.on('data', (b) => log(scope, b.toString()));
  child.stderr?.on('data', (b) => log(scope, b.toString()));
}

function spawnLogged(scope, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: desktopDir, env: process.env, ...opts });
  procs.add(child);
  tail(scope, child);
  child.on('exit', () => procs.delete(child));
  return child;
}

async function runOnce(scope, cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawnLogged(scope, cmd, args, opts);
    child.on('exit', (code) => (code === 0 ? resolveP() : rejectP(new Error(`${scope} exit ${code}`))));
  });
}

function copyAssets() {
  mkdirSync(dirname(preloadDst), { recursive: true });
  copyFileSync(preloadSrc, preloadDst);
  for (const asset of ['build/tray-icon.png', 'build/icon.png']) {
    const src = resolve(desktopDir, asset);
    if (!existsSync(src)) continue;
    const dst1 = resolve(distMain, 'desktop', asset);
    mkdirSync(dirname(dst1), { recursive: true });
    copyFileSync(src, dst1);
    if (asset === 'build/tray-icon.png') {
      const dst2 = resolve(distMain, 'desktop/electron/tray-icon.png');
      mkdirSync(dirname(dst2), { recursive: true });
      copyFileSync(src, dst2);
    }
  }
}

async function waitForViteReady(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(VITE_URL);
      if (res.ok || res.status === 404) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite dev server not ready at ${VITE_URL}`);
}

async function waitForFile(path, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function startElectron() {
  copyAssets();
  log('electron', `starting (XIAOK_DESKTOP_DEV_SERVER=${VITE_URL})\n`);
  const electronBin = resolve(desktopDir, 'node_modules/.bin/electron');
  const child = spawn(electronBin, [mainEntry], {
    cwd: desktopDir,
    env: { ...process.env, XIAOK_DESKTOP_DEV_SERVER: VITE_URL, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.add(child);
  tail('electron', child);
  child.on('exit', (code, signal) => {
    procs.delete(child);
    if (electron === child) {
      electron = null;
      electronStartedAt = 0;
    }
    if (!shuttingDown) log('electron', `exited code=${code} signal=${signal}\n`);
  });
  electron = child;
  electronStartedAt = Date.now();
}

async function stopElectron() {
  if (!electron) return;
  const child = electron;
  electron = null;
  return new Promise((r) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      r();
    };
    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {}
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      finish();
    }, 3000);
  });
}

function scheduleRestart() {
  if (shuttingDown) return;
  if (electron && electronStartedAt && Date.now() - electronStartedAt < RESTART_MIN_AGE_MS) {
    // Ignore restart bursts during initial warmup; protects against tsc emit storms.
    return;
  }
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await stopElectron();
      copyAssets();
      startElectron();
    } catch (e) {
      log('runner', `restart failed: ${e?.message || e}\n`);
    }
  }, RESTART_DEBOUNCE_MS);
}

function watchAssets() {
  // Watch preload source so changes propagate even though tsc --watch ignores .cjs.
  watch(preloadSrc, { persistent: true }, () => {
    log('runner', 'preload.cjs changed, scheduling restart\n');
    scheduleRestart();
  });
  // Watch dist/main for tsc emit changes.
  watch(distMain, { recursive: true, persistent: true }, (_event, filename) => {
    if (!filename) return;
    if (!/\.(js|cjs)$/.test(filename)) return;
    if (filename.includes('.tsbuildinfo')) return;
    scheduleRestart();
  });
}

async function main() {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log('runner', 'launching tsc --watch (main)\n');
  spawnLogged('tsc', resolve(desktopDir, 'node_modules/.bin/tsc'), [
    '-p',
    'tsconfig.electron.json',
    '--watch',
    '--preserveWatchOutput',
  ]);

  log('runner', 'launching vite dev server (renderer)\n');
  // Use the same vite invocation as `npm run dev` to keep parity.
  spawnLogged('vite', 'npm', ['run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'] });

  log('runner', `waiting for ${mainEntry}\n`);
  await waitForFile(mainEntry, 60_000);
  log('runner', `waiting for vite at ${VITE_URL}\n`);
  await waitForViteReady();

  watchAssets();
  startElectron();
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('runner', 'shutting down\n');
  await stopElectron();
  for (const p of [...procs]) {
    try {
      p.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => process.exit(0), 500);
}

main().catch((e) => {
  log('runner', `fatal: ${e?.message || e}\n`);
  void shutdown();
});
