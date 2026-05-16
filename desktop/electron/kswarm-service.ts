/**
 * KSwarm Service Manager
 *
 * Manages the kswarm server as a child process from Electron's main process.
 * - Spawns `node <kswarm>/src/server/index.js` on app ready
 * - Health checks via GET http://localhost:4400/health
 * - Auto-restart on crash (with backoff)
 * - Graceful shutdown on app quit
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KSWARM_PORT = 4400;
const BROKER_PORT = 4318;
const HEALTH_URL = `http://127.0.0.1:${KSWARM_PORT}/health`;
const HEALTH_INTERVAL_MS = 10_000;
const RESTART_BASE_DELAY_MS = 2_000;
const MAX_RESTART_DELAY_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 10;

/**
 * Resolve service paths:
 * - Production (app.isPackaged): <resourcesPath>/services/<name>/...
 * - Development: sibling repo at ../../<name>/ (relative to electron/ dir)
 *   or override via env KSWARM_SERVER_PATH / BROKER_SERVER_PATH
 */
function resolveServicePath(name: 'kswarm' | 'intent-broker', entryRelative: string): string | null {
  const envKey = name === 'kswarm' ? 'KSWARM_SERVER_PATH' : 'BROKER_SERVER_PATH';
  const envPath = process.env[envKey];
  if (envPath && existsSync(envPath)) return envPath;

  if (app.isPackaged) {
    // Production: bundled in resources/services/
    const bundled = join(process.resourcesPath, 'services', name, entryRelative);
    if (existsSync(bundled)) return bundled;
  } else {
    // Development: sibling repo (projects/kswarm, projects/intent-broker)
    const devPaths = [
      join(__dirname, '..', '..', '..', name, entryRelative),
      join(process.env.HOME || '', 'projects', name, entryRelative),
    ];
    for (const p of devPaths) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Thrown when KSwarm service is not available (failed to start or crashed). */
export class KSwarmUnavailableError extends Error {
  constructor(reason: string) {
    super(`KSwarm service unavailable: ${reason}`);
    this.name = 'KSwarmUnavailableError';
  }
}

export interface KSwarmServiceStatus {
  running: boolean;
  port: number;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
}

export interface KSwarmService {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): KSwarmServiceStatus;
  onStatusChange(cb: (status: KSwarmServiceStatus) => void): () => void;
  /** Make an HTTP request to the KSwarm service. Auto-starts if not running. */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export function createKSwarmService(): KSwarmService {
  let child: ChildProcess | null = null;
  let brokerChild: ChildProcess | null = null;
  let running = false;
  let restartCount = 0;
  let lastError: string | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;
  let startingPromise: Promise<void> | null = null;
  const listeners = new Set<(status: KSwarmServiceStatus) => void>();

  function getStatus(): KSwarmServiceStatus {
    return {
      running,
      port: KSWARM_PORT,
      pid: child?.pid ?? null,
      restartCount,
      lastError,
    };
  }

  function notifyListeners() {
    const status = getStatus();
    for (const cb of listeners) {
      try { cb(status); } catch {}
    }
  }

  function onStatusChange(cb: (status: KSwarmServiceStatus) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  async function healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(HEALTH_URL);
      return res.ok;
    } catch {
      return false;
    }
  }

  function startHealthCheck() {
    stopHealthCheck();
    healthTimer = setInterval(async () => {
      if (!running || stopping) return;
      const ok = await healthCheck();
      if (!ok && running && !stopping) {
        console.log('[kswarm-service] Health check failed, attempting restart...');
        running = false;
        notifyListeners();
        scheduleRestart();
      }
    }, HEALTH_INTERVAL_MS);
  }

  function stopHealthCheck() {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  }

  function scheduleRestart() {
    if (stopping || restartCount >= MAX_RESTART_ATTEMPTS) {
      if (restartCount >= MAX_RESTART_ATTEMPTS) {
        lastError = `Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached`;
        notifyListeners();
      }
      return;
    }
    const delay = Math.min(RESTART_BASE_DELAY_MS * Math.pow(2, restartCount), MAX_RESTART_DELAY_MS);
    console.log(`[kswarm-service] Scheduling restart in ${delay}ms (attempt ${restartCount + 1})`);
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (!stopping) {
        restartCount++;
        await spawnServer();
      }
    }, delay);
  }

  async function ensureBroker(): Promise<boolean> {
    // Check if broker is already running
    try {
      const res = await fetch(`http://127.0.0.1:${BROKER_PORT}/health`);
      if (res.ok) return true;
    } catch {}

    const brokerEntry = resolveServicePath('intent-broker', 'src/index.js');
    if (!brokerEntry) {
      console.log('[kswarm-service] Broker entry not found, assuming external broker');
      return true; // May be running externally
    }

    console.log(`[kswarm-service] Spawning broker: ${brokerEntry}`);
    brokerChild = spawn('node', [brokerEntry], {
      env: { ...process.env, PORT: String(BROKER_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    brokerChild.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[broker] ${msg}`);
    });
    brokerChild.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) console.error(`[broker:err] ${msg}`);
    });
    brokerChild.on('exit', (code) => {
      console.log(`[kswarm-service] Broker exited: code=${code}`);
      brokerChild = null;
    });

    // Wait briefly for broker to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const res = await fetch(`http://127.0.0.1:${BROKER_PORT}/health`);
        if (res.ok) return true;
      } catch {}
    }
    return false;
  }

  async function spawnServer(): Promise<void> {
    const serverPath = resolveServicePath('kswarm', 'src/server/index.js');
    if (!serverPath) {
      lastError = 'kswarm server entry not found';
      console.error('[kswarm-service]', lastError);
      notifyListeners();
      return;
    }

    // Ensure broker is up first
    await ensureBroker();

    console.log(`[kswarm-service] Spawning kswarm server: ${serverPath}`);
    child = spawn('node', [serverPath], {
      env: {
        ...process.env,
        KSWARM_PORT: String(KSWARM_PORT),
        BROKER_URL: `http://127.0.0.1:${BROKER_PORT}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[kswarm] ${msg}`);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[kswarm:err] ${msg}`);
    });

    child.on('exit', (code, signal) => {
      console.log(`[kswarm-service] Process exited: code=${code} signal=${signal}`);
      child = null;
      running = false;
      if (!stopping) {
        lastError = `Process exited with code ${code}`;
        notifyListeners();
        scheduleRestart();
      }
    });

    child.on('error', (err) => {
      console.error('[kswarm-service] Spawn error:', err.message);
      lastError = err.message;
      child = null;
      running = false;
      notifyListeners();
      if (!stopping) scheduleRestart();
    });

    // Wait for health check to confirm server is ready
    const ready = await waitForReady(8_000);
    if (ready) {
      running = true;
      lastError = null;
      restartCount = 0; // Reset on successful start
      console.log(`[kswarm-service] Server ready on port ${KSWARM_PORT}`);
      startHealthCheck();
      notifyListeners();
    } else if (!stopping) {
      console.log('[kswarm-service] Server did not become ready in time');
      lastError = 'Server startup timeout';
      notifyListeners();
    }
  }

  async function waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopping) return false;
      const ok = await healthCheck();
      if (ok) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async function ensureReady(): Promise<void> {
    if (running) return;
    if (startingPromise) { await startingPromise; return; }
    startingPromise = start().finally(() => { startingPromise = null; });
    await startingPromise;
  }

  const REQUEST_TIMEOUT_MS = 30_000;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    await ensureReady();

    if (!running) {
      throw new KSwarmUnavailableError(lastError || 'KSwarm service failed to start');
    }

    const url = `http://127.0.0.1:${KSWARM_PORT}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`KSwarm request timed out (${REQUEST_TIMEOUT_MS}ms): ${url}`);
      }
      throw new KSwarmUnavailableError((err as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function start(): Promise<void> {
    if (running || child) return;
    stopping = false;
    restartCount = 0;
    lastError = null;
    await spawnServer();
  }

  async function stop(): Promise<void> {
    stopping = true;
    stopHealthCheck();
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (child) {
      const exitPromise = new Promise<void>(resolve => {
        child!.on('exit', () => resolve());
        setTimeout(resolve, 5_000); // Force timeout
      });
      child.kill('SIGTERM');
      await exitPromise;
      if (child) {
        child.kill('SIGKILL');
        child = null;
      }
    }
    if (brokerChild) {
      brokerChild.kill('SIGTERM');
      brokerChild = null;
    }
    running = false;
    notifyListeners();
  }

  async function restart(): Promise<void> {
    await stop();
    stopping = false;
    restartCount = 0;
    await spawnServer();
  }

  return { start, stop, restart, getStatus, onStatusChange, request };
}
