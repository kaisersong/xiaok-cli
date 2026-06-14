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
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
import type { KSwarmHealthDiagnosticInput } from './kswarm-service-diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KSWARM_PORT = 4400;
const BROKER_PORT = 4318;
export const KSWARM_REQUEST_BASE_URLS = uniqueServiceUrls([
  `http://127.0.0.1:${KSWARM_PORT}`,
  `http://localhost:${KSWARM_PORT}`,
]);
const KSWARM_HEALTH_URLS = uniqueServiceUrls(KSWARM_REQUEST_BASE_URLS.map(url => `${url}/health`));
const BROKER_HEALTH_URLS = uniqueServiceUrls([
  `http://127.0.0.1:${BROKER_PORT}/health`,
  `http://localhost:${BROKER_PORT}/health`,
]);
const HEALTH_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const HEALTH_FAILURE_RESTART_THRESHOLD = 3;
const RESTART_BASE_DELAY_MS = 2_000;
const MAX_RESTART_DELAY_MS = 30_000;
const MAX_RESTART_ATTEMPTS = 10;
const REQUEST_TIMEOUT_MS = 30_000;
const DYNAMIC_WORKFLOW_FEATURE = 'dynamic_workflows';
const WORKFLOW_PATTERN_SCHEMA_VERSION = 'kswarm_workflow_patterns_v1';
const LEGACY_KSWARM_LOG_ROOT = join(homedir(), '.kswarm', 'logs');

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

