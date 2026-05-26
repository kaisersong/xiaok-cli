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
import {
  buildSeedAgentReconciliationPlan,
  createXiaokPoSeed,
  createXiaokWorkerSeed,
} from '../shared/kswarm-seed-contract.js';
import {
  getDevelopmentBrokerLaunchSpec,
  getDevelopmentServiceCandidates,
  type ServiceLaunchSpec,
} from './kswarm-service-paths.js';
import { loadConfig } from '../../src/utils/config.js';
import { buildManagedXiaokAgentPayload, diffManagedXiaokAgentPatch } from './managed-xiaok-agent.js';

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
  }

  for (const p of getDevelopmentServiceCandidates(__dirname, name, entryRelative)) {
    if (existsSync(p)) return p;
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

function resolveBrokerLaunchSpec(): ServiceLaunchSpec | null {
  const envPath = process.env.BROKER_SERVER_PATH;
  if (envPath && existsSync(envPath)) {
    return {
      cwd: dirname(dirname(envPath)),
      entryPath: envPath,
      nodeArgs: ['--experimental-sqlite', envPath],
    };
  }

  if (app.isPackaged) {
    const entryPath = join(process.resourcesPath, 'services', 'intent-broker', 'src', 'cli.js');
    if (existsSync(entryPath)) {
      return {
        cwd: join(process.resourcesPath, 'services', 'intent-broker'),
        entryPath,
        nodeArgs: ['--experimental-sqlite', entryPath],
      };
    }
  }

  return getDevelopmentBrokerLaunchSpec(__dirname);
}

export interface KSwarmServiceStatus {
  running: boolean;
  port: number;
  pid: number | null;
  restartCount: number;
  lastError: string | null;
}

export type DesktopRelatedServiceId = 'kswarm' | 'intent-broker' | 'runtime-bridge';

export interface DesktopRelatedServiceStatus {
  id: DesktopRelatedServiceId;
  label: string;
  running: boolean;
  reachable: boolean;
  port: number;
  pid: number | null;
  restartCount?: number;
  lastError: string | null;
  detail?: string;
}

export interface DesktopServiceStatusSnapshot {
  checkedAt: number;
  services: DesktopRelatedServiceStatus[];
}

export function buildBackgroundNodeSpawnOptions(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
}): {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio: ['ignore', 'pipe', 'pipe'];
  windowsHide?: boolean;
} {
  const platform = options.platform ?? process.platform;
  return {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(platform === 'win32' ? { windowsHide: true } : {}),
  };
}

export function resolveBackgroundNodeRuntime(options: {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  electronVersion?: string;
} = {}): {
  command: string;
  env: NodeJS.ProcessEnv;
} {
  const env = { ...(options.env ?? process.env) };
  const explicitNode = env.XIAOK_NODE_CMD?.trim();
  if (explicitNode) {
    return { command: explicitNode, env };
  }

  const command = options.execPath ?? process.execPath;
  const electronVersion = options.electronVersion ?? process.versions.electron;
  if (electronVersion) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  return { command, env };
}

export function shouldAdoptExistingKSwarmService(input: { hasOwnedChild: boolean; healthOk: boolean; brokerReady?: boolean }): boolean {
  return input.healthOk && input.brokerReady !== false && !input.hasOwnedChild;
}