export function uniqueServiceUrls(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

export function nextHealthFailureCount(current: number, ok: boolean): number {
  return ok ? 0 : current + 1;
}

export function shouldRestartAfterHealthFailures(
  failureCount: number,
  threshold = HEALTH_FAILURE_RESTART_THRESHOLD,
): boolean {
  return failureCount >= threshold;
}

export async function requestWithFallbackBaseUrls(options: {
  baseUrls: string[];
  path: string;
  init?: RequestInit;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
  const urls = uniqueServiceUrls(options.baseUrls).map(baseUrl => `${baseUrl}${path}`);
  let lastError: Error | null = null;

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(url, { ...options.init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`KSwarm request timed out (${timeoutMs}ms): ${url}`);
      } else {
        lastError = error instanceof Error ? error : new Error('request failed');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new KSwarmUnavailableError(lastError?.message ?? 'all service endpoints failed');
}

export function resolveIntentBrokerRuntimeRoot(userDataPath: string): string {
  return join(userDataPath, 'services', 'intent-broker');
}

export function resolveKSwarmServiceLogRoot(userDataPath?: string): string {
  if (userDataPath) return join(userDataPath, 'logs');
  try {
    return join(app.getPath('userData'), 'logs');
  } catch {
    return LEGACY_KSWARM_LOG_ROOT;
  }
}

export function buildIntentBrokerServiceEnv(options: {
  baseEnv?: NodeJS.ProcessEnv;
  cwd: string;
  port: number;
  repoRoot?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? process.env), PORT: String(options.port) };
  const repoRoot = options.repoRoot || options.cwd;

  if (repoRoot !== options.cwd) {
    env.INTENT_BROKER_REPO_ROOT ||= repoRoot;
    env.INTENT_BROKER_CONFIG ||= join(repoRoot, 'intent-broker.config.json');
    env.INTENT_BROKER_LOCAL_CONFIG ||= join(options.cwd, 'intent-broker.local.json');
    env.INTENT_BROKER_DB ||= join(options.cwd, '.tmp', 'intent-broker.db');
    env.INTENT_BROKER_HEARTBEAT_PATH ||= join(options.cwd, '.tmp', 'broker.heartbeat.json');
  }

  return env;
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
    const repoRoot = join(process.resourcesPath, 'services', 'intent-broker');
    const entryPath = join(repoRoot, 'src', 'cli.js');
    if (existsSync(entryPath)) {
      return {
        cwd: resolveIntentBrokerRuntimeRoot(app.getPath('userData')),
        repoRoot,
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

interface HealthJsonResult {
  ok: boolean;
  body: Record<string, unknown> | null;
  error: string | null;
  status?: number;
}

export function buildKSwarmHealthDiagnosticInput(options: {
  expectedEntryPath: string | null;
  expectedSourceHash?: string | null;
  health: HealthJsonResult;
  broker: HealthJsonResult;
  status: KSwarmServiceStatus;
  lastExit?: { code?: number | null; signal?: string | null; stderr?: string | null } | null;
}): KSwarmHealthDiagnosticInput {
  const listening = options.health.ok || typeof options.health.status === 'number';
  return {
    expectedEntryPath: options.expectedEntryPath,
    expectedSourceHash: options.expectedSourceHash ?? null,
    spawnEntryExists: Boolean(options.expectedEntryPath),
    managerRunning: options.status.running,
    port: {
      listening,
      pid: options.status.pid,
      command: options.status.pid ? 'desktop-owned kswarm service' : null,
    },
    health: {
      ok: options.health.ok,
      status: options.health.status,
      body: options.health.body,
      error: options.health.error,
    },
    broker: {
      ok: options.broker.ok,
      error: options.broker.error,
    },
    lastExit: options.lastExit ?? null,
  };
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

export function hasDynamicWorkflowSupport(body: Record<string, unknown> | null): boolean {
  const features = body?.features;
  return Array.isArray(features)
    && features.includes(DYNAMIC_WORKFLOW_FEATURE)
    && hasWorkflowPatternCapabilities(body);
}

export function hasWorkflowPatternCapabilities(body: Record<string, unknown> | null): boolean {
  const capabilities = body?.workflowCapabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
  const schemaVersion = (capabilities as Record<string, unknown>).schemaVersion;
  const compiledContract = (capabilities as Record<string, unknown>).compiledContract;
  const patternPublicView = (capabilities as Record<string, unknown>).patternPublicView;
  return schemaVersion === WORKFLOW_PATTERN_SCHEMA_VERSION
    && compiledContract === true
    && patternPublicView === true;
}

export function getKSwarmHealthServiceEntryPath(body: Record<string, unknown> | null): string | null {
  const service = body?.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
  const entryPath = (service as Record<string, unknown>).entryPath;
  return typeof entryPath === 'string' && entryPath.length > 0 ? entryPath : null;
}

export function getKSwarmHealthServiceSourceHash(body: Record<string, unknown> | null): string | null {
  const service = body?.service;
  if (!service || typeof service !== 'object' || Array.isArray(service)) return null;
  const sourceHash = (service as Record<string, unknown>).sourceHash;
  return typeof sourceHash === 'string' && sourceHash.length > 0 ? sourceHash : null;
}

export type KSwarmServiceIdentityWarning = 'source_hash_mismatch' | 'source_hash_missing';
export type KSwarmServiceIdentityReason = 'service_identity_missing' | 'entry_path_mismatch';

export interface KSwarmServiceIdentityCheck {
  compatible: boolean;
  reason: KSwarmServiceIdentityReason | null;
  warning: KSwarmServiceIdentityWarning | null;
  actualEntryPath: string | null;
  expectedEntryPath: string | null;
  actualSourceHash: string | null;
  expectedSourceHash: string | null;
}

export function computeKSwarmServiceSourceHash(entryPath: string | null): string | null {
  if (!entryPath) return null;
  const sourceRoot = dirname(dirname(resolve(entryPath)));
  try {
    const hash = createHash('sha256');
    const visit = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!entry.isFile() || !/\.(js|json)$/.test(entry.name)) continue;
        hash.update(relative(sourceRoot, path));
        hash.update('\0');
        hash.update(readFileSync(path));
        hash.update('\0');
      }
    };
    visit(sourceRoot);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function doesKSwarmHealthMatchExpectedService(
  body: Record<string, unknown> | null,
  expectedEntryPath: string | null,
  expectedSourceHash: string | null = null,
): boolean {
  return checkKSwarmHealthServiceIdentity(body, expectedEntryPath, expectedSourceHash).compatible;
}

export function checkKSwarmHealthServiceIdentity(
  body: Record<string, unknown> | null,
  expectedEntryPath: string | null,
  expectedSourceHash: string | null = null,
): KSwarmServiceIdentityCheck {
  const actualEntryPath = getKSwarmHealthServiceEntryPath(body);
  const actualSourceHash = getKSwarmHealthServiceSourceHash(body);
  const base = {
    actualEntryPath,
    expectedEntryPath,
    actualSourceHash,
    expectedSourceHash,
  };
  if (!expectedEntryPath) {
    return { ...base, compatible: true, reason: null, warning: null };
  }
  if (!actualEntryPath) {
    return { ...base, compatible: false, reason: 'service_identity_missing', warning: null };
  }
  if (resolve(actualEntryPath) !== resolve(expectedEntryPath)) {
    return { ...base, compatible: false, reason: 'entry_path_mismatch', warning: null };
  }
  if (expectedSourceHash && !actualSourceHash) {
    return { ...base, compatible: true, reason: null, warning: 'source_hash_missing' };
  }
  if (expectedSourceHash && actualSourceHash !== expectedSourceHash) {
    return { ...base, compatible: true, reason: null, warning: 'source_hash_mismatch' };
  }
  return { ...base, compatible: true, reason: null, warning: null };
}

export function appendKSwarmServiceLogLine(options: {
  logRoot?: string;
  serviceName: 'server' | 'broker';
  stream: 'stdout' | 'stderr' | 'lifecycle';
  message: string;
  now?: () => Date;
}): void {
  const lines = options.message
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  const logRoot = options.logRoot ?? resolveKSwarmServiceLogRoot();
  try {
    mkdirSync(logRoot, { recursive: true });
    const ts = (options.now?.() ?? new Date()).toISOString();
    const payload = lines.map(line => `${ts} [${options.stream}] ${line}`).join('\n');
    appendFileSync(join(logRoot, `${options.serviceName}.log`), `${payload}\n`);
  } catch {
    // Logging must never prevent service startup.
  }
}

function logKSwarmServiceLine(
  serviceName: 'server' | 'broker',
  stream: 'stdout' | 'stderr' | 'lifecycle',
  message: string,
): void {
  appendKSwarmServiceLogLine({ serviceName, stream, message });
}

function formatServiceIdentityWarning(check: KSwarmServiceIdentityCheck): string {
  return [
    `source identity warning: ${check.warning}`,
    `expectedEntryPath=${check.expectedEntryPath ?? 'unknown'}`,
    `actualEntryPath=${check.actualEntryPath ?? 'unknown'}`,
    `expectedSourceHash=${check.expectedSourceHash ?? 'unknown'}`,
    `actualSourceHash=${check.actualSourceHash ?? 'unknown'}`,
  ].join(' ');
}

function formatServiceIdentityBlock(check: KSwarmServiceIdentityCheck): string {
  return [
    `existing kswarm service on port ${KSWARM_PORT} is not the bundled service`,
    `reason=${check.reason ?? 'unknown'}`,
    `expectedEntryPath=${check.expectedEntryPath ?? 'unknown'}`,
    `actualEntryPath=${check.actualEntryPath ?? 'unknown'}`,
    `expectedSourceHash=${check.expectedSourceHash ?? 'unknown'}`,
    `actualSourceHash=${check.actualSourceHash ?? 'unknown'}`,
  ].join('; ');
}

export function shouldAdoptExistingKSwarmService(input: {
  hasOwnedChild: boolean;
  healthOk: boolean;
  brokerReady?: boolean;
  dynamicWorkflowReady?: boolean;
  serviceIdentityMatches?: boolean;
}): boolean {
  return input.healthOk
    && input.brokerReady !== false
    && input.dynamicWorkflowReady !== false
    && input.serviceIdentityMatches !== false
    && !input.hasOwnedChild;
}

export interface KSwarmService {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): KSwarmServiceStatus;
  getServiceStatus(): Promise<DesktopServiceStatusSnapshot>;
  getHealthDiagnosticInput(): Promise<KSwarmHealthDiagnosticInput>;
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
  let healthFailureCount = 0;
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
    const result = await fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS);
    return result.ok;
  }

  async function fetchHealthJson(url: string): Promise<HealthJsonResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      let body: Record<string, unknown> | null = null;
      let parseError: string | null = null;
      try {
        const parsed = await res.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        } else {
          parseError = 'health response JSON is not an object';
        }
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'health response is not valid JSON';
      }
      if (res.ok && parseError) {
        return {
          ok: false,
          status: res.status,
          body: null,
          error: `invalid health JSON: ${parseError}`,
        };
      }
      return {
        ok: res.ok,
        status: res.status,
        body,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        body: null,
        error: error instanceof Error && error.name === 'AbortError'
          ? `health check timed out (${HEALTH_CHECK_TIMEOUT_MS}ms): ${url}`
          : error instanceof Error ? error.message : 'health check failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchKSwarm(path: string, init?: RequestInit): Promise<Response> {
    return requestWithFallbackBaseUrls({
      baseUrls: KSWARM_REQUEST_BASE_URLS,
      path,
      init,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }

  async function fetchHealthJsonFromUrls(urls: string[]): Promise<HealthJsonResult> {
    let lastResult: HealthJsonResult | null = null;
    for (const url of uniqueServiceUrls(urls)) {
      const result = await fetchHealthJson(url);
      if (result.ok) {
        return result;
      }
      lastResult = result;
    }
    return lastResult ?? {
      ok: false,
      body: null,
      error: 'no health endpoints configured',
    };
  }

  async function brokerHealthCheck(): Promise<boolean> {
    const result = await fetchHealthJsonFromUrls(BROKER_HEALTH_URLS);
    return result.ok;
  }

  function startHealthCheck() {
    stopHealthCheck();
    healthTimer = setInterval(async () => {
      if (!running || stopping) return;
      const ok = await healthCheck();
      healthFailureCount = nextHealthFailureCount(healthFailureCount, ok);
      if (!ok && !shouldRestartAfterHealthFailures(healthFailureCount)) {
        console.warn(`[kswarm-service] Health check failed (${healthFailureCount}/${HEALTH_FAILURE_RESTART_THRESHOLD}), will retry before restart`);
        return;
      }
      if (!ok && running && !stopping) {
        console.log('[kswarm-service] Health check failed repeatedly, attempting restart...');
        running = false;
        healthFailureCount = 0;
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
      const res = await fetchKSwarm('/agents');
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
        const livenessRes = await fetchKSwarm('/agents/liveness');
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
          const createRes = await fetchKSwarm('/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(desired),
          });
          if (!createRes.ok && createRes.status !== 409) {
            console.warn(`[kswarm-service] Failed to create seed agent ${desired.id}: ${createRes.status}`);
          }
          continue;
        }

        const detailRes = await fetchKSwarm(`/agents/${desired.id}`);
        const detailPayload = detailRes.ok ? await detailRes.json() as { agent?: Record<string, unknown> } : null;
        const currentAgent = detailPayload?.agent ?? existing;
        const patch = diffManagedXiaokAgentPatch(currentAgent, desired);
        if (patch) {
          const updateRes = await fetchKSwarm(`/agents/${desired.id}`, {
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
          const restartRes = await fetchKSwarm(`/agents/${desired.id}/restart`, {
            method: 'POST',
          });
          if (!restartRes.ok) {
            console.warn(`[kswarm-service] Failed to restart seed agent ${desired.id}: ${restartRes.status}`);
          }
        }
      }

      for (const agentId of plan.archive) {
        const archiveRes = await fetchKSwarm(`/agents/${agentId}`, {
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

    const brokerEnv = buildIntentBrokerServiceEnv({
      baseEnv: process.env,
      cwd: brokerLaunch.cwd,
      port: BROKER_PORT,
      repoRoot: brokerLaunch.repoRoot,
    });
    const nodeRuntime = resolveBackgroundNodeRuntime({ env: brokerEnv });
    console.log(`[kswarm-service] Spawning broker: ${brokerLaunch.entryPath}`);
    logKSwarmServiceLine(
      'broker',
      'lifecycle',
      `spawn command=${nodeRuntime.command} entryPath=${brokerLaunch.entryPath} cwd=${brokerLaunch.cwd}`,
    );
    mkdirSync(brokerLaunch.cwd, { recursive: true });
    brokerChild = spawn(nodeRuntime.command, brokerLaunch.nodeArgs, buildBackgroundNodeSpawnOptions({
      cwd: brokerLaunch.cwd,
      env: nodeRuntime.env,
    }));
    brokerChild.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        console.log(`[broker] ${msg}`);
        logKSwarmServiceLine('broker', 'stdout', msg);
      }
    });
    brokerChild.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        console.error(`[broker:err] ${msg}`);
        logKSwarmServiceLine('broker', 'stderr', msg);
      }
    });
    brokerChild.on('exit', (code) => {
      const message = `Broker exited: code=${code}`;
      console.log(`[kswarm-service] ${message}`);
      logKSwarmServiceLine('broker', 'lifecycle', message);
      brokerChild = null;
    });

    // Wait briefly for broker to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (await brokerHealthCheck()) return true;
    }
    return false;
  }

  async function spawnServer(): Promise<void> {
    const existingHealth = await fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS);
    const existingHealthy = existingHealth.ok;
    const dynamicWorkflowReady = hasDynamicWorkflowSupport(existingHealth.body);
    const serverPath = resolveServicePath('kswarm', 'src/server/index.js');
    const expectedSourceHash = computeKSwarmServiceSourceHash(serverPath);
    const serviceIdentity = checkKSwarmHealthServiceIdentity(existingHealth.body, serverPath, expectedSourceHash);
    const serviceIdentityMatches = serviceIdentity.compatible;
    let brokerReady = await brokerHealthCheck();
    if (existingHealthy && serviceIdentity.warning) {
      const warning = formatServiceIdentityWarning(serviceIdentity);
      console.warn(`[kswarm-service] ${warning}`);
      logKSwarmServiceLine('server', 'lifecycle', warning);
    }
    if (existingHealthy && serverPath && !serviceIdentityMatches && !child) {
      lastError = formatServiceIdentityBlock(serviceIdentity);
      console.warn(`[kswarm-service] ${lastError}`);
      logKSwarmServiceLine('server', 'lifecycle', lastError);
      running = false;
      notifyListeners();
      return;
    }
    if (shouldAdoptExistingKSwarmService({
      hasOwnedChild: Boolean(child),
      healthOk: existingHealthy,
      brokerReady,
      dynamicWorkflowReady,
      serviceIdentityMatches,
    })) {
      console.log(`[kswarm-service] Adopting existing healthy kswarm service on port ${KSWARM_PORT}`);
      await reconcileSeedAgents();
      running = true;
      lastError = null;
      restartCount = 0;
      healthFailureCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

    if (existingHealthy && !dynamicWorkflowReady && !child) {
      lastError = `existing kswarm service on port ${KSWARM_PORT} does not support dynamic workflows`;
      console.warn(`[kswarm-service] ${lastError}`);
      running = false;
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
      healthFailureCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

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
        ...(await (async () => {
          try {
            const cfg = await loadConfig();
            const raw = cfg.kswarm?.maxConcurrentTasks;
            if (raw != null) {
              return { KSWARM_MAX_WORKER_INSTANCES: String(Math.max(1, Math.min(10, raw))) };
            }
          } catch {}
          return {};
        })()),
      },
    });
    console.log(`[kswarm-service] Spawning kswarm server: ${serverPath}`);
    logKSwarmServiceLine(
      'server',
      'lifecycle',
      `spawn command=${nodeRuntime.command} entryPath=${serverPath}`,
    );
    child = spawn(nodeRuntime.command, [serverPath], buildBackgroundNodeSpawnOptions({
      env: nodeRuntime.env,
    }));

    child.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[kswarm] ${msg}`);
        logKSwarmServiceLine('server', 'stdout', msg);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[kswarm:err] ${msg}`);
        logKSwarmServiceLine('server', 'stderr', msg);
      }
    });

    child.on('exit', (code, signal) => {
      const message = `Process exited: code=${code} signal=${signal}`;
      console.log(`[kswarm-service] ${message}`);
      logKSwarmServiceLine('server', 'lifecycle', message);
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
      logKSwarmServiceLine('server', 'lifecycle', `Spawn error: ${err.message}`);
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
      healthFailureCount = 0;
      console.log(`[kswarm-service] Server ready on port ${KSWARM_PORT}`);
      logKSwarmServiceLine('server', 'lifecycle', `Server ready on port ${KSWARM_PORT}`);
      startHealthCheck();
      notifyListeners();
    } else if (!stopping) {
      console.log('[kswarm-service] Server did not become ready in time');
      logKSwarmServiceLine('server', 'lifecycle', 'Server did not become ready in time');
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

  async function request(path: string, init?: RequestInit): Promise<Response> {
    await ensureReady();

    if (!running) {
      throw new KSwarmUnavailableError(lastError || 'KSwarm service failed to start');
    }

    return requestWithFallbackBaseUrls({
      baseUrls: KSWARM_REQUEST_BASE_URLS,
      path,
      init,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }

  async function start(): Promise<void> {
    if (running || child) return;
    stopping = false;
    restartCount = 0;
    healthFailureCount = 0;
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
    healthFailureCount = 0;
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
      fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS),
      fetchHealthJsonFromUrls(BROKER_HEALTH_URLS),
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

  async function getHealthDiagnosticInput(): Promise<KSwarmHealthDiagnosticInput> {
    const serverPath = resolveServicePath('kswarm', 'src/server/index.js');
    const expectedSourceHash = computeKSwarmServiceSourceHash(serverPath);
    const [kswarmHealth, brokerHealth] = await Promise.all([
      fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS),
      fetchHealthJsonFromUrls(BROKER_HEALTH_URLS),
    ]);
    return buildKSwarmHealthDiagnosticInput({
      expectedEntryPath: serverPath,
      expectedSourceHash,
      health: kswarmHealth,
      broker: brokerHealth,
      status: getStatus(),
    });
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

  return { start, stop, restart, getStatus, getServiceStatus, getHealthDiagnosticInput, restartRelatedService, onStatusChange, request };
}