export interface KSwarmService {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): KSwarmServiceStatus;
  getServiceStatus(): Promise<DesktopServiceStatusSnapshot>;
  restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void>;
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

  async function fetchHealthJson(url: string): Promise<{ ok: boolean; body: Record<string, unknown> | null; error: string | null }> {
    try {
      const res = await fetch(url);
      let body: Record<string, unknown> | null = null;
      try {
        const parsed = await res.json();
        body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      } catch {
        body = null;
      }
      return {
        ok: res.ok,
        body,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        body: null,
        error: error instanceof Error ? error.message : 'health check failed',
      };
    }
  }

  async function brokerHealthCheck(): Promise<boolean> {
    const result = await fetchHealthJson(`http://127.0.0.1:${BROKER_PORT}/health`);
    return result.ok;
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

  async function reconcileSeedAgents(): Promise<void> {
    try {
      const res = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents`);
      if (!res.ok) return;
      const payload = await res.json() as { agents?: Array<Record<string, unknown>> };
      const agents = Array.isArray(payload.agents) ? payload.agents : [];
      const plan = buildSeedAgentReconciliationPlan(agents as never);
      const config = await loadConfig();
      const desiredSeeds = [
        buildManagedXiaokAgentPayload(createXiaokPoSeed(), config),
        buildManagedXiaokAgentPayload(createXiaokWorkerSeed(), config),
      ];
      let liveness: Record<string, { online: boolean }> = {};
      try {
        const livenessRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents/liveness`);
        if (livenessRes.ok) {
          const livenessPayload = await livenessRes.json() as { liveness?: Record<string, { online: boolean }> };
          liveness = livenessPayload.liveness ?? {};
        }
      } catch {
        liveness = {};
      }

      for (const desired of desiredSeeds) {
        if (!desired.id) {
          continue;
        }
        const existing = agents.find((agent) => agent.id === desired.id);
        if (!existing) {
          const createRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(desired),
          });
          if (!createRes.ok && createRes.status !== 409) {
            console.warn(`[kswarm-service] Failed to create seed agent ${desired.id}: ${createRes.status}`);
          }
          continue;
        }

        const detailRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents/${desired.id}`);
        const detailPayload = detailRes.ok ? await detailRes.json() as { agent?: Record<string, unknown> } : null;
        const currentAgent = detailPayload?.agent ?? existing;
        const patch = diffManagedXiaokAgentPatch(currentAgent, desired);
        if (patch) {
          const updateRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents/${desired.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          if (!updateRes.ok) {
            console.warn(`[kswarm-service] Failed to update seed agent ${desired.id}: ${updateRes.status}`);
          }
        }

        const status = String(existing.status ?? 'offline');
        const isGhostOnline = status !== 'offline' && liveness[desired.id]?.online === false;
        if ((patch && status !== 'offline') || isGhostOnline) {
          const restartRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents/${desired.id}/restart`, {
            method: 'POST',
          });
          if (!restartRes.ok) {
            console.warn(`[kswarm-service] Failed to restart seed agent ${desired.id}: ${restartRes.status}`);
          }
        }
      }

      for (const agentId of plan.archive) {
        const archiveRes = await fetch(`http://127.0.0.1:${KSWARM_PORT}/agents/${agentId}`, {
          method: 'DELETE',
        });
        if (!archiveRes.ok && archiveRes.status !== 404) {
          console.warn(`[kswarm-service] Failed to archive legacy seed ${agentId}: ${archiveRes.status}`);
        }
      }
    } catch (error) {
      console.warn('[kswarm-service] Seed agent reconciliation failed:', (error as Error).message);
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
    if (await brokerHealthCheck()) return true;

    const brokerLaunch = resolveBrokerLaunchSpec();
    if (!brokerLaunch) {
      console.log('[kswarm-service] Broker entry not found, assuming external broker');
      return true; // May be running externally
    }

    const nodeRuntime = resolveBackgroundNodeRuntime({
      env: { ...process.env, PORT: String(BROKER_PORT) },
    });
    console.log(`[kswarm-service] Spawning broker: ${brokerLaunch.entryPath}`);
    brokerChild = spawn(nodeRuntime.command, brokerLaunch.nodeArgs, buildBackgroundNodeSpawnOptions({
      cwd: brokerLaunch.cwd,
      env: nodeRuntime.env,
    }));
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
    const existingHealthy = await healthCheck();
    let brokerReady = await brokerHealthCheck();
    if (shouldAdoptExistingKSwarmService({ hasOwnedChild: Boolean(child), healthOk: existingHealthy, brokerReady })) {
      console.log(`[kswarm-service] Adopting existing healthy kswarm service on port ${KSWARM_PORT}`);
      await reconcileSeedAgents();
      running = true;
      lastError = null;
      restartCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

    if (existingHealthy && !child) {
      brokerReady = await ensureBroker();
      console.log(`[kswarm-service] Adopting existing kswarm service on port ${KSWARM_PORT}${brokerReady ? '' : ' (broker degraded)'}`);
      await reconcileSeedAgents();
      running = true;
      lastError = brokerReady ? null : 'intent-broker health check failed';
      restartCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

    const serverPath = resolveServicePath('kswarm', 'src/server/index.js');
    if (!serverPath) {
      lastError = 'kswarm server entry not found';
      console.error('[kswarm-service]', lastError);
      notifyListeners();
      return;
    }

    // Ensure broker is up first
    brokerReady = await ensureBroker();
    if (!brokerReady) {
      console.warn('[kswarm-service] Broker not ready after bootstrap attempt; starting kswarm in degraded mode');
    }

    const nodeRuntime = resolveBackgroundNodeRuntime({
      env: {
        ...process.env,
        KSWARM_PORT: String(KSWARM_PORT),
        BROKER_URL: `http://127.0.0.1:${BROKER_PORT}`,
      },
    });
    console.log(`[kswarm-service] Spawning kswarm server: ${serverPath}`);
    child = spawn(nodeRuntime.command, [serverPath], buildBackgroundNodeSpawnOptions({
      env: nodeRuntime.env,
    }));

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
      await reconcileSeedAgents();
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
    await stopOwnedBroker();
    running = false;
    notifyListeners();
  }

  async function restart(): Promise<void> {
    await stop();
    stopping = false;
    restartCount = 0;
    await spawnServer();
  }

  async function stopOwnedBroker(): Promise<void> {
    if (!brokerChild) return;
    const ownedBroker = brokerChild;
    const exitPromise = new Promise<void>(resolve => {
      ownedBroker.on('exit', () => resolve());
      setTimeout(resolve, 3_000);
    });
    ownedBroker.kill('SIGTERM');
    await exitPromise;
    if (brokerChild === ownedBroker) {
      brokerChild.kill('SIGKILL');
      brokerChild = null;
    }
  }

  async function getServiceStatus(): Promise<DesktopServiceStatusSnapshot> {
    const [kswarmHealth, brokerHealth] = await Promise.all([
      fetchHealthJson(HEALTH_URL),
      fetchHealthJson(`http://127.0.0.1:${BROKER_PORT}/health`),
    ]);
    const brokerConnected = kswarmHealth.body?.brokerConnected;
    const kswarmDetail = kswarmHealth.ok
      ? brokerConnected === false
        ? 'broker disconnected'
        : brokerConnected === true
          ? 'broker connected'
          : 'health ok'
      : 'health check failed';
    return {
      checkedAt: Date.now(),
      services: [
        {
          id: 'kswarm',
          label: 'KSwarm',
          running: running || kswarmHealth.ok,
          reachable: kswarmHealth.ok,
          port: KSWARM_PORT,
          pid: child?.pid ?? null,
          restartCount,
          lastError: kswarmHealth.ok ? lastError : (lastError || kswarmHealth.error),
          detail: kswarmDetail,
        },
        {
          id: 'intent-broker',
          label: 'Intent Broker',
          running: Boolean(brokerChild) || brokerHealth.ok,
          reachable: brokerHealth.ok,
          port: BROKER_PORT,
          pid: brokerChild?.pid ?? null,
          restartCount: 0,
          lastError: brokerHealth.ok ? null : brokerHealth.error,
          detail: brokerHealth.ok ? 'health ok' : 'health check failed',
        },
      ],
    };
  }

  async function restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void> {
    if (serviceId === 'kswarm') {
      await restart();
      return;
    }
    await stopOwnedBroker();
    const ok = await ensureBroker();
    if (!ok) {
      throw new Error('intent_broker_restart_failed');
    }
    notifyListeners();
  }

  return { start, stop, restart, getStatus, getServiceStatus, restartRelatedService, onStatusChange, request };
}
