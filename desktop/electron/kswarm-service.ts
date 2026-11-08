import {hasOriginalProtectedBrokerService,createOriginalProtectedBrokerServiceChild,closeOriginalProtectedBrokerService,sealOriginalProtectedBrokerServiceStartup,assertOriginalProtectedBrokerServiceCurrent} from './broker-protected-service-binding.js';
import {createOriginalBrokerServiceEnvironment} from './broker-protected-startup-data.js';
import {hasOriginalProtectedKSwarmService,createOriginalProtectedKSwarmServiceChild,closeOriginalProtectedKSwarmService} from './kswarm-protected-service-binding.js';
import {getConfigDir} from '../../src/utils/config.js';
import {hasDesktopWriterRelay,callDesktopWriterRelay,drainDesktopWriterRelay,getDesktopDispatchBusinessTransport,getDesktopPreparationTransport,readDesktopPreparationAcceptedWorkBinding} from './activity-owner-writer-launcher.js';
import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createKSwarmOwnedControl,type KSwarmOwnedControlAdmission,type KSwarmOwnedControlContext,type KSwarmOwnedControlOperation} from './kswarm-owned-control.js';
import {createOwnedKSwarmBusiness,readOwnedKSwarmDshFacet,readOwnedKSwarmDshReply,type KSwarmDshReplyView,type KSwarmDshAdmission,type KSwarmDshFacet,prepareOwnedKSwarmBusinessHello,assertOwnedKSwarmBusinessHelloCurrent,readOwnedKSwarmPreparationFacet,readOwnedKSwarmPreparationWorkBinding,type KSwarmHostSettlementSource,type KSwarmPreparationSource,type KSwarmPreparationAdmission,type KSwarmPreparationFacet,type KSwarmBusinessAdmission,type KSwarmBusinessHello} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {assertRoomTurnCustody,createRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
import {compileWorkflowControllerRequest,type WorkflowControllerRequest} from './workflow-controller-io-contract.js';
export type {KSwarmOwnedControlContext} from './kswarm-owned-control.js';
import {parseProjectActivityPage,PROJECT_ACTIVITY_BODY_LIMIT,type ParsedProjectActivityPage} from '../../src/runtime/conversation-activity/project-delivery-data.js';
import {parseScopedProjectActivityPage,type ParsedScopedProjectActivityPage} from '../../src/runtime/conversation-activity/project-scoped-activity-data.js';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {captureIpcData} from './ipc-data-snapshot.js';
import {assertBeforeEffects} from '../../src/runtime/verification/before-effects.js';
import {createNativeWorkflowReadPort,closeNativeWorkflowReadPort,assertNativeWorkflowReadPort,readNativeWorkflowRun,type NativeWorkflowReadPort} from '../../src/runtime/task-host/workflow-restriction-checkpoint.js';
import { buildSidecarEnv } from './sidecar-env.js';
import { hasDynamicWorkflowSupport } from '../shared/kswarm-health-contract.js';
export { hasDynamicWorkflowSupport, hasWorkflowPatternCapabilities } from '../shared/kswarm-health-contract.js';
import type { ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';
import type { ConversationActivityOwnerClient } from '../../src/runtime/conversation-activity/owner-client.js';
/**
 * KSwarm Service Manager
 *
 * Manages the kswarm server as a child process from Electron's main process.
 * - Spawns `node <kswarm>/src/server/index.js` on app ready
 * - Health checks via GET http://localhost:4400/health
 * - Auto-restart on crash (with backoff)
 * - Graceful shutdown on app quit
 */

import { createLocalSourceWriterLifetime } from '../../src/runtime/verification/local-source-writer-lifetime.js';
import { createOwnedServiceChildCloseTracker } from './owned-service-child-close.js';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { assertRoomWorkspaceSidecarProtocol, assertRoomWorkspaceStartupProtocol } from './room-workspace-protocol.js';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {types as businessTypes} from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
// Namespace import keeps the original service readable by Node-only Store
// modules; Electron's app is consulted only inside actual runtime functions.
import * as Electron from 'electron';
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
import { buildManagedXiaokAgentPayload, buildManagedXiaokAgentSemanticPayload, diffManagedXiaokAgentPatch } from './managed-xiaok-agent.js';
import type { KSwarmHealthDiagnosticInput } from './kswarm-service-diagnostics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const businessPromise=Promise,businessThen=Promise.prototype.then,businessApply=Reflect.apply,businessDefine=Object.defineProperty,businessDescriptor=Object.getOwnPropertyDescriptor,businessPrototype=Object.getPrototypeOf;
const preparationFreeze=Object.freeze;
const workflowControllerJson=Response.prototype.json,workflowControllerStatus=Object.getOwnPropertyDescriptor(Response.prototype,'status')!.get!;
const roomProjectMappingFetch=fetch,roomProjectMappingEncode=encodeURIComponent,roomProjectMappingKeys=Reflect.ownKeys;
const roomProjectSignalAny=AbortSignal.any,roomProjectSignalThrow=AbortSignal.prototype.throwIfAborted;
const preparationProxy=businessTypes.isProxy,preparationAsync=businessTypes.isAsyncFunction,preparationOwn=Object.hasOwn,preparationWeakGet=WeakMap.prototype.get,preparationWeakSet=WeakMap.prototype.set;
const businessAsyncPrototype=businessPrototype(async()=>{}),businessSpecies=businessDescriptor(businessPromise,Symbol.species),businessAssign=Object.assign,businessCreate=Object.create,businessSetPrototype=Object.setPrototypeOf;
function businessDeferred<T>() {
 let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;
 const promise=new businessPromise<T>((yes,no)=>{resolve=yes;reject=no;});
 businessDefine(promise,'constructor',{__proto__:null,value:businessPromise} as PropertyDescriptor);return{promise,resolve,reject};
}
/** Only a result from this original fixed business client, never SDK raw.
 * Its own fixed constructor avoids inherited constructor lookup on observe. */
function originalBusinessPromise(raw:unknown):raw is Promise<unknown>{
 if(!raw||typeof raw!=='object'||businessTypes.isProxy(raw)||!businessTypes.isPromise(raw)||businessPrototype(raw)!==businessPromise.prototype||businessDescriptor(raw,'then'))return false;
 const ctor=businessDescriptor(raw,'constructor'),species=businessDescriptor(businessPromise,Symbol.species);
 return !!ctor&&Object.hasOwn(ctor,'value')&&ctor.value===businessPromise&&!!species&&!!businessSpecies&&!Object.hasOwn(species,'value')&&species.get===businessSpecies.get&&species.set===businessSpecies.set;
}

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
const MAX_PERSISTENCE_FAIL_STOP_RESTARTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const DYNAMIC_WORKFLOW_FEATURE = 'dynamic_workflows';
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

  if (Electron.app?.isPackaged) {
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

// KSwarm durable-state fail-stop exit codes (see kswarm src/core/sqlite-persistence.js).
export const KSWARM_EXIT_SAVE_FAILED = 75; // durable commit failed -> limited restart from last revision
export const KSWARM_EXIT_LOAD_UNRECOVERABLE = 78; // corrupt/unrecoverable load -> terminal degraded, no auto-restart

export type KSwarmExitDecision =
  | { action: 'restart' }
  | { action: 'limited_restart'; reason: 'persistence_commit_failed' }
  | { action: 'terminal_degraded'; reason: 'persistence_unrecoverable' };

/**
 * Classify a KSwarm server exit code into a restart decision.
 * - 78: unrecoverable durable-state load/corruption -> terminal degraded (do NOT
 *   auto-restart; the same corrupt state would loop forever).
 * - 75: durable commit failure fail-stop -> limited restart from the last durable
 *   revision (still bounded by MAX_RESTART_ATTEMPTS).
 * - anything else (crash, signal, code 0): normal restart handling.
 */
export function classifyKSwarmExit(code: number | null | undefined): KSwarmExitDecision {
  if (code === KSWARM_EXIT_LOAD_UNRECOVERABLE) {
    return { action: 'terminal_degraded', reason: 'persistence_unrecoverable' };
  }
  if (code === KSWARM_EXIT_SAVE_FAILED) {
    return { action: 'limited_restart', reason: 'persistence_commit_failed' };
  }
  return { action: 'restart' };
}

export function transitionKSwarmTerminalDegraded(
  current: boolean,
  event: 'unrecoverable_exit' | 'ready',
): boolean {
  if (event === 'unrecoverable_exit') return true;
  if (event === 'ready') return false;
  return current;
}

export function shouldStopAfterPersistenceFailStops(
  count: number,
  maximum = MAX_PERSISTENCE_FAIL_STOP_RESTARTS,
): boolean {
  return count >= maximum;
}

export async function requestWithFallbackBaseUrls(options: {
  baseUrls: string[];
  path: string;
  init?: RequestInit;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  beforeEffects?:()=>void;
}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
  const urls = uniqueServiceUrls(options.baseUrls).map(baseUrl => `${baseUrl}${path}`);
  let lastError: Error | null = null;

  const transportFailures:unknown[]=[];
  let guardFailure:{error:unknown}|undefined;
  const fresh=()=>{try{assertBeforeEffects(options.beforeEffects);}catch(error){const failure=transportFailures.length?new AggregateError([error,...transportFailures],'kswarm_request_guard_and_transport_failed',{cause:error}):error;guardFailure={error:failure};throw failure;}};
  for (const url of urls) {
    fresh();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      fresh();
      return await fetchImpl(url, { ...options.init, signal: controller.signal });
    } catch (error) {
      if(guardFailure&&Object.is(error,guardFailure.error))throw error;
      transportFailures.push(error);
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
  return joinServicePath(userDataPath, 'services', 'intent-broker');
}

export function resolveKSwarmServiceLogRoot(userDataPath?: string): string {
  if (userDataPath) return joinServicePath(userDataPath, 'logs');
  try {
    return join(Electron.app.getPath('userData'), 'logs');
  } catch {
    return LEGACY_KSWARM_LOG_ROOT;
  }
}

function joinServicePath(basePath: string, ...segments: string[]): string {
  if (basePath.startsWith('/') && !basePath.includes('\\')) {
    return posix.join(basePath, ...segments);
  }
  return join(basePath, ...segments);
}

/**
 * Shared auth secrets between the desktop main process and its long-lived
 * children (kswarm server, intent-broker).
 *
 * These were previously generated fresh per app launch. That is the root of a
 * token desync bug: the broker is a persistent process holding the token it was
 * first spawned with, so a later desktop launch that merely *reuses* the healthy
 * broker (see ensureBroker) was silently authenticated with a brand-new token the
 * broker does not know → all room calls returned `room_authentication_required`.
 *
 * Persisting the secrets makes them stable across launches, so a reused broker and
 * a restarted desktop always agree. If the file is absent (first run after upgrade
 * or migration) we regenerate and write it; persist failure is treated as
 * non-fatal and falls back to session-scoped secrets (matching prior behaviour)
 * so tests and unusual environments still work.
 */
interface RoomAuthSecrets {
  desktopRoomToken: string;
  kswarmRoomToken: string;
  desktopMutationToken: string;
}

const ROOM_SECRETS_FILE_NAME = 'room-auth-secrets.json';

function appUserDataPath(): string | null {
  try {
    return Electron.app.getPath('userData');
  } catch {
    return null;
  }
}

function generateRoomSecrets(): RoomAuthSecrets {
  return {
    desktopRoomToken: `xiaok-room-user-${randomBytes(32).toString('base64url')}`,
    kswarmRoomToken: `xiaok-room-system-${randomBytes(32).toString('base64url')}`,
    desktopMutationToken: `xiaok-desktop-${randomBytes(32).toString('base64url')}`,
  };
}

export function loadOrCreateRoomSecrets(explicitUserDataPath?: string): RoomAuthSecrets {
  const userDataPath = explicitUserDataPath ?? appUserDataPath();
  if (!userDataPath) return generateRoomSecrets();

  const secretsPath = join(userDataPath, ROOM_SECRETS_FILE_NAME);
  try {
    const raw = readFileSync(secretsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RoomAuthSecrets>;
    const secrets: RoomAuthSecrets = {
      desktopRoomToken: nonEmptyString(parsed.desktopRoomToken) ?? '',
      kswarmRoomToken: nonEmptyString(parsed.kswarmRoomToken) ?? '',
      desktopMutationToken: nonEmptyString(parsed.desktopMutationToken) ?? '',
    };
    if (secrets.desktopRoomToken && secrets.kswarmRoomToken && secrets.desktopMutationToken) {
      return secrets;
    }
  } catch {
    // missing/corrupt file → regenerate below
  }

  const secrets = generateRoomSecrets();
  try {
    writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // non-fatal: session-scoped secrets keep things working
  }
  return secrets;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function buildIntentBrokerServiceEnv(options: {
  baseEnv?: NodeJS.ProcessEnv;
  cwd: string;
  port: number;
  repoRoot?: string;
  desktopRoomToken?: string;
  kswarmRoomToken?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? {}), PORT: String(options.port) };
  if (options.desktopRoomToken) env.INTENT_BROKER_DESKTOP_TOKEN = options.desktopRoomToken;
  if (options.kswarmRoomToken) env.INTENT_BROKER_KSWARM_TOKEN = options.kswarmRoomToken;
  const repoRoot = options.repoRoot || options.cwd;

  if (repoRoot !== options.cwd) {
    env.INTENT_BROKER_REPO_ROOT ||= repoRoot;
    env.INTENT_BROKER_CONFIG ||= joinServicePath(repoRoot, 'intent-broker.config.json');
    env.INTENT_BROKER_LOCAL_CONFIG ||= joinServicePath(options.cwd, 'intent-broker.local.json');
    env.INTENT_BROKER_DB ||= joinServicePath(options.cwd, '.tmp', 'intent-broker.db');
    env.INTENT_BROKER_HEARTBEAT_PATH ||= joinServicePath(options.cwd, '.tmp', 'broker.heartbeat.json');
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

  if (Electron.app?.isPackaged) {
    const repoRoot = join(process.resourcesPath, 'services', 'intent-broker');
    const entryPath = join(repoRoot, 'src', 'cli.js');
    if (existsSync(entryPath)) {
      return {
        cwd: resolveIntentBrokerRuntimeRoot(Electron.app.getPath('userData')),
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
  terminalDegraded?: boolean;
  persistenceFailStopCount?: number;
  lastPersistenceFailStop?: string | null;
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

/** Only the original owned Server receives a parent IPC descriptor. */
export function buildKSwarmServerSpawnOptions(options:Parameters<typeof buildBackgroundNodeSpawnOptions>[0]) {
  return {...buildBackgroundNodeSpawnOptions(options),stdio:['ignore','pipe','pipe','ipc'] as ['ignore','pipe','pipe','ipc']};
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

export type KSwarmServiceIdentityWarning = 'source_hash_missing';
export type KSwarmServiceIdentityReason = 'service_identity_missing' | 'entry_path_mismatch' | 'source_hash_mismatch';

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
    return { ...base, compatible: false, reason: 'source_hash_mismatch', warning: null };
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

export interface KSwarmExecutionStartRead {
  readonly ok:true;
  readonly protocol:'ordinary_project_execution_start_read_v1';
  readonly projectId:string;
  readonly classification:'legacy_ordinary'|'ordinary'|'ordinary_initial_plan_additive_v1';
  readonly bindingDigest:string|null;
  readonly scope:Readonly<{profileId:string;workspaceId:string}>;
}

export interface KSwarmProjectActivitySubject {readonly projectId:string;readonly sourceDataEpoch:string;readonly after:number}
export interface KSwarmProjectActivityRead {readonly kind:'kswarm_project_activity_read_v1';readonly subject:KSwarmProjectActivitySubject;readonly page:ParsedProjectActivityPage}
type ScopedActivityBinding=Readonly<Pick<ParsedScopedProjectActivityPage,'protocol'|'projectId'|'scope'|'bindingDigest'>>;
export interface KSwarmScopedProjectActivityRead extends ScopedActivityBinding {readonly kind:'kswarm_scoped_project_activity_read_v1';readonly subject:KSwarmProjectActivitySubject;readonly page:ParsedProjectActivityPage}
export interface KSwarmProjectSourceActivityRead {readonly kind:'kswarm_project_source_activity_read_v1';readonly subject:KSwarmProjectActivitySubject;readonly page:ParsedProjectActivityPage;readonly scoped?:KSwarmScopedProjectActivityRead}
export interface KSwarmProjectActivityReadContext {requestSource:'user'|'agent'|'scheduler';signal:AbortSignal;beforeEffects?:()=>void}

export interface KSwarmService {
  /** Private observation transport; never execution admission or a Core witness. */
  readProjectActivity?(subject:KSwarmProjectActivitySubject,context:{requestSource:'user'|'agent'|'scheduler';signal:AbortSignal;beforeEffects?:()=>void}):Promise<KSwarmProjectActivityRead>;
  assertProjectActivityRead?(subject:KSwarmProjectActivitySubject,receipt:KSwarmProjectActivityRead):void;
  readScopedProjectActivity?(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext):Promise<KSwarmScopedProjectActivityRead>;
  assertScopedProjectActivityRead?(subject:KSwarmProjectActivitySubject,receipt:KSwarmScopedProjectActivityRead):void;
  readProjectSourceActivity?(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext):Promise<KSwarmProjectSourceActivityRead>;
  assertProjectSourceActivityRead?(subject:KSwarmProjectActivitySubject,receipt:KSwarmProjectSourceActivityRead):void;
  /** Fixed metadata read only, never a candidate/capacity grant. */
  readProjectExecutionStart?(projectId:string):Promise<KSwarmExecutionStartRead>;
  /** Original instance freshness, synchronously rechecked before a producer. */
  assertProjectExecutionStartRead?(projectId:string,receipt:KSwarmExecutionStartRead):void;
  activityOwnerConfig?(): Promise<Pick<ActivityOwnerConfig, 'kswarm' | 'managedSources'>>;
  bindActivityOwner?(client: ConversationActivityOwnerClient): void;
  /** The activity owner could not be attached: stop waiting for it and let start() manage the
   * sources locally. Never takes over a listener it does not own (adopts a healthy one, refuses to kill). */
  releaseActivityOwnerDelegation?(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): KSwarmServiceStatus;
  getServiceStatus(): Promise<DesktopServiceStatusSnapshot>;
  getHealthDiagnosticInput(): Promise<KSwarmHealthDiagnosticInput>;
  restartRelatedService(serviceId: DesktopRelatedServiceId): Promise<void>;
  onStatusChange(cb: (status: KSwarmServiceStatus) => void): () => void;
  getDesktopMutationToken(): string;
  getIntentBrokerRoomToken(): string;
  /** Main-only metadata transport; one wire POST and complete body ownership.
   * A successful transport never grants execution or proves business ACK. */
  submitTaskMetadataOnce?(projectId:string,envelope:unknown,context:{requestSource:'user'|'agent'|'scheduler';signal:AbortSignal;beforeEffects?:()=>void}):Promise<{ok:boolean;status:number;body:unknown}>;
  /** Make an HTTP request to the KSwarm service. Auto-starts if not running. */
  request(path: string, init?: RequestInit,beforeEffects?:()=>void): Promise<Response>;
}

export interface CreateKSwarmServiceOptions {
  desktopProjectScope?: {profileId:string;workspaceId:string};
  activityOwnerPending?: boolean;
  /** Fixed original Main config admission; absent means default deny. No JSON/HTTP authority. */
  ownedControlAdmission?: KSwarmOwnedControlAdmission;
  /** Fixed private-command admission for Main composition. No user DTO grant. */
  ownedBusinessAdmission?: KSwarmBusinessAdmission;
  /** Independent original A command admission, never user/config/preparation. */
  ownedDshAdmission?: KSwarmDshAdmission;
  /** Independent fixed constructor ports; neither user nor config admission. */
  ownedPreparationSource?: KSwarmPreparationSource;
  ownedPreparationAdmission?: KSwarmPreparationAdmission;
  ownedHostSettlementSource?: KSwarmHostSettlementSource;
  spawnProcess?: typeof spawn;
  findPortOwner?: typeof findPidOnPort;
  killStalePortOwner?: typeof killStaleServiceOnPort;
}

export type StalePortTermination = 'stopped' | 'aborted' | 'owner_changed' | 'not_found' | 'failed';

export async function terminateStalePortOwner(port: number, expectedPid: number, signal: AbortSignal, io: { findOwner(port: number): Promise<number | null>; signalProcess: typeof process.kill } = { findOwner: findPidOnPort, signalProcess: process.kill.bind(process) }): Promise<StalePortTermination> {
  if (signal.aborted) return 'aborted';
  const pid = await io.findOwner(port);
  if (signal.aborted) return 'aborted';
  if (pid == null || pid === process.pid) return 'not_found';
  if (pid !== expectedPid) return 'owner_changed';
  try {
    if (signal.aborted) return 'aborted';
    io.signalProcess(pid, 'SIGTERM');
  } catch { return 'failed'; }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (signal.aborted) return 'aborted';
    try { io.signalProcess(pid, 0); }
    catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'stopped' : 'failed';
    }
  }
  if (signal.aborted) return 'aborted';
  const currentPid = await io.findOwner(port);
  if (signal.aborted) return 'aborted';
  if (currentPid == null) return 'stopped';
  if (currentPid !== expectedPid) return 'owner_changed';
  try { io.signalProcess(pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return 'failed'; }
  // This is the legacy stale-listener recovery operation, not close/custody proof.
  await new Promise(resolve => setTimeout(resolve, 200));
  return signal.aborted ? 'aborted' : 'stopped';
}

export async function killStaleServiceOnPort(port: number, context?: { expectedPid: number; signal: AbortSignal }): Promise<boolean> {
  const pid = context?.expectedPid ?? await findPidOnPort(port);
  if (pid == null || pid === process.pid) return false;
  return await terminateStalePortOwner(port, pid, context?.signal ?? new AbortController().signal) === 'stopped';
}

export function findPidOnPort(port: number): Promise<number | null> {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('netstat', ['-ano', '-p', 'TCP'], (err, stdout) => {
        if (err) return resolve(null);
        for (const line of stdout.split('\n')) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid > 0) return resolve(pid);
          }
        }
        resolve(null);
      });
    } else {
      // Filter to the LISTENING socket only. `lsof -ti :port` also returns every
      // process that merely *connects* to that port (clients), so taking the first
      // line can target a client instead of the real listener and miss the kill.
      // NOTE: `-iTCP:port` must be a single argument; splitting it into `-iTCP`
      // and `:port` makes lsof 4.x reject `:port` and exit with a usage error.
      execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], (err, stdout) => {
        if (err) return resolve(null);
        const pid = parseInt(stdout.trim().split('\n')[0], 10);
        resolve(pid > 0 ? pid : null);
      });
    }
  });
}

/** Authentication failure never proves that an external listener is ours. */
export async function recoverOwnedBrokerAuthentication(options: {
  ownedPid: number | null;
  findOwner: () => Promise<number | null>;
  stopOwned: () => Promise<void>;
}): Promise<'external' | 'stopped'> {
  if (!Number.isSafeInteger(options.ownedPid) || !options.ownedPid || options.ownedPid <= 0) return 'external';
  const owner = await options.findOwner().catch(() => null);
  if (owner !== options.ownedPid) return 'external';
  await options.stopOwned();
  return 'stopped';
}

const workflowReadPorts = new WeakMap<KSwarmService,{port:NativeWorkflowReadPort;request:KSwarmService['request']}>();
function assertWorkflowReadService(service:KSwarmService) {
 const entry=workflowReadPorts.get(service);if(!entry||!instanceClosers.has(service))throw Error('kswarm_workflow_read_instance_unknown');
 const descriptor=Object.getOwnPropertyDescriptor(service,'request');if(!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.value!==entry.request)throw Error('kswarm_workflow_read_instance_changed');
 assertNativeWorkflowReadPort(entry.port);return entry;
}
export async function getKSwarmWorkflowReadPort(service:KSwarmService):Promise<NativeWorkflowReadPort> {
 const entry=assertWorkflowReadService(service);
 const response=await Reflect.apply(entry.request,service,['/health',{method:'GET'}]);
 await response.body?.cancel();
 if(!response.ok)throw Error('kswarm_workflow_read_unavailable');
 if(assertWorkflowReadService(service)!==entry)throw Error('kswarm_workflow_read_instance_changed');
 return entry.port;
}

/** Fixed Main read, including JSON body, owned by the registered port's drain. */
export async function readKSwarmWorkflowRunForExecution(service:KSwarmService,projectId:string,workflowRunId:string):Promise<unknown> {
 const entry=assertWorkflowReadService(service);
 const value=await readNativeWorkflowRun(entry.port,projectId,workflowRunId);
 if(assertWorkflowReadService(service)!==entry)throw Error('kswarm_workflow_read_instance_changed');
 return value;
}

const ownedControlPorts=new WeakMap<KSwarmService,(operation:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext)=>Promise<unknown>>();
const getOwnedControlPort=ownedControlPorts.get.bind(ownedControlPorts),setOwnedControlPort=ownedControlPorts.set.bind(ownedControlPorts);
const originalControlScopes=new WeakMap<KSwarmService,(admission:KSwarmOwnedControlAdmission)=>Readonly<{profileId:string;workspaceId:string}>|undefined>();
const getOriginalControlScope=originalControlScopes.get.bind(originalControlScopes),setOriginalControlScope=originalControlScopes.set.bind(originalControlScopes);
/** Main bootstrap identity only. This grants neither a child handle nor a call. */
export function readKSwarmOwnedControlServiceScope(service:KSwarmService,admission:KSwarmOwnedControlAdmission):Readonly<{profileId:string;workspaceId:string}> {
 const read=getOriginalControlScope(service);if(!read||!getOwnedControlPort(service))throw Error('WRITER_CONTROL_ORIGINAL_SERVICE_REQUIRED');
 const scope=read(admission);if(!scope)throw Error('WRITER_CONTROL_ORIGINAL_SERVICE_REQUIRED');return scope;
}

const unavailableOwnedControls=new WeakMap<object,{service:KSwarmService;operation:KSwarmOwnedControlOperation;context:KSwarmOwnedControlContext}>();
const getUnavailableOwnedControl=unavailableOwnedControls.get.bind(unavailableOwnedControls),setUnavailableOwnedControl=unavailableOwnedControls.set.bind(unavailableOwnedControls);
function unavailableOwnedControl(service:KSwarmService,operation:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext){const error=Error('OWNED_CONTROL_UNAVAILABLE');setUnavailableOwnedControl(error,{service,operation,context});return error;}
/** Original local port's exact zero-admission failure, not a remote string. */
export function isKSwarmOwnedControlUnavailable(error:unknown,service:KSwarmService,operation:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext){const value=error&&typeof error==='object'?getUnavailableOwnedControl(error):undefined;return !!value&&value.service===service&&value.operation===operation&&value.context===context;}
const callOwnedControl=(service:KSwarmService,operation:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext)=>{
  const port=getOwnedControlPort(service);return port?port(operation,context):Promise.reject(unavailableOwnedControl(service,operation,context));
};
/** Main composition only. These are not exposed through preload, HTTP or tools. */
export const prepareKSwarmInitialPlanWriter=(service:KSwarmService,context:KSwarmOwnedControlContext)=>callOwnedControl(service,'prepare_initial_plan_writer',context);
export const inspectKSwarmWriter=(service:KSwarmService,context:KSwarmOwnedControlContext)=>callOwnedControl(service,'inspect_writer',context);
export const migrateKSwarmDefaultDispatchWriter=(service:KSwarmService,context:KSwarmOwnedControlContext)=>callOwnedControl(service,'migrate_default_dispatch_writer',context);
const instanceClosers = new WeakMap<KSwarmService, () => Promise<void>>();
export interface KSwarmOwnedBusinessTransport extends Pick<ReturnType<typeof createOwnedKSwarmBusiness>,'readPlan'|'captureDefaultDispatch'|'readOperation'> {
 prepareHello():Promise<KSwarmBusinessHello>;
 assertHelloCurrent(value:object):void;
}
export interface KSwarmOwnedDshTransport extends KSwarmDshFacet {prepareHello():Promise<KSwarmBusinessHello>;assertHelloCurrent(value:object):void}
export interface OriginalKSwarmServiceIdentity {
 readonly kind:'kswarm_service_identity_v1';
 readonly ownedChild:boolean;
 readonly scope:Readonly<{profileId:string;workspaceId:string}>|null;
 readonly constructorId:object;
 assertCurrent():void;assertLocal():void;
}
export interface OriginalKSwarmExecutionStartIO {
 read(projectId:string):Promise<KSwarmExecutionStartRead>;
 assert(projectId:string,receipt:KSwarmExecutionStartRead):void;
}
export interface OriginalKSwarmWorkflowRunIO {read(projectId:string,workflowRunId:string):Promise<Response>}
export interface OriginalKSwarmWorkflowControllerIO {
 perform(input:WorkflowControllerRequest,beforeEffects?:()=>void):Promise<{ok:boolean;status:number;body:unknown}>;
 waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void;
}
const originalWorkflowControllerIO=new WeakMap<object,(projectId:string,workflowRunId:string|null)=>OriginalKSwarmWorkflowControllerIO>();
export function readOriginalKSwarmWorkflowControllerIO(service:unknown,projectId:string,workflowRunId:string|null):OriginalKSwarmWorkflowControllerIO{
 const factory=businessApply(preparationWeakGet,originalWorkflowControllerIO,[service]) as ((projectId:string,runId:string|null)=>OriginalKSwarmWorkflowControllerIO)|undefined;
 if(!factory)throw Error('KSWARM_ORIGINAL_SERVICE_REQUIRED');return factory(projectId,workflowRunId);
}
const originalWorkflowRunIO=new WeakMap<object,OriginalKSwarmWorkflowRunIO>();
/** Fixed read route. The caller owns the actual response/body lifetime and
 * validates run identity; this read alone is never an accepted-work grant. */
export function readOriginalKSwarmWorkflowRunIO(service:unknown):OriginalKSwarmWorkflowRunIO {
 const io=businessApply(preparationWeakGet,originalWorkflowRunIO,[service]) as OriginalKSwarmWorkflowRunIO|undefined;
 if(!io)throw Error('KSWARM_ORIGINAL_SERVICE_REQUIRED');return io;
}
const originalExecutionStartIO=new WeakMap<object,OriginalKSwarmExecutionStartIO>();
export interface OriginalKSwarmRoomProjectMappingIO {
 assertLocal():void;
 read(projectId:string,logicalAgentId:string,context:RoomTurnCustody,signal:AbortSignal):Promise<unknown>;
}
const originalRoomProjectMappingIO=new WeakMap<object,()=>OriginalKSwarmRoomProjectMappingIO>();
/** Original fixed read route. The returned per-custody lease cannot survive an
 * observed child/incarnation loss and never consults public service methods. */
export function readOriginalKSwarmRoomProjectMappingIO(service:unknown):OriginalKSwarmRoomProjectMappingIO {
 const factory=businessApply(preparationWeakGet,originalRoomProjectMappingIO,[service]) as (()=>OriginalKSwarmRoomProjectMappingIO)|undefined;
 if(!factory)throw Error('KSWARM_ORIGINAL_SERVICE_REQUIRED');return factory();
}
/** Original closed-over IO, independent of replaceable public service slots. */
export function readOriginalKSwarmExecutionStartIO(service:unknown):OriginalKSwarmExecutionStartIO {
 const io=businessApply(preparationWeakGet,originalExecutionStartIO,[service]) as OriginalKSwarmExecutionStartIO|undefined;
 if(!io)throw Error('KSWARM_ORIGINAL_SERVICE_REQUIRED');return io;
}
const originalServiceIdentities=new WeakMap<object,()=>OriginalKSwarmServiceIdentity>();
const originalBrokerClientTokens=new WeakMap<object,string>();
/** Constructor identity relation only; no credential is returned and no SDK is entered. */
export function assertOriginalKSwarmBrokerClientToken(service:unknown,token:unknown):void {
 const expected=businessApply(preparationWeakGet,originalBrokerClientTokens,[service]) as string|undefined;
 if(expected===undefined||typeof token!=='string'||token!==expected)throw Error('BROKER_DSH_ORIGINAL_SERVICE_CREDENTIAL_REQUIRED');
}
/** Passive original constructor identity. It grants neither work nor launch. */
export function readOriginalKSwarmServiceIdentity(service:unknown):OriginalKSwarmServiceIdentity {
 const read=businessApply(preparationWeakGet,originalServiceIdentities,[service]) as (()=>OriginalKSwarmServiceIdentity)|undefined;
 if(!read)throw Error('KSWARM_ORIGINAL_SERVICE_REQUIRED');
 return read();
}
const originalDshServices=new WeakMap<object,{admission:KSwarmDshAdmission;scope():Readonly<{profileId:string;workspaceId:string}>;transport():KSwarmOwnedDshTransport;readReply(reply:unknown):KSwarmDshReplyView}>();
export function readKSwarmOwnedDshServiceScope(service:unknown,admission:KSwarmDshAdmission):Readonly<{profileId:string;workspaceId:string}>{const row=businessApply(preparationWeakGet,originalDshServices,[service]) as {admission:KSwarmDshAdmission;scope():Readonly<{profileId:string;workspaceId:string}>}|undefined;if(!row||row.admission!==admission)throw Error('DSH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');return row.scope();}
export function getKSwarmOwnedDshTransport(service:unknown,admission:KSwarmDshAdmission):KSwarmOwnedDshTransport{const row=businessApply(preparationWeakGet,originalDshServices,[service]) as {admission:KSwarmDshAdmission;transport():KSwarmOwnedDshTransport}|undefined;if(!row||row.admission!==admission)throw Error('DSH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');return row.transport();}
export function readOriginalKSwarmDshReply(service:unknown,admission:KSwarmDshAdmission,reply:unknown):KSwarmDshReplyView{const row=businessApply(preparationWeakGet,originalDshServices,[service]) as {admission:KSwarmDshAdmission;readReply(reply:unknown):KSwarmDshReplyView}|undefined;if(!row||row.admission!==admission)throw Error('DSH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');return row.readReply(reply);}
const businessPorts=new WeakMap<object,(admission:KSwarmBusinessAdmission)=>KSwarmOwnedBusinessTransport>();
const getBusinessPort=businessPorts.get.bind(businessPorts),setBusinessPort=businessPorts.set.bind(businessPorts);
const originalBusinessScopes=new WeakMap<object,(admission:KSwarmBusinessAdmission)=>Readonly<{profileId:string;workspaceId:string}>|undefined>();
const getOriginalBusinessScope=originalBusinessScopes.get.bind(originalBusinessScopes),setOriginalBusinessScope=originalBusinessScopes.set.bind(originalBusinessScopes);
/** Original constructor identity only; it supplies no child or business call. */
export function readKSwarmOwnedBusinessServiceScope(service:object,admission:KSwarmBusinessAdmission):Readonly<{profileId:string;workspaceId:string}>{
 const read=getOriginalBusinessScope(service);if(!read||!getBusinessPort(service))throw Error('DISPATCH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');const scope=read(admission);if(!scope)throw Error('DISPATCH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');return scope;
}
/** Internal original Main composition only. The pinned transport still checks
 * its original opaque command/input; this is never a renderer/tool endpoint. */
export function getKSwarmOwnedBusinessTransport(service:object,admission:KSwarmBusinessAdmission):KSwarmOwnedBusinessTransport {
 const port=getBusinessPort(service);if(!port)throw Error('DISPATCH_BUSINESS_ORIGINAL_SERVICE_REQUIRED');return port(admission);
}

interface OriginalPreparationService {source:KSwarmPreparationSource;admission:KSwarmPreparationAdmission;scope():Readonly<{profileId:string;workspaceId:string}>;transport():KSwarmPreparationFacet;accepted(work:unknown):Readonly<{scope:Readonly<{profileId:string;workspaceId:string}>;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>}
const preparationServices=new WeakMap<object,OriginalPreparationService>();
function preparationService(service:unknown,source:object,admission:KSwarmPreparationAdmission):OriginalPreparationService{
 const row=service&&typeof service==='object'?businessApply(preparationWeakGet,preparationServices,[service]) as OriginalPreparationService|undefined:undefined;
 if(!row||row.source!==source||row.admission!==admission)throw Error('DISPATCH_PREPARATION_ORIGINAL_SERVICE_REQUIRED');return row;
}
/** Constructor identity only; it neither calls Source nor grants a Work. */
export function readKSwarmOwnedPreparationServiceScope(service:unknown,source:KSwarmPreparationSource,admission:KSwarmPreparationAdmission):Readonly<{profileId:string;workspaceId:string}>{return preparationService(service,source,admission).scope();}
/** Fixed original-client facet, unavailable without its actual retained child. */
export function getKSwarmOwnedPreparationTransport(service:unknown,source:KSwarmPreparationSource,admission:KSwarmPreparationAdmission):KSwarmPreparationFacet{return preparationService(service,source,admission).transport();}

/** Fixed same-client accepted identity; not a new entry, Source or Work grant. */
export function readOriginalPreparationAcceptedWorkBinding(service:unknown,source:KSwarmPreparationSource,admission:KSwarmPreparationAdmission,work:unknown):Readonly<{scope:Readonly<{profileId:string;workspaceId:string}>;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>{return preparationService(service,source,admission).accepted(work);}

/** Permanently closes this Main instance and observes its direct children close.
 * External services, descendants and remote work are not covered by this API. */
export function sealAndDrainKSwarmServiceInstance(service: KSwarmService): Promise<void> {
  const close = instanceClosers.get(service);
  if (!close) throw Error('kswarm_service_instance_unknown');
  return close();
}

const protectedKSwarmStartups=new WeakMap<object,Readonly<{service:object;environment:Readonly<Record<string,string>>}>>();
const protectedBrokerStartups=new WeakMap<object,Readonly<{service:object;environment:Readonly<Record<string,string>>}>>();
const protectedServiceFates=new WeakMap<object,Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>>();
export function readOriginalKSwarmServicePhysicalFate(service:unknown):Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>{
 const view=businessApply(preparationWeakGet,protectedServiceFates,[service]) as Readonly<{waitPhysicalKnown():Promise<void>;assertPhysicalKnown():void}>|undefined;
 if(!view)throw Error('KSWARM_ORIGINAL_SERVICE_PHYSICAL_REQUIRED');return view;
}
/** Fixed original start-frame membership, never caller environment authority. */
export function readOriginalKSwarmProtectedStartup(service:unknown,ticket:unknown):Readonly<Record<string,string>> {
 const row=businessApply(preparationWeakGet,protectedKSwarmStartups,[ticket]) as Readonly<{service:object;environment:Readonly<Record<string,string>>}>|undefined;
 if(!row||row.service!==service)throw Error('KSWARM_ORIGINAL_STARTUP_REQUIRED');return row.environment;
}
/** Exact original Broker business frame only; no environment/role supplied by callers. */
export function readOriginalBrokerProtectedStartup(service:unknown,ticket:unknown):Readonly<Record<string,string>>{
 const row=businessApply(preparationWeakGet,protectedBrokerStartups,[ticket]) as Readonly<{service:object;environment:Readonly<Record<string,string>>}>|undefined;
 if(!row||row.service!==service)throw Error('BROKER_ORIGINAL_STARTUP_REQUIRED');return row.environment;
}
export function createKSwarmService(options: CreateKSwarmServiceOptions = {}): KSwarmService {
  if(!options||typeof options!=='object'||preparationProxy(options))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  const sourceOption=businessDescriptor(options,'ownedPreparationSource'),admissionOption=businessDescriptor(options,'ownedPreparationAdmission');
  if(sourceOption&&!preparationOwn(sourceOption,'value')||admissionOption&&!preparationOwn(admissionOption,'value'))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  const ownedPreparationSource=sourceOption?.value as KSwarmPreparationSource|undefined,ownedPreparationAdmission=admissionOption?.value as KSwarmPreparationAdmission|undefined;
  let fixedPreparationSource:KSwarmPreparationSource|undefined;
  if(ownedPreparationSource!==undefined||ownedPreparationAdmission!==undefined){
    if(!ownedPreparationSource||typeof ownedPreparationSource!=='object'||preparationProxy(ownedPreparationSource)||typeof ownedPreparationAdmission!=='function'||preparationProxy(ownedPreparationAdmission)||preparationAsync(ownedPreparationAdmission)||businessPrototype(ownedPreparationAdmission)===businessAsyncPrototype)throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
    const functions=businessCreate(null) as Record<string,Function>;
    const names=['resolveWork','observeWork','sealWork'];for(let i=0;i<names.length;i++){const name=names[i]!,row=businessDescriptor(ownedPreparationSource,name);if(!row||!preparationOwn(row,'value')||typeof row.value!=='function'||preparationProxy(row.value)||preparationAsync(row.value)||businessPrototype(row.value)===businessAsyncPrototype)throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');functions[name]=row.value;}
    const resolve=functions.resolveWork!,observe=functions.observeWork!,seal=functions.sealWork!;
    const fixed:KSwarmPreparationSource=businessAssign(businessCreate(null),{
      resolveWork(proof:object,audience:Parameters<KSwarmPreparationSource['resolveWork']>[1]){return businessApply(resolve,ownedPreparationSource,[proof,audience]);},
      observeWork(custody:object,observer:(cut:unknown)=>void){return businessApply(observe,ownedPreparationSource,[custody,observer]);},
      sealWork(custody:object){return businessApply(seal,ownedPreparationSource,[custody]);},
    });
    // Forward the original raw unchanged. The same client still owns its
    // classification, Source callbacks and every visible SDK tail.
    fixedPreparationSource=preparationFreeze(fixed);
  }
  const hostOption=businessDescriptor(options,'ownedHostSettlementSource');
  if(hostOption&&!preparationOwn(hostOption,'value'))throw Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');
  const hostSource=hostOption?.value as KSwarmHostSettlementSource|undefined;
  let fixedHostSource:KSwarmHostSettlementSource|undefined;
  if(hostSource!==undefined){
    if(!fixedPreparationSource||!hostSource||typeof hostSource!=='object'||preparationProxy(hostSource))throw Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');
    const functions=businessCreate(null) as Record<string,Function>;
    for(const name of ['resolveRegistration','resolveNoEffectSettlement']){
      const row=businessDescriptor(hostSource,name);if(!row||!preparationOwn(row,'value')||typeof row.value!=='function'||preparationProxy(row.value)||preparationAsync(row.value)||businessPrototype(row.value)===businessAsyncPrototype)throw Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');functions[name]=row.value;
    }
    const registration=functions.resolveRegistration!,settlement=functions.resolveNoEffectSettlement!;
    fixedHostSource=preparationFreeze(businessAssign(businessCreate(null),{
      resolveRegistration(custody:object,audience:Parameters<KSwarmHostSettlementSource['resolveRegistration']>[1]){return businessApply(registration,hostSource,[custody,audience]);},
      resolveNoEffectSettlement(custody:object,audience:Parameters<KSwarmHostSettlementSource['resolveNoEffectSettlement']>[1]){return businessApply(settlement,hostSource,[custody,audience]);},
    }));
  }
  // Validate the ORIGINAL object before reading/spreading any of its fields.
  // The same closed domain is used for both original IPC lanes.
  const suppliedScope=options.desktopProjectScope;
  const scope=suppliedScope===undefined?undefined:captureDispatchBusinessData(suppliedScope) as Readonly<{profileId:string;workspaceId:string}>;
  if(suppliedScope!==undefined&&(!scope||Object.keys(scope).length!==2||!Object.hasOwn(scope,'profileId')||!Object.hasOwn(scope,'workspaceId')||typeof scope.profileId!=='string'||typeof scope.workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(scope.profileId)||!/^[a-f0-9]{64}$/.test(scope.workspaceId)))throw Error('kswarm_project_scope_invalid');
  if(ownedPreparationSource&&!scope)throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  const ownedControlAdmission=options.ownedControlAdmission;
  const ownedBusinessAdmission=options.ownedBusinessAdmission;
  const dshAdmissionOption=businessDescriptor(options,'ownedDshAdmission');if(dshAdmissionOption&&!preparationOwn(dshAdmissionOption,'value'))throw Error('DSH_BUSINESS_FIXED_ADMISSION_REQUIRED');
  const ownedDshAdmission=dshAdmissionOption?.value as KSwarmDshAdmission|undefined;
  if(ownedDshAdmission!==undefined&&(!scope||typeof ownedDshAdmission!=='function'||businessTypes.isProxy(ownedDshAdmission)||businessTypes.isAsyncFunction(ownedDshAdmission)))throw Error('DSH_BUSINESS_FIXED_ADMISSION_REQUIRED');
  let ownedDshPort:KSwarmOwnedDshTransport|undefined;
  let ownedBusinessPort:KSwarmOwnedBusinessTransport|undefined;
  let ownedPreparationPort:KSwarmPreparationFacet|undefined;
  const acceptedPreparationBindings=new WeakMap<object,Readonly<{scope:Readonly<{profileId:string;workspaceId:string}>;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>>();
  type BusinessRecord={child:ChildProcess;client:ReturnType<typeof createOwnedKSwarmBusiness>;dshAdmission?:KSwarmDshAdmission;retirement?:Promise<void>;raw?:unknown;failure?:unknown;unknown:boolean;retired:boolean};
  let ownedBusiness:BusinessRecord|undefined;
  const businessClients=createIntrinsicSet<BusinessRecord>(),businessJoinUnknown=createIntrinsicSet<unknown>();
  const businessCalls=createIntrinsicSet<{raw?:unknown;completion:Promise<void>;complete():void}>();
  function runBusiness<T>(record:BusinessRecord,work:()=>Promise<T>):Promise<T>{
    const output=businessDeferred<T>();
    if(permanentlySealed||stopping||!running||record.retirement||ownedBusiness!==record||child!==record.child){output.reject(Error('DISPATCH_BUSINESS_UNAVAILABLE'));return output.promise;}
    const completion=businessDeferred<void>();
    const call:{raw?:unknown;completion:Promise<void>;complete():void}=businessAssign(businessCreate(null),{raw:undefined,completion:completion.promise,complete(){businessCalls.delete(call);completion.resolve();}});businessCalls.add(call);
    try{
      const raw=work();call.raw=raw;
      if(!originalBusinessPromise(raw)){businessJoinUnknown.add(raw);output.reject(Error('DISPATCH_BUSINESS_CALL_UNCONFIRMED'));return output.promise;}
      businessApply(businessThen,raw,[(value:T)=>{
        call.complete();if(permanentlySealed||stopping||!running||record.retirement||ownedBusiness!==record||child!==record.child)output.reject(Error('DISPATCH_BUSINESS_UNAVAILABLE'));else output.resolve(value);
      },(error:unknown)=>{call.complete();output.reject(error);}]);
    }catch(error){call.complete();output.reject(error);}return output.promise;
  }
  function retireBusiness(record:BusinessRecord):Promise<void>{
    if(record.retirement)return record.retirement;
    const deferred=businessDeferred<void>();record.retirement=deferred.promise;
    try{
      record.client.seal();const raw=record.client.sealAndDrainPrefix();record.raw=raw;
      if(!originalBusinessPromise(raw)){record.unknown=true;record.failure=Error('DISPATCH_BUSINESS_RETIREMENT_UNKNOWN');businessJoinUnknown.add(raw);return deferred.promise;}
      businessApply(businessThen,raw,[()=>{record.retired=true;deferred.resolve();},(error:unknown)=>{record.failure=error;record.retired=true;deferred.resolve();}]);
    }catch(error){record.unknown=true;record.failure=error;businessJoinUnknown.add(record.raw);}
    // An unobservable original prefix remains owned and pending. It does not
    // authorize killing a child while a known callback may still be held.
    return deferred.promise;
  }
  function drainBusinessRecords(all=false):Promise<unknown[]>{
    const deferred=businessDeferred<unknown[]>(),records=businessClients.snapshot(),pending:Promise<void>[]=[],joined:BusinessRecord[]=[];
    for(let i=0;i<records.length;i++){const record=records[i]!;if(all||record.retirement){appendIntrinsic(joined,record);appendIntrinsic(pending,retireBusiness(record));}}
    const calls=businessCalls.snapshot();
    const work=(async()=>{const errors:unknown[]=businessSetPrototype([],null);for(let i=0;i<pending.length;i++){await pending[i]!;if(joined[i]!.failure)appendIntrinsic(errors,joined[i]!.failure);}for(let i=0;i<calls.length;i++)await calls[i]!.completion;return errors;})();
    businessDefine(work,'constructor',{__proto__:null,value:businessPromise} as PropertyDescriptor);
    if(!originalBusinessPromise(work)){businessJoinUnknown.add(work);return deferred.promise;}
    businessApply(businessThen,work,[deferred.resolve,deferred.reject]);return deferred.promise;
  }
  let ownedControl:ReturnType<typeof createKSwarmOwnedControl>|undefined;
  const ownedControls=createIntrinsicSet<ReturnType<typeof createKSwarmOwnedControl>>();
  const sealOwnedControl=()=>{ownedControl?.seal();ownedBusinessPort=undefined;ownedPreparationPort=undefined;ownedDshPort=undefined;if(ownedBusiness)retireBusiness(ownedBusiness);};
  if(scope && (!/^[a-f0-9]{64}$/.test(scope.profileId) || !/^[a-f0-9]{64}$/.test(scope.workspaceId)))throw Error('kswarm_project_scope_invalid');
  const projectScopeEnv=Object.freeze({KSWARM_DESKTOP_PROFILE_ID:scope?.profileId ?? '',KSWARM_DESKTOP_WORKSPACE_ID:scope?.workspaceId ?? ''});
  assertRoomWorkspaceStartupProtocol();
  const ingress = createLocalSourceWriterLifetime('kswarm_service');
  const background = createLocalSourceWriterLifetime('kswarm_service_background');
  const ownedChildren = createOwnedServiceChildCloseTracker();
  const closeAbort = new AbortController();
  const metadataCleanupObligations=createIntrinsicSet<{response:Response|undefined;reader:ReadableStreamDefaultReader<Uint8Array>|undefined;error:unknown}>();
  let activitySourceInstance:string|undefined;
  let activitySourceKnownInstance:string|undefined;
  let activitySourceControl=new AbortController();
  let activitySourceObservation:object=Object.freeze({});
  let activityHealthRequest:object=Object.freeze({});
  const activityReadReceipts=new WeakMap<object,{subject:KSwarmProjectActivitySubject;incarnation:object;child:ChildProcess|null;restartCount:number;sourceInstance:string;sourceObservation:object;signal:AbortSignal;beforeEffects?:()=>void;scopedBinding?:ScopedActivityBinding}>();
  const activitySourceReceipts=new WeakMap<object,{subject:KSwarmProjectActivitySubject;incarnation:object;child:ChildProcess|null;restartCount:number;sourceControl:AbortController;signal:AbortSignal;beforeEffects?:()=>void}>();
  const assertMetadataCleanupKnown=()=>{if(metadataCleanupObligations.size){const rows=metadataCleanupObligations.snapshot(),errors:unknown[]=[];for(let i=0;i<rows.length;i++)appendIntrinsic(errors,rows[i]!.error);throw aggregateIntrinsicErrors(errors,'kswarm_metadata_cleanup_unconfirmed');}};
  let permanentlySealed = false;
  let closing: Promise<void> | undefined;
  let physicalCloseFinished=false,legacyCloseUnknown=false;
  const physicalCloseStocks=createIntrinsicSet<RoomTurnCustody>(),physicalJoinStock=createRoomTurnCustody();
  function closeSdk<T>(fn:Function,receiver:unknown,args:unknown[]):Promise<T>{if(!hasOriginalProtectedKSwarmService(service)&&!hasOriginalProtectedBrokerService(service))return businessApply(fn,receiver,args) as Promise<T>;const stock=createRoomTurnCustody();physicalCloseStocks.add(stock);return stock.sdk<T>(fn,receiver,args);}
  function assertServicePhysical():void{
    if((!hasOriginalProtectedKSwarmService(service)&&!hasOriginalProtectedBrokerService(service))||!physicalCloseFinished||legacyCloseUnknown||metadataCleanupObligations.size||businessJoinUnknown.size||businessCalls.size)throw Error('KSWARM_ORIGINAL_SERVICE_PHYSICAL_UNCONFIRMED');
    const stocks=physicalCloseStocks.snapshot();for(let index=0;index<stocks.length;index++)stocks[index]!.assertPhysicalKnown();physicalJoinStock.assertPhysicalKnown();
  }
  const spawnProcess = options.spawnProcess ?? spawn;
  const findPortOwner = options.findPortOwner ?? findPidOnPort;
  let activityOwner: ConversationActivityOwnerClient | undefined;
  let activityDelegated = options.activityOwnerPending === true;
  let activityFallback = false;
  const killStalePortOwner = async (port: number, context?: { expectedPid: number; signal: AbortSignal }): Promise<boolean> => {
    if (activityFallback) return false;
    if (activityDelegated || activityOwner) {
      // A UI process never kills a managed or unknown listener. If the owner
      // cannot be authenticated, this remains a refusal, never a takeover.
      const pid = await findPortOwner(port);
      if (pid && activityOwner) await activityOwner.request('sourceProtected', { pid });
      return false;
    }
    return (options.killStalePortOwner ?? killStaleServiceOnPort)(port, context);
  };
  let child: ChildProcess | null = null;
  let brokerChild: ChildProcess | null = null;
  let executionReadIncarnation:object=Object.freeze({});
  const executionReadReceipts=new WeakMap<KSwarmExecutionStartRead,{incarnation:object;child:ChildProcess|null;restartCount:number}>();
  let running = false;
  let restartCount = 0;
  let lastError: string | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;
  let startingPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let healthFailureCount = 0;
  let terminalDegraded = false;
  let persistenceFailStopCount = 0;
  let lastPersistenceFailStop: string | null = null;
  const suppressedServerExits = new WeakSet<ChildProcess>();
  const roomSecrets = loadOrCreateRoomSecrets();
  const desktopMutationToken = roomSecrets.desktopMutationToken;
  const desktopRoomToken = roomSecrets.desktopRoomToken;
  const kswarmRoomToken = roomSecrets.kswarmRoomToken;
  const listeners = new Set<(status: KSwarmServiceStatus) => void>();

  function getStatus(): KSwarmServiceStatus {
    return {
      running,
      port: KSWARM_PORT,
      pid: child?.pid ?? null,
      restartCount,
      lastError,
      terminalDegraded,
      persistenceFailStopCount,
      lastPersistenceFailStop,
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
    const headers = new Headers(init?.headers);
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
      headers.set('x-kswarm-mutation-token', desktopMutationToken);
    }
    return requestWithFallbackBaseUrls({
      baseUrls: KSWARM_REQUEST_BASE_URLS,
      path,
      init: { ...init, headers },
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }

  async function fetchHealthJsonFromUrls(urls: string[]): Promise<HealthJsonResult> {
    const observation=urls===KSWARM_HEALTH_URLS?Object.freeze({}):undefined;
    if(observation)activityHealthRequest=observation;
    let lastResult: HealthJsonResult | null = null;
    for (const url of uniqueServiceUrls(urls)) {
      const result = await fetchHealthJson(url);
      if (result.ok) {
        if(observation===activityHealthRequest)observeActivitySourceInstance(result);
        return result;
      }
      lastResult = result;
    }
    const result=lastResult ?? {
      ok: false,
      body: null,
      error: 'no health endpoints configured',
    };
    if(observation===activityHealthRequest)observeActivitySourceInstance(result);
    return result;
  }

  // Negative currentness observation only. A positive frame still requires
  // original service adoption/read admission and this instance's page echo.
  function observeActivitySourceInstance(result:HealthJsonResult):void {
    const service=result.body?.service as Record<string,unknown>|undefined,id=result.ok?service?.instanceId:undefined;
    const next=typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)?id:undefined;
    if(next){if(activitySourceKnownInstance&&activitySourceKnownInstance!==next)invalidateActivitySourceControl(Error('kswarm_activity_read_source_instance_changed'));activitySourceKnownInstance=next;}
    if(next!==activitySourceInstance){activitySourceInstance=next;activitySourceObservation=Object.freeze({});}
  }
  function invalidateActivitySourceControl(reason:Error):void{const previous=activitySourceControl;activitySourceControl=new AbortController();previous.abort(reason);}

  async function brokerHealthCheck(): Promise<boolean> {
    const result = await fetchHealthJsonFromUrls(BROKER_HEALTH_URLS);
    return result.ok;
  }

  /**
   * Probe an authenticated room endpoint to confirm the desktop token is
   * accepted by the running broker. A healthy broker that was spawned by an
   * older desktop session holds a different token; probing here lets
   * ensureBroker detect the stale-token state and respawn the broker under the
   * current (persisted) token instead of silently returning `room_authentication_required`.
   *
   * Returns false only on an explicit 401 (stale token). Any other reachable
   * status is treated as "token fine" so transient broker errors do not trigger
   * a live-respawn loop; unreachable brokers are left to the health check.
   */
  async function brokerDesktopTokenAccepted(): Promise<boolean> {
    const baseUrls = uniqueServiceUrls(BROKER_HEALTH_URLS.map(url => url.replace(/\/health$/, '')));
    for (const baseUrl of baseUrls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
      try {
        const res = await fetch(`${baseUrl}/rooms`, {
          signal: controller.signal,
          headers: { 'x-intent-broker-room-token': desktopRoomToken },
        });
        if (res.status === 401) return false;
        return true;
      } catch {
        // fall through to next base URL; unreachable is handled by the health check
      } finally { clearTimeout(timer); }
    }
    return true;
  }

  function startHealthCheck() {
    stopHealthCheck();
    if (permanentlySealed) return;
    healthTimer = setInterval(() => {
      if (permanentlySealed) return;
      void background.runAsync(async () => {
      if (!running || stopping) return;
      const ok = await healthCheck();
      healthFailureCount = nextHealthFailureCount(healthFailureCount, ok);
      if (!ok && !shouldRestartAfterHealthFailures(healthFailureCount)) {
        console.warn(`[kswarm-service] Health check failed (${healthFailureCount}/${HEALTH_FAILURE_RESTART_THRESHOLD}), will retry before restart`);
        return;
      }
      if (!ok && running && !stopping) {
        console.log('[kswarm-service] Health check failed repeatedly, attempting restart...');
        sealOwnedControl();
        executionReadIncarnation=Object.freeze({}); running = false;
        healthFailureCount = 0;
        stopHealthCheck();
        notifyListeners();
        try {
          if (activityOwner) await activityOwner.request('sourceEnsure', { name: 'kswarm', ownerEpoch: activityOwner.ownerEpoch });
          else await killOwnedServer();
        } catch (error) { lastError = error instanceof Error ? error.message : 'activity_source_unavailable'; notifyListeners(); }
        if (!stopping) scheduleRestart();
      }
      }).catch(error => { console.error('[kswarm-service] Health loop failed:', error); });
    }, HEALTH_INTERVAL_MS);
  }

  function stopHealthCheck() {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
  }

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
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
            body: JSON.stringify(buildManagedXiaokAgentSemanticPayload(desired)),
          });
          if (!createRes.ok && createRes.status !== 409) {
            console.warn(`[kswarm-service] Failed to create seed agent ${desired.id}: ${createRes.status}`);
          }
          continue;
        }

        const detailRes = await fetchKSwarm(`/agents/${desired.id}`);
        const detailPayload = detailRes.ok ? await detailRes.json() as { agent?: Record<string, unknown> } : null;
        const currentAgent = detailPayload?.agent ?? existing;
        const rawPatch = diffManagedXiaokAgentPatch(currentAgent, desired);
        const semanticPatch = rawPatch ? buildManagedXiaokAgentSemanticPayload(rawPatch, { update: true }) : {};
        const patch = Object.keys(semanticPatch).length > 0 ? semanticPatch : null;
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
    if (permanentlySealed) return;
    if (terminalDegraded) {
      console.warn('[kswarm-service] Terminal degraded (unrecoverable durable state); skipping restart');
      return;
    }
    if (stopping || restartCount >= MAX_RESTART_ATTEMPTS) {
      if (restartCount >= MAX_RESTART_ATTEMPTS) {
        lastError = `Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached`;
        notifyListeners();
      }
      return;
    }
    if (restartTimer) return;
    const delay = Math.min(RESTART_BASE_DELAY_MS * Math.pow(2, restartCount), MAX_RESTART_DELAY_MS);
    console.log(`[kswarm-service] Scheduling restart in ${delay}ms (attempt ${restartCount + 1})`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (permanentlySealed) return;
      void background.runAsync(async () => {
      if (!stopping && !running && !child) {
        restartCount++;
        try {
          await spawnServerOnce();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          executionReadIncarnation=Object.freeze({}); running = false;
          lastError = `KSwarm restart failed: ${message}`;
          console.error(`[kswarm-service] ${lastError}`);
          logKSwarmServiceLine('server', 'lifecycle', lastError);
          notifyListeners();
          if (!stopping) scheduleRestart();
        }
      }
      }).catch(error => { console.error('[kswarm-service] Restart loop failed:', error); });
    }, delay);
  }

  async function spawnServerOnce(): Promise<void> {
    // Exit/error may have cleared `child` before this replacement path runs.
    // Every old retirement still owns its parent SDK tails independently.
    if(businessClients.size)await drainBusinessRecords();
    if(permanentlySealed)return;
    executionReadIncarnation=Object.freeze({});
    if (startingPromise) {
      await startingPromise;
      return;
    }
    startingPromise = spawnServer().finally(() => {
      startingPromise = null;
    });
    await startingPromise;
  }

  let protectedBrokerStarting:Promise<boolean>|undefined;
  async function ensureBroker(): Promise<boolean> {
    if(hasOriginalProtectedBrokerService(service)){
      assertOriginalProtectedBrokerServiceCurrent(service);
      if(activityDelegated||activityOwner)throw Error('BROKER_ORIGINAL_CHILD_DELEGATION_DENIED');
      if(protectedBrokerStarting)return protectedBrokerStarting;
      let yes!:(ready:boolean)=>void,no!:(raw:unknown)=>void;
      protectedBrokerStarting=new Promise<boolean>((resolve,reject)=>{yes=resolve;no=reject;});
      const run=(async()=>{
        if(stopping||permanentlySealed)throw Error('BROKER_ORIGINAL_SERVICE_CLOSED');
        const ticket=preparationFreeze(businessCreate(null)) as object;
        const environment=createOriginalBrokerServiceEnvironment(desktopRoomToken,kswarmRoomToken);
        businessApply(preparationWeakSet,protectedBrokerStartups,[ticket,preparationFreeze({service,environment})]);
        const owned=await createOriginalProtectedBrokerServiceChild(service,ticket);
        brokerChild=owned;ownedChildren.track(owned,3_000);
        if(stopping||permanentlySealed)throw Error('BROKER_ORIGINAL_SERVICE_CLOSED');
        for(let i=0;i<10;i++){
          if(stopping||permanentlySealed)throw Error('BROKER_ORIGINAL_SERVICE_CLOSED');
          if(await brokerHealthCheck())return true;
          await new Promise(resolve=>setTimeout(resolve,300));
        }
        return false;
      })();void run.then(yes,no);return protectedBrokerStarting;
    }

    if (activityDelegated && !activityOwner) throw new Error('activity_owner_initializing');
    // Check if broker is already running
    if (await brokerHealthCheck()) {
      // A stale token can belong to an external installation. Authentication
      // failure is not permission to kill the listener or take over its data.
      if (stopping) return false;
      let brokerLaunch: ServiceLaunchSpec | null;
      try {
        brokerLaunch = resolveBrokerLaunchSpec();
      } catch {
        // Cannot determine whether we own/provision this broker (e.g. headless
        // test env where `app` is unavailable) — treat it as externally managed
        // rather than force a respawn.
        brokerLaunch = null;
      }
      if (!brokerLaunch) {
        // Externally-managed broker — assume it is configured correctly.
        return true;
      }
      if (await brokerDesktopTokenAccepted()) return true;
      const recovery = await recoverOwnedBrokerAuthentication({
        ownedPid: brokerChild?.pid ?? null,
        findOwner: () => findPortOwner(BROKER_PORT),
        stopOwned: stopOwnedBroker,
      });
      if (stopping) return false;
      if (recovery === 'external') {
        logKSwarmServiceLine('broker', 'lifecycle', 'unowned broker rejects desktop authentication; preserving listener, workspace unavailable');
        return true;
      }
      logKSwarmServiceLine('broker', 'lifecycle', 'owned broker stopped after stale authentication; restarting with persisted token');
    } else if (stopping) {
      return false;
    }

    if (activityDelegated || activityOwner) {
      if (!activityOwner) throw new Error('activity_owner_initializing');
      await activityOwner.request('sourceEnsure', { name: 'broker', ownerEpoch: activityOwner.ownerEpoch });
      return brokerHealthCheck();
    }

    const brokerLaunch = resolveBrokerLaunchSpec();
    if (!brokerLaunch) {
      console.log('[kswarm-service] Broker entry not found, assuming external broker');
      return true; // May be running externally
    }

    const brokerEnv = buildIntentBrokerServiceEnv({
      baseEnv: buildSidecarEnv(process.env),
      cwd: brokerLaunch.cwd,
      port: BROKER_PORT,
      repoRoot: brokerLaunch.repoRoot,
      desktopRoomToken,
      kswarmRoomToken,
    });
    const nodeRuntime = resolveBackgroundNodeRuntime({ env: brokerEnv });
    console.log(`[kswarm-service] Spawning broker: ${brokerLaunch.entryPath}`);
    logKSwarmServiceLine(
      'broker',
      'lifecycle',
      `spawn command=${nodeRuntime.command} entryPath=${brokerLaunch.entryPath} cwd=${brokerLaunch.cwd}`,
    );
    mkdirSync(brokerLaunch.cwd, { recursive: true });
    assertRoomWorkspaceSidecarProtocol(brokerLaunch.entryPath, 'intent-broker');
    const spawnedBroker = spawnProcess(nodeRuntime.command, brokerLaunch.nodeArgs, buildBackgroundNodeSpawnOptions({
      cwd: brokerLaunch.cwd,
      env: nodeRuntime.env,
    }));
    ownedChildren.track(spawnedBroker, 3_000);
    brokerChild = spawnedBroker;
    spawnedBroker.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        console.log(`[broker] ${msg}`);
        logKSwarmServiceLine('broker', 'stdout', msg);
      }
    });
    spawnedBroker.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) {
        console.error(`[broker:err] ${msg}`);
        logKSwarmServiceLine('broker', 'stderr', msg);
      }
    });
    spawnedBroker.on('error', (error) => {
      logKSwarmServiceLine('broker', 'lifecycle', `Spawn error: ${error.message}`);
      if (brokerChild !== spawnedBroker) return;
      brokerChild = null;
      lastError = `Broker spawn failed: ${error.message}`;
      notifyListeners();
    });
    spawnedBroker.on('exit', (code) => {
      const message = `Broker exited: code=${code}`;
      console.log(`[kswarm-service] ${message}`);
      logKSwarmServiceLine('broker', 'lifecycle', message);
      if (brokerChild === spawnedBroker) brokerChild = null;
    });

    // Wait briefly for broker to be ready
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (stopping) return false;
      if (await brokerHealthCheck()) return true;
    }
    return false;
  }

  async function replaceStalePortOwner(expectedPid?: number): Promise<boolean> {
    const pid = expectedPid ?? await findPortOwner(KSWARM_PORT);
    if (permanentlySealed || pid == null || pid === process.pid) return false;
    return killStalePortOwner(KSWARM_PORT, { expectedPid: pid, signal: closeAbort.signal });
  }

  async function spawnServer(): Promise<void> {
    const protectedSource=hasOriginalProtectedKSwarmService(service);
    if(protectedSource&&(activityDelegated||activityOwner))throw Error('KSWARM_ORIGINAL_CHILD_DELEGATION_DENIED');
    if (activityDelegated || activityOwner) {
      if (!activityOwner) throw new Error('activity_owner_initializing');
      // Delegation precedes every local stale/incompatible-listener path.
      // The supervisor owns recovery; a UI must never attempt to kill its source.
      await activityOwner.request('sourceEnsure', { name: 'kswarm', ownerEpoch: activityOwner.ownerEpoch });
      const health = await fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS);
      const entry = resolveServicePath('kswarm', 'src/server/index.js');
      const identity = checkKSwarmHealthServiceIdentity(health.body, entry, computeKSwarmServiceSourceHash(entry));
      const supported = hasDynamicWorkflowSupport(health.body);
      const ready = health.ok && supported && Boolean(entry) && identity.compatible;
      if (!ready) {
        executionReadIncarnation=Object.freeze({}); running = false;
        lastError = !health.ok ? 'activity_source_unavailable'
          : !supported ? 'activity_source_contract_mismatch: dynamic_workflows missing'
            : `activity_source_identity_mismatch: ${identity.reason ?? 'entry_missing'}`;
        notifyListeners(); return;
      }
      const brokerReady = await ensureBroker();
      await reconcileSeedAgents();
      if (stopping) return;
      executionReadIncarnation=Object.freeze({}); running = true; lastError = brokerReady ? null : 'intent-broker health check failed';
      restartCount = 0; healthFailureCount = 0; startHealthCheck(); notifyListeners(); return;
    }
    if (child) return;
    let serverPath:string|null=null,brokerReady=false;
    if(!protectedSource&&!hasOriginalProtectedBrokerService(service)){
    const existingHealth = await fetchHealthJsonFromUrls(KSWARM_HEALTH_URLS);
    if (stopping) return;
    const existingHealthy = existingHealth.ok;
    const dynamicWorkflowReady = hasDynamicWorkflowSupport(existingHealth.body);
    serverPath = resolveServicePath('kswarm', 'src/server/index.js');
    const expectedSourceHash = computeKSwarmServiceSourceHash(serverPath);
    const serviceIdentity = checkKSwarmHealthServiceIdentity(existingHealth.body, serverPath, expectedSourceHash);
    const serviceIdentityMatches = serviceIdentity.compatible;
    let killedStale = false;
    if (!existingHealthy && !child) {
      const portOwner = await findPortOwner(KSWARM_PORT);
      if (stopping) return;
      if (portOwner !== null && portOwner !== process.pid) {
        logKSwarmServiceLine(
          'server',
          'lifecycle',
          `replacing unhealthy orphan service pid=${portOwner} port=${KSWARM_PORT}`,
        );
        const killed = await replaceStalePortOwner(portOwner);
        if (permanentlySealed || stopping) return;
        if (!killed) {
          lastError = `failed to kill unhealthy orphan kswarm service on port ${KSWARM_PORT}`;
          executionReadIncarnation=Object.freeze({}); running = false;
          notifyListeners();
          return;
        }
        killedStale = true;
      }
    }

    brokerReady = await brokerHealthCheck();
    if (stopping) return;
    if (existingHealthy && serviceIdentity.warning) {
      const warning = formatServiceIdentityWarning(serviceIdentity);
      console.warn(`[kswarm-service] ${warning}`);
      logKSwarmServiceLine('server', 'lifecycle', warning);
    }
    if (existingHealthy && serverPath && !serviceIdentityMatches && !child) {
      const reason = formatServiceIdentityBlock(serviceIdentity);
      console.warn(`[kswarm-service] ${reason}`);
      logKSwarmServiceLine('server', 'lifecycle', `replacing stale service: ${reason}`);
      const killed = await replaceStalePortOwner();
      if (permanentlySealed || stopping) return;
      if (!killed) {
        lastError = `failed to kill stale kswarm service on port ${KSWARM_PORT}: ${reason}`;
        console.error(`[kswarm-service] ${lastError}`);
        logKSwarmServiceLine('server', 'lifecycle', lastError);
        executionReadIncarnation=Object.freeze({}); running = false;
        notifyListeners();
        return;
      }
      killedStale = true;
      logKSwarmServiceLine('server', 'lifecycle', `stale service killed, proceeding with spawn`);
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
      if (stopping) return;
      executionReadIncarnation=Object.freeze({}); running = true;
      lastError = null;
      restartCount = 0;
      healthFailureCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

    if (existingHealthy && !dynamicWorkflowReady && !killedStale && !child) {
      const reason = `existing kswarm service on port ${KSWARM_PORT} does not support dynamic workflows`;
      console.warn(`[kswarm-service] ${reason}`);
      logKSwarmServiceLine('server', 'lifecycle', `replacing incompatible service: ${reason}`);
      const killed = await replaceStalePortOwner();
      if (permanentlySealed || stopping) return;
      if (!killed) {
        lastError = `failed to kill incompatible kswarm service on port ${KSWARM_PORT}`;
        console.error(`[kswarm-service] ${lastError}`);
        logKSwarmServiceLine('server', 'lifecycle', lastError);
        executionReadIncarnation=Object.freeze({}); running = false;
        notifyListeners();
        return;
      }
      killedStale = true;
      logKSwarmServiceLine('server', 'lifecycle', `incompatible service killed, proceeding with spawn`);
    }

    if (existingHealthy && !killedStale && !child) {
      brokerReady = await ensureBroker();
      if (stopping) return;
      console.log(`[kswarm-service] Adopting existing kswarm service on port ${KSWARM_PORT}${brokerReady ? '' : ' (broker degraded)'}`);
      await reconcileSeedAgents();
      if (stopping) return;
      executionReadIncarnation=Object.freeze({}); running = true;
      lastError = brokerReady ? null : 'intent-broker health check failed';
      restartCount = 0;
      healthFailureCount = 0;
      startHealthCheck();
      notifyListeners();
      return;
    }

    }else serverPath=resolveServicePath('kswarm','src/server/index.js');
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
        ...buildSidecarEnv(process.env),
        KSWARM_PORT: String(KSWARM_PORT),
        BROKER_URL: `http://127.0.0.1:${BROKER_PORT}`,
        KSWARM_DESKTOP_MUTATION_TOKEN: desktopMutationToken,
        ...projectScopeEnv,
        INTENT_BROKER_KSWARM_TOKEN: kswarmRoomToken,
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
    if (stopping || child) return;
    console.log(`[kswarm-service] Spawning kswarm server: ${serverPath}`);
    logKSwarmServiceLine(
      'server',
      'lifecycle',
      `spawn command=${nodeRuntime.command} entryPath=${serverPath}`,
    );
    assertRoomWorkspaceSidecarProtocol(serverPath, 'kswarm');
    let serverChild:ChildProcess;
    if(protectedSource){
      const ticket=preparationFreeze(businessCreate(null)) as object;
      // Same original startup data as ordinary spawn, with explicit config/root
      // before the child's first business import. No executable or IO path is sent.
      const projected=buildSidecarEnv(nodeRuntime.env);delete projected.XIAOK_NODE_CMD;
      const environment=preparationFreeze({...projected,XIAOK_CONFIG_DIR:getConfigDir(),KSWARM_DATA_ROOT:nodeRuntime.env.KSWARM_DATA_ROOT||join(homedir(),'.kswarm')});
      businessApply(preparationWeakSet,protectedKSwarmStartups,[ticket,preparationFreeze({service,environment})]);
      serverChild=await createOriginalProtectedKSwarmServiceChild(service,ticket);
    }else serverChild = spawnProcess(nodeRuntime.command, [serverPath], buildKSwarmServerSpawnOptions({env:nodeRuntime.env}));
    ownedChildren.track(serverChild, 5_000);
    child = serverChild;
    if(scope&&(ownedBusinessAdmission||ownedPreparationSource||ownedDshAdmission)){
      const ordinaryLocal=()=>{if(permanentlySealed||stopping||!running||child!==serverChild)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');};
      const ordinary=()=>{ordinaryLocal();if(!serverChild.connected)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');ordinaryLocal();};
      const dshClientAdmission:KSwarmDshAdmission|undefined=ownedDshAdmission?(proof,audience)=>{ordinary();const raw=businessApply(ownedDshAdmission,undefined,[proof,audience]);if(raw!==undefined)return raw;ordinaryLocal();return undefined;}:undefined;
      const client=createOwnedKSwarmBusiness({child:serverChild,scope,serviceOwner:service,isCurrent:()=>child===serverChild&&serverChild.connected===true,...(dshClientAdmission?{dshAdmission:dshClientAdmission}:{}),...(ownedPreparationSource?{preparationSource:fixedPreparationSource,preparationAdmission:ownedPreparationAdmission,...(fixedHostSource?{hostSettlementSource:fixedHostSource}:{})}:{}),...(ownedBusinessAdmission?{admit(proof:object,audience:Parameters<KSwarmBusinessAdmission>[1]){
        ordinary();if(businessTypes.isProxy(ownedBusinessAdmission)||businessTypes.isAsyncFunction(ownedBusinessAdmission)||businessPrototype(ownedBusinessAdmission)===businessAsyncPrototype)throw Error('DISPATCH_BUSINESS_SYNCHRONOUS_ADMISSION_REQUIRED');
        // Every external child/current check precedes the final private
        // command proof. Only the original pure service fence follows it.
        ordinary();const raw=businessApply(ownedBusinessAdmission,undefined,[proof,audience]);if(raw!==undefined)return raw;ordinaryLocal();return undefined;
      }}:{})});
      const record:BusinessRecord=businessAssign(businessCreate(null),{child:serverChild,client,dshAdmission:dshClientAdmission,retirement:undefined,raw:undefined,failure:undefined,unknown:false,retired:false});ownedBusiness=record;businessClients.add(record);
      const port:KSwarmOwnedBusinessTransport=Object.freeze<KSwarmOwnedBusinessTransport>({
        prepareHello:()=>runBusiness(record,()=>{ordinary();return prepareOwnedKSwarmBusinessHello(client);}),
        assertHelloCurrent:value=>{ordinary();assertOwnedKSwarmBusinessHelloCurrent(client,value);},
        readPlan:(projectId,context)=>runBusiness(record,()=>{ordinary();return client.readPlan(projectId,context);}),
        captureDefaultDispatch:(projectId,input,context)=>runBusiness(record,()=>{ordinary();return client.captureDefaultDispatch(projectId,input,context);}),
        readOperation:(projectId,input,context)=>runBusiness(record,()=>{ordinary();return client.readOperation(projectId,input,context);}),
      });ownedBusinessPort=port;
      if(ownedDshAdmission){
        const fixedDshAdmission=dshClientAdmission;
        if(!fixedDshAdmission)throw Error('DSH_BUSINESS_FIXED_ADMISSION_REQUIRED');
        const facet=readOwnedKSwarmDshFacet(client,fixedDshAdmission);
        const entry=()=>{ordinary();if(record.retirement||ownedBusiness!==record)throw Error('DSH_BUSINESS_UNAVAILABLE');};
        const call=<T>(work:()=>Promise<T>)=>runBusiness(record,()=>{entry();return work();});
        ownedDshPort=Object.freeze<KSwarmOwnedDshTransport>({prepareHello:()=>call(()=>prepareOwnedKSwarmBusinessHello(client)),assertHelloCurrent(value:object){entry();assertOwnedKSwarmBusinessHelloCurrent(client,value);},prepareOwner:context=>call(()=>facet.prepareOwner(context)),readDomain:(input,context)=>call(()=>facet.readDomain(input,context)),applyControl:(input,context)=>call(()=>facet.applyControl(input,context)),applyCommand:(input,context)=>call(()=>facet.applyCommand(input,context)),prepareSlot:(input,context)=>call(()=>facet.prepareSlot(input,context)),readBasis:(input,context)=>call(()=>facet.readBasis(input,context)),readWork:(input,context)=>call(()=>facet.readWork(input,context)),readSlot:(input,context)=>call(()=>facet.readSlot(input,context)),stageDraft:(input,context)=>call(()=>facet.stageDraft(input,context)),commitDraft:(input,context)=>call(()=>facet.commitDraft(input,context)),readDraft:(input,context)=>call(()=>facet.readDraft(input,context))});
      }
      if(ownedPreparationSource&&ownedPreparationAdmission){
        const facet=readOwnedKSwarmPreparationFacet(client,fixedPreparationSource!,ownedPreparationAdmission);
        const entry=()=>{if(permanentlySealed||stopping||!running||record.retirement||ownedBusiness!==record||child!==serverChild)throw Error('DISPATCH_PREPARATION_UNAVAILABLE');};
        // Keep the genuine Work: its original client already owns RPC roots,
        // future ACK producers, SDK callbacks and the final prefix frontier.
        ownedPreparationPort=Object.freeze<KSwarmPreparationFacet>({openWork(projectId,lookup,context){entry();const work=facet.openWork(projectId,lookup,context);businessApply(preparationWeakSet,acceptedPreparationBindings,[work,readOwnedKSwarmPreparationWorkBinding(client,fixedPreparationSource!,ownedPreparationAdmission,work)]);entry();return work;}});
      }
    }
    ownedControl=scope?createKSwarmOwnedControl({child:serverChild,scope,serviceOwner:service,admit:ownedControlAdmission,isCurrent:()=>!permanentlySealed&&!stopping&&running&&child===serverChild}):undefined;
    if(ownedControl)ownedControls.add(ownedControl);

    serverChild.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[kswarm] ${msg}`);
        logKSwarmServiceLine('server', 'stdout', msg);
      }
    });

    serverChild.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[kswarm:err] ${msg}`);
        logKSwarmServiceLine('server', 'stderr', msg);
      }
    });

    serverChild.on('exit', (code, signal) => {
      const message = `Process exited: code=${code} signal=${signal}`;
      console.log(`[kswarm-service] ${message}`);
      logKSwarmServiceLine('server', 'lifecycle', message);
      if (child !== serverChild) return;
      sealOwnedControl();
      child = null;
      executionReadIncarnation=Object.freeze({}); running = false;
      if (!stopping && !suppressedServerExits.has(serverChild)) {
        const decision = classifyKSwarmExit(code);
        if (decision.action === 'terminal_degraded') {
          // Unrecoverable durable-state corruption: do NOT auto-restart, the same
          // state would loop forever. Enter a stable degraded state for diagnostics.
          terminalDegraded = transitionKSwarmTerminalDegraded(terminalDegraded, 'unrecoverable_exit');
          lastError = `KSwarm entered terminal degraded state (exit ${code}: ${decision.reason}); auto-restart disabled`;
          console.error(`[kswarm-service] ${lastError}`);
          logKSwarmServiceLine('server', 'lifecycle', lastError);
          notifyListeners();
          return;
        }
        if (decision.action === 'limited_restart') {
          persistenceFailStopCount += 1;
          lastPersistenceFailStop = `KSwarm fail-stop (exit ${code}: ${decision.reason})`;
          lastError = `${lastPersistenceFailStop}; restarting from last durable revision`;
          logKSwarmServiceLine('server', 'lifecycle', lastError);
          if (shouldStopAfterPersistenceFailStops(persistenceFailStopCount)) {
            lastError = `${lastPersistenceFailStop}; maximum limited restarts (${MAX_PERSISTENCE_FAIL_STOP_RESTARTS}) reached`;
            notifyListeners();
            return;
          }
        } else {
          lastError = `Process exited with code ${code}`;
        }
        notifyListeners();
        scheduleRestart();
      }
    });

    serverChild.on('error', (err) => {
      console.error('[kswarm-service] Spawn error:', err.message);
      logKSwarmServiceLine('server', 'lifecycle', `Spawn error: ${err.message}`);
      lastError = err.message;
      if (child !== serverChild) return;
      sealOwnedControl();
      child = null;
      executionReadIncarnation=Object.freeze({}); running = false;
      notifyListeners();
      if (!stopping) scheduleRestart();
    });

    // Wait for health check to confirm server is ready
    const ready = await waitForReady(8_000);
    if (ready && !stopping && child === serverChild) {
      await reconcileSeedAgents();
      if (stopping || child !== serverChild) return;
      executionReadIncarnation=Object.freeze({}); running = true;
      lastError = null;
      restartCount = 0; // Reset on successful start
      healthFailureCount = 0;
      terminalDegraded = transitionKSwarmTerminalDegraded(terminalDegraded, 'ready');
      console.log(`[kswarm-service] Server ready on port ${KSWARM_PORT}`);
      logKSwarmServiceLine('server', 'lifecycle', `Server ready on port ${KSWARM_PORT}`);
      startHealthCheck();
      notifyListeners();
    } else if (!stopping) {
      sealOwnedControl();
      console.log('[kswarm-service] Server did not become ready in time');
      logKSwarmServiceLine('server', 'lifecycle', 'Server did not become ready in time');
      lastError = 'Server startup timeout';
      executionReadIncarnation=Object.freeze({}); running = false;
      notifyListeners();
      await killOwnedServer();
      if (!stopping) scheduleRestart();
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
    await start();
  }

  async function request(path: string, init?: RequestInit,beforeEffects?:()=>void): Promise<Response> {
    assertMetadataCleanupKnown();
    assertBeforeEffects(beforeEffects);
    await ensureReady();
    assertMetadataCleanupKnown();assertBeforeEffects(beforeEffects);

    if (!running) {
      throw new KSwarmUnavailableError(lastError || 'KSwarm service failed to start');
    }

    return requestWithFallbackBaseUrls({
      baseUrls: KSWARM_REQUEST_BASE_URLS,
      path,
      init,
      timeoutMs: REQUEST_TIMEOUT_MS,
      beforeEffects:()=>{assertMetadataCleanupKnown();assertBeforeEffects(beforeEffects);},
    });
  }

  async function submitTaskMetadataOnce(projectId:string,envelope:unknown,context:{requestSource:'user'|'agent'|'scheduler';signal:AbortSignal;beforeEffects?:()=>void}){
    if(context?.requestSource!=='user')throw Error('kswarm_metadata_submission_forbidden');
    if(typeof projectId!=='string'||!projectId||projectId.length>256||projectId.trim()!==projectId||projectId.includes('\0'))throw Error('kswarm_metadata_submission_invalid');
    if(!projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID||!projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID||!desktopMutationToken)throw Error('kswarm_metadata_submission_scope_unavailable');
    const data=captureIpcData(envelope,'kswarm_metadata_submission_invalid') as Record<string,unknown>,keys=['protocol','source','input','initialPlanClaim'];
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==keys.length||Object.keys(data).some(key=>!keys.includes(key))||data.protocol!=='ordinary_task_metadata_input_v2')throw Error('kswarm_metadata_submission_invalid');
    const body=canonicalVerificationJson(data);if(Buffer.byteLength(body,'utf8')>8388608)throw Error('kswarm_metadata_submission_too_large');
    const deadline=new AbortController(),signal=AbortSignal.any([context.signal,closeAbort.signal,deadline.signal]);
    const timer=setTimeout(()=>deadline.abort(Error('kswarm_metadata_submission_timeout')),30_000);
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,cancelWork:Promise<void>|undefined;
    let complete=false,failed=false,cleanupUnknown=false,failure:unknown,result:{ok:boolean;status:number;body:unknown}|undefined,snapshot:{incarnation:object;child:ChildProcess|null;restartCount:number}|undefined;
    const current=()=>{
      assertMetadataCleanupKnown();signal.throwIfAborted();assertBeforeEffects(context.beforeEffects);
      if(permanentlySealed||stopping)throw Error('kswarm_metadata_submission_closed');
      if(snapshot&&(!running||snapshot.incarnation!==executionReadIncarnation||snapshot.child!==child||snapshot.restartCount!==restartCount))throw Error('kswarm_metadata_submission_source_changed');
    };
    const cancel=()=>{if(reader&&!cancelWork){try{cancelWork=reader.cancel(signal.reason);}catch(error){cancelWork=Promise.reject(error);}void cancelWork.catch(()=>{});}};
    signal.addEventListener('abort',cancel);
    try{
      current();await ensureReady();current();if(!running)throw Error('kswarm_metadata_submission_unavailable');snapshot={incarnation:executionReadIncarnation,child,restartCount};current();
      // Deliberately one fixed endpoint, no redirects and no address fallback.
      // A lost POST ACK is reconciled with original GETs by the job owner.
      const dispatch=fetch;current();
      response=await Reflect.apply(dispatch,globalThis,[KSWARM_REQUEST_BASE_URLS[0]+`/projects/${encodeURIComponent(projectId)}/task-metadata-inputs`,{method:'POST',redirect:'error',signal,headers:{'content-type':'application/json','x-kswarm-mutation-token':desktopMutationToken},body}]) as Response;
      current();const redirected=response.redirected;current();const stream=response.body;current();if(redirected||!stream)throw Error('kswarm_metadata_submission_response_invalid');
      const acquire=stream.getReader;current();reader=Reflect.apply(acquire,stream,[]) as ReadableStreamDefaultReader<Uint8Array>;const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){const next=reader.read;current();const part=await Reflect.apply(next,reader,[]) as ReadableStreamReadResult<Uint8Array>;current();if(part.done){complete=true;break;}bytes+=part.value.byteLength;if(bytes>8388608)throw Error('kswarm_metadata_submission_response_too_large');chunks.push(part.value);}
      const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));current();result={ok:response.ok,status:response.status,body:value};
    }catch(error){failed=true;failure=signal.aborted&&!Object.is(error,signal.reason)?new AggregateError([signal.reason,error],'kswarm_metadata_submission_control_and_transport_failed',{cause:signal.reason}):error;}
    finally{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);
      try{if(!complete&&response?.body&&!cancelWork){try{cancelWork=reader?reader.cancel(signal.reason):response.body.cancel(signal.reason);}catch(error){cancelWork=Promise.reject(error);}}if(cancelWork)await cancelWork;}
      catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_metadata_submission_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
      try{reader?.releaseLock();}catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_metadata_submission_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
    }
    if(cleanupUnknown)metadataCleanupObligations.add({response,reader,error:failure});
    if(failed)throw failure;current();if(!result)throw Error('kswarm_metadata_submission_response_invalid');return result;
  }

  function captureProjectActivitySubject(subject:KSwarmProjectActivitySubject):KSwarmProjectActivitySubject{
    const input=captureIpcData(subject,'kswarm_activity_read_subject_invalid');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||Object.keys(input).some(key=>!['projectId','sourceDataEpoch','after'].includes(key))
      ||typeof input.projectId!=='string'||!input.projectId||input.projectId.length>256||input.projectId.trim()!==input.projectId||input.projectId.includes('\0')
      ||typeof input.sourceDataEpoch!=='string'||!input.sourceDataEpoch||input.sourceDataEpoch.length>256||input.sourceDataEpoch.includes('\0')
      ||!Number.isSafeInteger(input.after)||Number(input.after)<0)throw Error('kswarm_activity_read_subject_invalid');
    return Object.freeze({projectId:input.projectId,sourceDataEpoch:input.sourceDataEpoch,after:Number(input.after)});
  }
  function readProjectActivity(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext,scoped:true):Promise<KSwarmScopedProjectActivityRead>;
  function readProjectActivity(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext,scoped:'source'):Promise<KSwarmProjectSourceActivityRead>;
  function readProjectActivity(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext,scoped?:false):Promise<KSwarmProjectActivityRead>;
  async function readProjectActivity(subject:KSwarmProjectActivitySubject,context:KSwarmProjectActivityReadContext,scoped:false|true|'source'=false):Promise<KSwarmProjectActivityRead|KSwarmScopedProjectActivityRead|KSwarmProjectSourceActivityRead>{
    if(!context||!['user','scheduler'].includes(context.requestSource))throw Error('kswarm_activity_read_forbidden');
    const expected=captureProjectActivitySubject(subject),beforeEffects=context.beforeEffects;
    if(!(context.signal instanceof AbortSignal))throw Error('kswarm_activity_read_subject_invalid');
    if(!projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID||!projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID||!desktopMutationToken)throw Error('kswarm_activity_read_scope_unavailable');
    if(scoped&&![projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID,projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID].every(value=>/^[a-f0-9]{64}$/.test(value)))throw Error('kswarm_activity_read_scope_unavailable');
    const source=scoped==='source',sourceControl=activitySourceControl,deadline=new AbortController(),signal=AbortSignal.any([context.signal,closeAbort.signal,deadline.signal,...(source?[sourceControl.signal]:[])]);
    const timer=setTimeout(()=>deadline.abort(Error('kswarm_activity_read_timeout')),30_000);
    let response:Response|undefined,body:ReadableStream<Uint8Array>|null|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,cancelWork:Promise<void>|undefined;
    let complete=false,failed=false,cleanupUnknown=false,failure:unknown,page:ParsedProjectActivityPage|undefined,scopedPage:ParsedScopedProjectActivityPage|undefined,instance:string|null= null,profile:string|null=null,snapshot:{incarnation:object;child:ChildProcess|null;restartCount:number;sourceInstance:string|undefined;sourceObservation:object;sourceKnownInstance:string|undefined;sourceControl:AbortController}|undefined;
    const current=()=>{
      assertMetadataCleanupKnown();signal.throwIfAborted();assertBeforeEffects(beforeEffects);
      if(permanentlySealed||stopping)throw Error('kswarm_activity_read_closed');
      if(snapshot&&(!running||snapshot.incarnation!==executionReadIncarnation||snapshot.child!==child||snapshot.restartCount!==restartCount||source&&snapshot.sourceControl!==activitySourceControl||!source&&(snapshot.sourceInstance!==activitySourceInstance||snapshot.sourceObservation!==activitySourceObservation)))throw Error('kswarm_activity_read_source_changed');
    };
    const cancel=()=>{if(reader&&!cancelWork){try{cancelWork=reader.cancel(signal.reason);}catch(error){cancelWork=Promise.reject(error);}void cancelWork.catch(()=>{});}};
    signal.addEventListener('abort',cancel);
    try{
      current();await ensureReady();current();if(!running)throw Error('kswarm_activity_read_unavailable');
      if(!activitySourceInstance&&!source)throw Error('kswarm_activity_read_instance_unavailable');
      snapshot={incarnation:executionReadIncarnation,child,restartCount,sourceInstance:activitySourceInstance,sourceObservation:activitySourceObservation,sourceKnownInstance:activitySourceKnownInstance,sourceControl};current();
      const transportFailures:unknown[]=[];
      try{
        response=await requestWithFallbackBaseUrls({baseUrls:KSWARM_REQUEST_BASE_URLS,path:`/projects/${encodeURIComponent(expected.projectId)}/activity?after=${expected.after}&limit=200`,
          init:{method:'GET',redirect:'error',headers:{'x-kswarm-mutation-token':desktopMutationToken,...(source?{'x-kswarm-source-read':'project_source_v1'}:scoped?{'x-kswarm-activity-profile':'project_delivery_v1'}:{})}},timeoutMs:REQUEST_TIMEOUT_MS,beforeEffects:current,
          fetchImpl:async(url,init)=>{const dispatch=fetch;current();try{return await Reflect.apply(dispatch,globalThis,[url,{...init,signal:AbortSignal.any(init?.signal?[signal,init.signal]:[signal])}]);}catch(error){transportFailures.push(error);throw error;}}});
      }catch(error){if(transportFailures.length)throw new AggregateError([...transportFailures,error],'kswarm_activity_read_transport_failed',{cause:transportFailures.at(-1)});throw error;}
      current();const redirected=response.redirected;current();
      // Denied scoped reads have no success echoes. Their HTTP refusal cannot
      // revoke another legitimate project's existing metadata instance pin.
      if(scoped){const ok=response.ok,status=response.status;current();if(!ok)throw Error(`kswarm_activity_read_http_${status}`);}
      const headers=response.headers,getInstance=headers.get;current();instance=Reflect.apply(getInstance,headers,['x-kswarm-source-instance']) as string|null;current();
      if(source){
        if(instance&&snapshot.sourceKnownInstance&&instance!==snapshot.sourceKnownInstance){const error=Error('kswarm_activity_read_instance_changed');activitySourceInstance=undefined;activitySourceObservation=Object.freeze({});invalidateActivitySourceControl(error);throw error;}
        if(!instance){activitySourceInstance=undefined;activitySourceObservation=Object.freeze({});}
      }else if(instance!==snapshot.sourceInstance){const error=Error('kswarm_activity_read_instance_changed');activitySourceInstance=undefined;activitySourceObservation=Object.freeze({});if(instance)invalidateActivitySourceControl(error);throw error;}
      if(scoped){const getProfile=headers.get;current();profile=Reflect.apply(getProfile,headers,['x-kswarm-activity-profile']) as string|null;current();if(profile!=='project_delivery_v1'&&!(source&&!profile))throw Error('kswarm_activity_read_profile_unsupported');}
      body=response.body;current();if(redirected||!body)throw Error('kswarm_activity_read_response_invalid');
      const acquire=body.getReader;current();reader=Reflect.apply(acquire,body,[]) as ReadableStreamDefaultReader<Uint8Array>;
      const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){const next=reader.read;current();const part=await Reflect.apply(next,reader,[]) as ReadableStreamReadResult<Uint8Array>;current();if(part.done){complete=true;break;}bytes+=part.value.byteLength;if(bytes>PROJECT_ACTIVITY_BODY_LIMIT)throw Error('kswarm_activity_read_body_too_large');chunks.push(part.value);}
      const ok=response.ok,status=response.status;current();if(!ok)throw Error(`kswarm_activity_read_http_${status}`);
      const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
      if(scoped&&profile==='project_delivery_v1'){scopedPage=parseScopedProjectActivityPage(data,{...expected,profileId:projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID,workspaceId:projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID});page=scopedPage.page;}
      else page=parseProjectActivityPage(data,expected);current();
    }catch(error){
      failed=true;failure=error;
      try{current();}catch(control){if(!Object.is(control,error))failure=new AggregateError([error,control],'kswarm_activity_read_and_control_failed',{cause:error});}
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);
      try{if(!complete&&response&&!cancelWork){const remaining=body??response.body;if(remaining){try{cancelWork=reader?reader.cancel(signal.reason):remaining.cancel(signal.reason);}catch(error){cancelWork=Promise.reject(error);}}}if(cancelWork)await cancelWork;}
      catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_activity_read_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
      try{reader?.releaseLock();}catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_activity_read_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
    }
    if(cleanupUnknown)metadataCleanupObligations.add({response,reader,error:failure});
    if(failed)throw failure;current();if(!page||!snapshot)throw Error('kswarm_activity_read_response_invalid');
    const freeze=(value:unknown):void=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}};
    freeze(page);let scopedBinding:ScopedActivityBinding|undefined;
    if(scopedPage){scopedBinding={protocol:scopedPage.protocol,projectId:scopedPage.projectId,scope:scopedPage.scope,bindingDigest:scopedPage.bindingDigest};freeze(scopedBinding);}
    if(source){
      let metadata:KSwarmScopedProjectActivityRead|undefined;
      if(scopedBinding&&snapshot.sourceInstance&&instance===snapshot.sourceInstance&&activitySourceInstance===snapshot.sourceInstance&&activitySourceObservation===snapshot.sourceObservation){
        metadata=Object.freeze({kind:'kswarm_scoped_project_activity_read_v1' as const,subject:expected,page,...scopedBinding});
        activityReadReceipts.set(metadata,{subject:expected,...snapshot,sourceInstance:snapshot.sourceInstance,signal,beforeEffects,scopedBinding});
      }
      const ordinaryPage={...page,delivery:{status:'unavailable' as const,reasonCode:'SNAPSHOT_INCOMPLETE' as const}};freeze(ordinaryPage);
      const receipt=Object.freeze({kind:'kswarm_project_source_activity_read_v1' as const,subject:expected,page:ordinaryPage,...(metadata?{scoped:metadata}:{})});
      activitySourceReceipts.set(receipt,{subject:expected,...snapshot,signal,beforeEffects});assertProjectSourceActivityRead(expected,receipt);return receipt;
    }
    if(!snapshot.sourceInstance)throw Error('kswarm_activity_read_instance_unavailable');
    const receipt=scopedBinding?Object.freeze({kind:'kswarm_scoped_project_activity_read_v1' as const,subject:expected,page,...scopedBinding}):Object.freeze({kind:'kswarm_project_activity_read_v1' as const,subject:expected,page});
    activityReadReceipts.set(receipt,{subject:expected,...snapshot,sourceInstance:snapshot.sourceInstance,signal,beforeEffects,...(scopedBinding?{scopedBinding}:{})});return receipt;
  }
  function assertProjectSourceActivityRead(subject:KSwarmProjectActivitySubject,receipt:KSwarmProjectSourceActivityRead):void{
    assertMetadataCleanupKnown();const expected=captureProjectActivitySubject(subject),record=receipt&&typeof receipt==='object'?activitySourceReceipts.get(receipt):undefined;
    if(!record)throw Error('kswarm_activity_read_not_current');
    const check=()=>{
      assertMetadataCleanupKnown();
      if(permanentlySealed||stopping||!running||closeAbort.signal.aborted||record.signal.aborted||record.sourceControl!==activitySourceControl||record.incarnation!==executionReadIncarnation||record.child!==child||record.restartCount!==restartCount
        ||record.subject.projectId!==expected.projectId||record.subject.sourceDataEpoch!==expected.sourceDataEpoch||record.subject.after!==expected.after)throw Error('kswarm_activity_read_not_current');
    };
    check();assertBeforeEffects(record.beforeEffects);check();
  }
  function assertProjectActivityRead(subject:KSwarmProjectActivitySubject,receipt:KSwarmProjectActivityRead|KSwarmScopedProjectActivityRead,scoped=false):void{
    assertMetadataCleanupKnown();const expected=captureProjectActivitySubject(subject),record=receipt&&typeof receipt==='object'?activityReadReceipts.get(receipt):undefined;
    if(!record)throw Error('kswarm_activity_read_not_current');
    const check=()=>{
      assertMetadataCleanupKnown();
      if(scoped&&(!record.scopedBinding||record.scopedBinding.protocol!=='scoped_project_activity_v1'||record.scopedBinding.projectId!==expected.projectId
        ||record.scopedBinding.scope.profileId!==projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID||record.scopedBinding.scope.workspaceId!==projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID))throw Error('kswarm_activity_read_not_current');
      if(permanentlySealed||closeAbort.signal.aborted||record.signal.aborted||!running||stopping||record.incarnation!==executionReadIncarnation||record.child!==child||record.restartCount!==restartCount||record.sourceInstance!==activitySourceInstance||record.sourceObservation!==activitySourceObservation
        ||expected.projectId!==record.subject.projectId||expected.sourceDataEpoch!==record.subject.sourceDataEpoch||expected.after!==record.subject.after)throw Error('kswarm_activity_read_not_current');
    };
    check();assertBeforeEffects(record.beforeEffects);check();
  }

  // This read belongs to the original ingress through headers, body, parse
  // and cancellation cleanup. No timeout race can release its raw tail early.
  async function readProjectExecutionStart(projectId:string):Promise<KSwarmExecutionStartRead>{
    if(typeof projectId!=='string'||!projectId||projectId.length>256||projectId.trim()!==projectId||projectId.includes('\0'))throw Error('kswarm_execution_read_subject_invalid');
    const expectedScope={profileId:projectScopeEnv.KSWARM_DESKTOP_PROFILE_ID,workspaceId:projectScopeEnv.KSWARM_DESKTOP_WORKSPACE_ID};
    if(!expectedScope.profileId||!expectedScope.workspaceId||!desktopMutationToken)throw Error('kswarm_execution_read_scope_unavailable');
    const controller=new AbortController();
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,cancelWork:Promise<void>|undefined;
    let complete=false,failed=false,cleanupUnknown=false,failure:unknown,result:KSwarmExecutionStartRead|undefined,snapshot:{incarnation:object;child:ChildProcess|null;restartCount:number}|undefined;
    const cancel=()=>{
      if(reader&&!cancelWork){try{cancelWork=reader.cancel(controller.signal.reason);}catch(error){cancelWork=Promise.reject(error);}void cancelWork.catch(()=>{});}
    };
    const abort=()=>controller.abort(Error('kswarm_execution_read_closed'));
    const timer=setTimeout(()=>controller.abort(Error('kswarm_execution_read_timeout')),30_000);
    closeAbort.signal.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',cancel);
    const current=()=>{
      assertMetadataCleanupKnown();if(permanentlySealed||closeAbort.signal.aborted)throw Error('kswarm_execution_read_closed');
      controller.signal.throwIfAborted();
      if(snapshot&&(!running||stopping||snapshot.incarnation!==executionReadIncarnation||snapshot.child!==child||snapshot.restartCount!==restartCount))throw Error('kswarm_execution_read_source_changed');
    };
    try{
      current();await ensureReady();current();
      snapshot={incarnation:executionReadIncarnation,child,restartCount};current();
      const transportFailures:unknown[]=[];
      try{
        response=await requestWithFallbackBaseUrls({baseUrls:KSWARM_REQUEST_BASE_URLS,
          path:`/projects/${encodeURIComponent(projectId)}/execution-start-admission`,
          init:{method:'GET',redirect:'error',headers:{'x-kswarm-mutation-token':desktopMutationToken}},timeoutMs:REQUEST_TIMEOUT_MS,
          fetchImpl:async(url,init)=>{
            // The common address fallback is another producer boundary. A
            // stopped/replaced read must not issue its next HTTP request.
            current();
            const dispatch=fetch;current();
            try{return await Reflect.apply(dispatch,globalThis,[url,{...init,signal:AbortSignal.any(init?.signal?[controller.signal,init.signal]:[controller.signal])}]) as Response;}
            catch(error){transportFailures.push(error);throw error;}
          }});
      }catch(error){
        if(transportFailures.length)throw new AggregateError([...transportFailures,error],'kswarm_execution_read_transport_failed',{cause:transportFailures.at(-1)});
        throw error;
      }
      current();const redirected=response.redirected;current();const body=response.body;current();if(redirected||!body)throw Error('kswarm_execution_read_unavailable');
      const acquire=body.getReader;current();reader=Reflect.apply(acquire,body,[]) as ReadableStreamDefaultReader<Uint8Array>;const chunks:Uint8Array[]=[];let bytes=0;
      for(;;){const next=reader.read;current();const part=await Reflect.apply(next,reader,[]) as ReadableStreamReadResult<Uint8Array>;current();if(part.done){complete=true;break;}
        bytes+=part.value.byteLength;if(bytes>8192)throw Error('kswarm_execution_read_body_too_large');chunks.push(part.value);
      }
      const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));current();
      const record=(input:unknown):Record<string,unknown>=>{if(!input||typeof input!=='object'||Array.isArray(input))throw Error('kswarm_execution_read_invalid');return input as Record<string,unknown>;};
      const row=record(value);
      if(!response.ok){if(Object.keys(row).length===2&&row.ok===false&&typeof row.error==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(row.error))throw Error(row.error);throw Error('kswarm_execution_read_unavailable');}
      const keys=['ok','protocol','projectId','classification','bindingDigest','scope'];
      if(Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key))||row.ok!==true||row.protocol!=='ordinary_project_execution_start_read_v1'||row.projectId!==projectId
        ||typeof row.classification!=='string'||!['legacy_ordinary','ordinary','ordinary_initial_plan_additive_v1'].includes(row.classification))throw Error('kswarm_execution_read_invalid');
      const scope=record(row.scope);
      if(Object.keys(scope).length!==2||scope.profileId!==expectedScope.profileId||scope.workspaceId!==expectedScope.workspaceId)throw Error('kswarm_execution_read_scope_mismatch');
      if(row.classification==='legacy_ordinary'?row.bindingDigest!==null:typeof row.bindingDigest!=='string'||!/^[a-f0-9]{64}$/.test(row.bindingDigest))throw Error('kswarm_execution_read_invalid');
      result=Object.freeze({ok:true,protocol:'ordinary_project_execution_start_read_v1',projectId,
        classification:row.classification as KSwarmExecutionStartRead['classification'],bindingDigest:row.bindingDigest as string|null,scope:Object.freeze({...expectedScope})});
    }catch(error){failed=true;failure=error;}
    finally{
      clearTimeout(timer);closeAbort.signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancel);
      try{
        if(!complete&&response?.body&&!cancelWork){try{cancelWork=reader?reader.cancel(controller.signal.reason):response.body.cancel(controller.signal.reason);}catch(error){cancelWork=Promise.reject(error);}}
        if(cancelWork)await cancelWork;
      }catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_execution_read_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
      try{reader?.releaseLock();}catch(cleanup){cleanupUnknown=true;failure=new AggregateError(failed?[failure,cleanup]:[cleanup],'kswarm_execution_read_cleanup_unconfirmed',{cause:failed?failure:cleanup});failed=true;}
    }
    if(cleanupUnknown)metadataCleanupObligations.add({response,reader,error:failure});
    if(failed)throw failure;
    if(!result||!snapshot)throw Error('kswarm_execution_read_invalid');
    current();executionReadReceipts.set(result,snapshot);return result;
  }
  function assertProjectExecutionStartRead(projectId:string,receipt:KSwarmExecutionStartRead):void{
    const snapshot=receipt&&typeof receipt==='object'?executionReadReceipts.get(receipt):undefined;
    if(metadataCleanupObligations.size||!snapshot||receipt.projectId!==projectId||permanentlySealed||closeAbort.signal.aborted||!running||stopping
      ||snapshot.incarnation!==executionReadIncarnation||snapshot.child!==child||snapshot.restartCount!==restartCount)throw Error('kswarm_execution_read_not_current');
  }

  function getDesktopMutationToken(): string {
    assertMetadataCleanupKnown();
    return desktopMutationToken;
  }

  function getIntentBrokerRoomToken(): string {
    return desktopRoomToken;
  }

  async function start(): Promise<void> {
    const requestedWhileStopping = stopping;
    const inFlightStop = stopPromise;
    if (inFlightStop) {
      await inFlightStop;
    }
    clearRestartTimer();
    if (running) return;
    const inFlightStart = startingPromise;
    if (inFlightStart) {
      await inFlightStart.catch(() => undefined);
      if (running || child) return;
      if (stopping && !requestedWhileStopping) return;
    }
    if (child) return;
    if (terminalDegraded || shouldStopAfterPersistenceFailStops(persistenceFailStopCount)) {
      throw new KSwarmUnavailableError(lastError || 'KSwarm automatic restart is blocked pending manual recovery');
    }
    if (stopping && !requestedWhileStopping) return;
    stopping = false;
    restartCount = 0;
    healthFailureCount = 0;
    lastError = null;
    await spawnServerOnce();
  }

  async function stop(): Promise<void> {
    sealOwnedControl();
    executionReadIncarnation=Object.freeze({});
    if (stopPromise) {
      await stopPromise;
      return;
    }
    stopping = true;
    stopPromise = (async () => {
      stopHealthCheck();
      clearRestartTimer();
      const errors:unknown[]=[];
      if (!activityDelegated && !activityOwner) {
        try{await killOwnedServer();}catch(error){appendIntrinsic(errors,error);}
        try{await stopOwnedBroker();}catch(error){appendIntrinsic(errors,error);}
      }
      executionReadIncarnation=Object.freeze({}); running = false;
      healthFailureCount = 0;
      notifyListeners();
      if(errors.length)throw aggregateIntrinsicErrors(errors,'kswarm_service_stop_unconfirmed');
    })().finally(() => {
      stopPromise = null;
    });
    await stopPromise;
  }

  async function killOwnedServer(): Promise<void> {
    sealOwnedControl();
    if (activityDelegated || activityOwner) throw new Error('activity_source_stop_delegated');
    const ownedChild = child;
    const retirementErrors=businessClients.size?await drainBusinessRecords():[];
    if(hasOriginalProtectedKSwarmService(service)){
      let first:{raw:unknown}|undefined;try{await closeOriginalProtectedKSwarmService(service);}catch(raw){first={raw};}
      if(child===ownedChild)child=null;
      if(first)throw first.raw;if(retirementErrors.length)throw aggregateIntrinsicErrors(retirementErrors,'kswarm_business_retirement_failed');return;
    }
    if (!ownedChild) {if(retirementErrors.length)throw aggregateIntrinsicErrors(retirementErrors,'kswarm_business_retirement_failed');return;}
    suppressedServerExits.add(ownedChild);
    let onExit!: () => void;
    let timer!: ReturnType<typeof setTimeout>;
    const exitPromise = new Promise<void>(resolve => {
      onExit = resolve;
      ownedChild.once('exit', onExit);
      timer = setTimeout(resolve, 5_000);
    });
    try {
      ownedChild.kill('SIGTERM');
      await exitPromise;
      if (child === ownedChild) { ownedChild.kill('SIGKILL'); child = null; }
    } finally {
      clearTimeout(timer);
      ownedChild.removeListener('exit', onExit);
    }
    if(retirementErrors.length)throw aggregateIntrinsicErrors(retirementErrors,'kswarm_business_retirement_failed');
  }

  async function restart(): Promise<void> {
    sealOwnedControl();
    executionReadIncarnation=Object.freeze({});
    if (activityOwner) {
      await activityOwner.request('sourceRestart', { name: 'kswarm', ownerEpoch: activityOwner.ownerEpoch });
      executionReadIncarnation=Object.freeze({}); running = false; stopping = false; await spawnServerOnce(); return;
    }
    await stop();
    const inFlightStart = startingPromise;
    if (inFlightStart) {
      await inFlightStart.catch(() => undefined);
    }
    stopping = false;
    restartCount = 0;
    persistenceFailStopCount = 0;
    lastPersistenceFailStop = null;
    terminalDegraded = false;
    await spawnServerOnce();
  }

  async function stopOwnedBroker(): Promise<void> {
    if(hasOriginalProtectedBrokerService(service)){await closeOriginalProtectedBrokerService(service);brokerChild=null;return;}
    if (activityDelegated || activityOwner) throw new Error('activity_source_stop_delegated');
    if (!brokerChild) return;
    const ownedBroker = brokerChild;
    let onExit!: () => void;
    let timer!: ReturnType<typeof setTimeout>;
    const exitPromise = new Promise<void>(resolve => {
      onExit = resolve;
      ownedBroker.once('exit', onExit);
      timer = setTimeout(resolve, 3_000);
    });
    try {
      ownedBroker.kill('SIGTERM');
      await exitPromise;
      if (brokerChild === ownedBroker) { ownedBroker.kill('SIGKILL'); brokerChild = null; }
    } finally {
      clearTimeout(timer);
      ownedBroker.removeListener('exit', onExit);
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

  async function activityOwnerConfig() {
      const serverPath = resolveServicePath('kswarm', 'src/server/index.js');
      const brokerLaunch = resolveBrokerLaunchSpec();
      if (!serverPath || !brokerLaunch) throw new Error('activity_source_entry_unavailable');
      assertRoomWorkspaceSidecarProtocol(serverPath, 'kswarm');
      assertRoomWorkspaceSidecarProtocol(brokerLaunch.entryPath, 'intent-broker');
      mkdirSync(brokerLaunch.cwd, { recursive: true });
      const brokerEnv = buildIntentBrokerServiceEnv({ baseEnv: buildSidecarEnv(process.env), cwd: brokerLaunch.cwd, port: BROKER_PORT,
        repoRoot: brokerLaunch.repoRoot, desktopRoomToken, kswarmRoomToken });
      const brokerRuntime = resolveBackgroundNodeRuntime({ env: brokerEnv });
      const ksEnv = resolveBackgroundNodeRuntime({ env: { ...buildSidecarEnv(process.env), KSWARM_PORT: String(KSWARM_PORT),
        BROKER_URL: `http://127.0.0.1:${BROKER_PORT}`, KSWARM_DESKTOP_MUTATION_TOKEN: desktopMutationToken, INTENT_BROKER_KSWARM_TOKEN: kswarmRoomToken, ...projectScopeEnv } });
      const strings = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter((item): item is [string,string] => typeof item[1] === 'string'));
      const expected = (entry: string) => ({ ok: true, 'service.entryPath': resolve(entry), 'service.entryHash': createHash('sha256').update(readFileSync(entry)).digest('hex') });
      return { kswarm: { url: `http://127.0.0.1:${KSWARM_PORT}`, mutationToken: desktopMutationToken,
        brokerUrl: `http://127.0.0.1:${BROKER_PORT}`, roomToken: desktopRoomToken }, managedSources: [
        { name: 'broker' as const, executable: brokerRuntime.command, entryPath: brokerLaunch.entryPath, args: brokerLaunch.nodeArgs,
          cwd: brokerLaunch.cwd, env: strings(brokerRuntime.env), healthUrl: `http://127.0.0.1:${BROKER_PORT}/health`, expectedHealth: expected(brokerLaunch.entryPath) },
        { name: 'kswarm' as const, executable: ksEnv.command, entryPath: serverPath, cwd: dirname(dirname(dirname(serverPath))),
          env: strings(ksEnv.env), healthUrl: `http://127.0.0.1:${KSWARM_PORT}/health`, expectedHealth: expected(serverPath) },
      ] };
  }
  function bindActivityOwner(client: ConversationActivityOwnerClient) {
      sealOwnedControl();
      executionReadIncarnation=Object.freeze({});
      if (child || brokerChild || startingPromise) throw new Error('activity_source_handoff_required');
      if(businessCalls.size)throw Error('activity_source_business_handoff_pending');
      const records=businessClients.snapshot();for(let i=0;i<records.length;i++)if(!records[i]!.retired)throw Error('activity_source_business_handoff_pending');
      activityOwner = client; activityDelegated = true;
      }
  function sealAndDrain(): Promise<void> {
    if (closing) return closing;
    let resolveClosing!:()=>void;let rejectClosing!:(reason:unknown)=>void;
    closing=new Promise<void>((resolve,reject)=>{resolveClosing=resolve;rejectClosing=reject;});
    permanentlySealed = true;
    sealOwnedControl();
    const readPort=workflowReadPorts.get(service);
    const readDrain=readPort?closeSdk(closeNativeWorkflowReadPort,undefined,[readPort.port]):Promise.resolve();
    const brokerStartup=hasOriginalProtectedBrokerService(service)?closeSdk(sealOriginalProtectedBrokerServiceStartup,undefined,[service]):Promise.resolve();
    const drains = [brokerStartup, readDrain, closeSdk(ingress.close,ingress,[]), closeSdk(background.close,background,[])];
    void Promise.allSettled(drains).then(async outcomes => {
      const errors:unknown[]=[];for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i]!;if(outcome.status==='rejected'){legacyCloseUnknown=true;appendIntrinsic(errors,outcome.reason);}}
      const obligations=metadataCleanupObligations.snapshot();for(let i=0;i<obligations.length;i++){const obligation=obligations[i]!;let found=false;for(let n=0;n<errors.length;n++)if(errors[n]===obligation.error)found=true;if(!found)appendIntrinsic(errors,obligation.error);}
      stopping = true;
      if(businessClients.size){const businessErrors=await closeSdk<unknown[]>(drainBusinessRecords,undefined,[true]);if(businessErrors.length)legacyCloseUnknown=true;for(let i=0;i<businessErrors.length;i++)appendIntrinsic(errors,businessErrors[i]);}
      const sourceClosers:Function[]=[];
      if(hasOriginalProtectedKSwarmService(service))appendIntrinsic(sourceClosers,closeOriginalProtectedKSwarmService);
      if(hasOriginalProtectedBrokerService(service))appendIntrinsic(sourceClosers,closeOriginalProtectedBrokerService);
      const sourceOutcomes=await settleIntrinsicOperations(sourceClosers,fn=>closeSdk(fn,undefined,[service]));
      for(let i=0;i<sourceOutcomes.length;i++){const outcome=sourceOutcomes[i]!;if(outcome.status==='rejected')appendIntrinsic(errors,outcome.reason);}
      try { await closeSdk(ownedChildren.closeAll,ownedChildren,[]); } catch (error) { legacyCloseUnknown=true;appendIntrinsic(errors,error); }
      try{await closeSdk(drainDesktopWriterRelay,undefined,[service]);}catch(error){legacyCloseUnknown=true;appendIntrinsic(errors,error);}
      const controlOutcomes=await settleIntrinsicOperations(ownedControls.snapshot(),control=>closeSdk(control.sealAndDrainTransport,control,[]));
      for(let index=0;index<controlOutcomes.length;index++){const outcome=controlOutcomes[index]!;if(outcome.status==='rejected'){legacyCloseUnknown=true;appendIntrinsic(errors,outcome.reason);}}
      executionReadIncarnation=Object.freeze({}); running = false;
      healthFailureCount = 0;
      notifyListeners();
      const joins=await settleIntrinsicOperations(physicalCloseStocks.snapshot(),stock=>stock.waitPhysicalKnown());for(let index=0;index<joins.length;index++){const result=joins[index]!;if(result.status==='rejected'){legacyCloseUnknown=true;appendIntrinsic(errors,result.reason);}}
      physicalCloseFinished=true;
      if (errors.length) throw aggregateIntrinsicErrors(errors, 'kswarm_service_close_unconfirmed');
    }).then(resolveClosing,rejectClosing);
    // Publish the cached Promise before abort listeners can reenter.
    closeAbort.abort();
    stopHealthCheck();
    clearRestartTimer();
    return closing;
  }
  const service: KSwarmService = {
    start: async () => ingress.runAsync(start),
    stop: async () => ingress.runAsync(stop),
    restart: async () => ingress.runAsync(restart),
    request: async (path, init,beforeEffects) => ingress.runAsync(() => request(path, init,beforeEffects)),
    readProjectActivity:(subject,context)=>ingress.runAsync(()=>readProjectActivity(subject,context)),
    assertProjectActivityRead:(subject,receipt)=>ingress.runSync(()=>assertProjectActivityRead(subject,receipt)),
    readScopedProjectActivity:(subject,context)=>ingress.runAsync(()=>readProjectActivity(subject,context,true)),
    readProjectSourceActivity:(subject,context)=>ingress.runAsync(()=>readProjectActivity(subject,context,'source')),
    assertProjectSourceActivityRead:(subject,receipt)=>assertProjectSourceActivityRead(subject,receipt),
    assertScopedProjectActivityRead:(subject,receipt)=>ingress.runSync(()=>assertProjectActivityRead(subject,receipt,true)),
    submitTaskMetadataOnce:(projectId,envelope,context)=>ingress.runAsync(()=>submitTaskMetadataOnce(projectId,envelope,context)),
    readProjectExecutionStart:projectId=>ingress.runAsync(()=>readProjectExecutionStart(projectId)),
    assertProjectExecutionStartRead:(projectId,receipt)=>ingress.runSync(()=>assertProjectExecutionStartRead(projectId,receipt)),
    restartRelatedService: async id => ingress.runAsync(() => restartRelatedService(id)),
    getServiceStatus: async () => ingress.runAsync(getServiceStatus),
    getHealthDiagnosticInput: async () => ingress.runAsync(getHealthDiagnosticInput),
    getDesktopMutationToken: () => ingress.runSync(getDesktopMutationToken),
    getIntentBrokerRoomToken: () => ingress.runSync(getIntentBrokerRoomToken),
    activityOwnerConfig: async () => ingress.runAsync(activityOwnerConfig),
    bindActivityOwner: client => ingress.runSync(() => bindActivityOwner(client)),
    releaseActivityOwnerDelegation: () => ingress.runSync(() => {
      if (activityOwner) return;
      activityDelegated = false; activityFallback = true;
    }),
    getStatus, onStatusChange,
  };
  setOwnedControlPort(service,(operation,context)=>ingress.runAsync(()=>{if(!ownedControl||!child){if(activityDelegated&&hasDesktopWriterRelay(service))return callDesktopWriterRelay(service,operation,context);throw unavailableOwnedControl(service,operation,context);}return ownedControl.call(operation,context);}));
  setOriginalControlScope(service,admission=>{if(permanentlySealed)throw Error('WRITER_CONTROL_ORIGINAL_SERVICE_CLOSED');if(typeof admission!=='function'||admission!==ownedControlAdmission)throw Error('WRITER_CONTROL_ORIGINAL_ADMISSION_REQUIRED');return scope;});
  setBusinessPort(service,admission=>{
    if(typeof admission!=='function'||admission!==ownedBusinessAdmission)throw Error('DISPATCH_BUSINESS_ORIGINAL_ADMISSION_REQUIRED');
    if(permanentlySealed||stopping)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');if(activityDelegated&&!child)return getDesktopDispatchBusinessTransport(service,admission);if(!running||!child||!ownedBusinessPort)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');return ownedBusinessPort;
  });
  setOriginalBusinessScope(service,admission=>{if(permanentlySealed)throw Error('DISPATCH_BUSINESS_ORIGINAL_SERVICE_CLOSED');if(typeof admission!=='function'||admission!==ownedBusinessAdmission)throw Error('DISPATCH_BUSINESS_ORIGINAL_ADMISSION_REQUIRED');return scope;});
  if(ownedPreparationSource&&ownedPreparationAdmission){
    if(!scope)throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
    businessApply(preparationWeakSet,preparationServices,[service,{source:ownedPreparationSource,admission:ownedPreparationAdmission,
      scope(){if(permanentlySealed)throw Error('DISPATCH_PREPARATION_ORIGINAL_SERVICE_CLOSED');return scope;},
      accepted(work:unknown){const binding=work&&typeof work==='object'?businessApply(preparationWeakGet,acceptedPreparationBindings,[work]) as Readonly<{scope:Readonly<{profileId:string;workspaceId:string}>;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>|undefined:undefined;if(binding)return binding;const records=businessClients.snapshot();for(let i=0;i<records.length;i++){try{return readOwnedKSwarmPreparationWorkBinding(records[i]!.client,fixedPreparationSource!,ownedPreparationAdmission,work);}catch{ /* Pure original Root membership only; no Source/SDK invocation. */ }}return readDesktopPreparationAcceptedWorkBinding(service,ownedPreparationSource,ownedPreparationAdmission,work);},
      transport(){if(permanentlySealed||stopping)throw Error('DISPATCH_PREPARATION_UNAVAILABLE');if(activityDelegated&&!child)return getDesktopPreparationTransport(service,ownedPreparationSource,ownedPreparationAdmission);if(!running||!child||!ownedPreparationPort)throw Error('DISPATCH_PREPARATION_UNAVAILABLE');return ownedPreparationPort;},
    }]);
  }
  if(ownedDshAdmission&&scope)businessApply(preparationWeakSet,originalDshServices,[service,{admission:ownedDshAdmission,scope(){if(permanentlySealed)throw Error('DSH_BUSINESS_ORIGINAL_SERVICE_CLOSED');return scope;},transport(){if(permanentlySealed||stopping||!running||!child||!ownedDshPort)throw Error('DSH_BUSINESS_UNAVAILABLE');return ownedDshPort;},readReply(reply:unknown){const records=businessClients.snapshot();for(let i=0;i<records.length;i++){const record=records[i]!;if(record.dshAdmission)try{return readOwnedKSwarmDshReply(record.client,record.dshAdmission,reply);}catch{/* Private same-client membership only. */}}throw Error('DSH_BUSINESS_ORIGINAL_REPLY_REQUIRED');}}]);
  businessApply(preparationWeakSet,originalWorkflowControllerIO,[service,(projectId:string,runId:string|null)=>{
    // Validate the exact constructor-bound subject without entering HTTP.
    compileWorkflowControllerRequest(projectId,runId,runId===null?{kind:'create_proposal',body:null}:{kind:'read_run'});
    let birth=running?{child,incarnation:executionReadIncarnation}:undefined,retired=false,uncertain=false;
    const owned=createIntrinsicSet<ReturnType<typeof createRoomTurnCustody>>(),nativeJson=workflowControllerJson,nativeStatus=workflowControllerStatus;
    const current=()=>{if(retired||uncertain||permanentlySealed||stopping){retired=true;throw Error('KSWARM_WORKFLOW_CONTROLLER_NOT_CURRENT');}if(birth&&(!running||birth.child!==child||birth.incarnation!==executionReadIncarnation)){retired=true;throw Error('KSWARM_WORKFLOW_CONTROLLER_NOT_CURRENT');}if(birth?.child&&birth.child.connected!==true){retired=true;throw Error('KSWARM_WORKFLOW_CONTROLLER_NOT_CONNECTED');}};
    return preparationFreeze({async perform(input:WorkflowControllerRequest,beforeEffects?:()=>void){
      const plan=compileWorkflowControllerRequest(projectId,runId,input),c=createRoomTurnCustody();owned.add(c);let reply:Response|undefined;
      const guard=()=>{current();assertBeforeEffects(beforeEffects);current();};
      try{guard();await ensureReady();guard();if(!birth)birth={child,incarnation:executionReadIncarnation};guard();
        const headers={'accept':'application/json',...(plan.method==='POST'?{'content-type':'application/json','x-kswarm-mutation-token':desktopMutationToken}:{})};
        const send=()=>ingress.runAsync(()=>request(plan.path,{method:plan.method,headers,body:plan.body,redirect:'error'},guard));
        reply=await c.sdk<Response>(send,undefined,[],{accept(value){if(!value||typeof value!=='object'||businessTypes.isProxy(value))return false;try{businessApply(nativeStatus,value,[]);return true;}catch{return false;}},consumer:nativeJson});
        const status=businessApply(nativeStatus,reply,[]) as number,body=await c.consumeResource(nativeJson,reply,[]);await c.waitPhysicalKnown();owned.delete(c);return{ok:status>=200&&status<300,status,body};
      }catch(raw){try{await c.waitPhysicalKnown();owned.delete(c);}catch{uncertain=true;}throw raw;}
    },async waitPhysicalKnown(){const pending=owned.snapshot();for(let i=0;i<pending.length;i++)await pending[i]!.waitPhysicalKnown();if(uncertain)throw Error('KSWARM_WORKFLOW_CONTROLLER_PHYSICAL_UNCONFIRMED');},assertPhysicalKnown(){const pending=owned.snapshot();for(let i=0;i<pending.length;i++)pending[i]!.assertPhysicalKnown();if(uncertain)throw Error('KSWARM_WORKFLOW_CONTROLLER_PHYSICAL_UNCONFIRMED');}});
  }]);
  businessApply(preparationWeakSet,originalWorkflowRunIO,[service,preparationFreeze({read(projectId:string,workflowRunId:string){
    for(const id of [projectId,workflowRunId])if(typeof id!=='string'||!id||id.length>256||id.trim()!==id||id.includes('\0'))throw Error('KSWARM_WORKFLOW_READ_SUBJECT_INVALID');
    const incarnation=executionReadIncarnation,actualChild=child;
    const current=()=>{if(permanentlySealed||stopping||!running||!actualChild||child!==actualChild||executionReadIncarnation!==incarnation)throw Error('KSWARM_WORKFLOW_READ_NOT_CURRENT');};
    current();return ingress.runAsync(()=>request(`/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(workflowRunId)}`,{method:'GET',redirect:'error'},current));
  }})]);
  businessApply(preparationWeakSet,originalExecutionStartIO,[service,preparationFreeze({read:readProjectExecutionStart,assert:assertProjectExecutionStartRead})]);
  businessApply(preparationWeakSet, originalRoomProjectMappingIO, [
    service,
    () => {
      let birth: { child: ChildProcess; incarnation: object } | undefined,
        retired = false;
      const current = () => {
        if (
          retired ||
          permanentlySealed ||
          stopping ||
          (birth &&
            (!running ||
              birth.child !== child ||
              birth.incarnation !== executionReadIncarnation))
        ) {
          retired = true;
          throw Error('KSWARM_ROOM_PROJECT_MAPPING_NOT_CURRENT');
        }
        assertMetadataCleanupKnown();
        if (birth) {
          const connected = businessDescriptor(birth.child, 'connected');
          if (
            !connected ||
            !preparationOwn(connected, 'value') ||
            connected.value !== true
          ) {
            retired = true;
            throw Error('KSWARM_ROOM_PROJECT_MAPPING_NOT_CONNECTED', {
              cause: connected,
            });
          }
        }
      };
      return preparationFreeze({
        assertLocal: current,
        read(
          projectId: string,
          logicalAgentId: string,
          context: RoomTurnCustody,
          signal: AbortSignal,
        ) {
          assertRoomTurnCustody(context);
          if (!signal || typeof signal !== 'object' || preparationProxy(signal))
            throw Error('KSWARM_ROOM_PROJECT_MAPPING_SIGNAL_REQUIRED');
          for (const id of [projectId, logicalAgentId])
            if (
              typeof id !== 'string' ||
              !id ||
              id.length > 256 ||
              id.trim() !== id ||
              id.includes('\0')
            )
              throw Error('KSWARM_ROOM_PROJECT_MAPPING_SUBJECT_INVALID');
          return context.root(async () => {
            context.current();
            current();
            await context.sdk(ensureReady, undefined, []);
            current();
            if (!birth) {
              if (!running || !child)
                throw Error('KSWARM_ROOM_PROJECT_MAPPING_OWNED_CHILD_REQUIRED');
              birth = { child, incarnation: executionReadIncarnation };
            }
            current();
            const guard = () => {
              context.current();
              current();
              businessApply(roomProjectSignalThrow, signal, []);
              context.current();
              current();
            };
            const headers = businessCreate(null) as Record<string, string>;
            businessDefine(headers, 'x-kswarm-mutation-token', {
              __proto__: null,
              value: desktopMutationToken,
              enumerable: true,
            } as PropertyDescriptor);
            let acquired: Response | undefined,
              bodyEntered = false;
            try {
              const send = () =>
                ingress.runAsync(() =>
                  requestWithFallbackBaseUrls({
                    baseUrls: [KSWARM_REQUEST_BASE_URLS[0]!],
                    path: `/projects/${roomProjectMappingEncode(projectId)}/workspace-mapping?logicalAgentId=${roomProjectMappingEncode(logicalAgentId)}`,
                    init: {
                      __proto__: null,
                      method: 'GET',
                      redirect: 'error',
                      cache: 'no-store',
                      headers,
                    } as RequestInit,
                    timeoutMs: 15000,
                    beforeEffects: guard,
                    fetchImpl: (url, init) => {
                      guard();
                      const combined = businessApply(
                        roomProjectSignalAny,
                        AbortSignal,
                        [[signal, init!.signal!]],
                      );
                      guard();
                      return businessApply(roomProjectMappingFetch, globalThis, [
                        url,
                        { ...init, signal: combined },
                      ]);
                    },
                  }),
                );
              const response = await context.sdk<Response>(send, undefined, [], {
                accept(value) {
                  if (
                    !value ||
                    typeof value !== 'object' ||
                    preparationProxy(value)
                  )
                    return false;
                  const names = roomProjectMappingKeys(value);
                  for (let i = 0; i < names.length; i++) {
                    const row = businessDescriptor(value, names[i]!);
                    if (!row || !preparationOwn(row, 'value')) return false;
                  }
                  try {
                    businessApply(workflowControllerStatus, value, []);
                    acquired = value as Response;
                    return true;
                  } catch {
                    return false;
                  }
                },
                consumer: workflowControllerJson,
              });
              const status = await context.consumeResource<number>(
                workflowControllerStatus,
                response,
                [],
              );
              bodyEntered = true;
              const body = await context.consumeResource<unknown>(
                workflowControllerJson,
                response,
                [],
              );
              guard();
              if (status < 200 || status >= 300)
                throw Error('KSWARM_ROOM_PROJECT_MAPPING_UNAVAILABLE');
              return body;
            } catch (first) {
              if (acquired && !bodyEntered) {
                bodyEntered = true;
                try {
                  const cleanup = context.consumeResource<unknown>(
                    workflowControllerJson,
                    acquired,
                    [],
                  );
                  const observer = businessApply(businessThen, cleanup, [
                    () => undefined,
                    (raw: unknown) => context.inventory(raw),
                  ]);
                  context.inventory(observer);
                } catch (raw) {
                  context.inventory(raw);
                }
              }
              throw first;
            }
          });
        },
      });
    },
  ]);
  businessApply(preparationWeakSet,originalBrokerClientTokens,[service,desktopRoomToken]);
  const constructorIdentity=preparationFreeze(businessCreate(null));
  businessApply(preparationWeakSet,originalServiceIdentities,[service,()=>{
    const capturedChild=child,capturedIncarnation=executionReadIncarnation;
    const assertLocal=()=>{
      if(permanentlySealed||stopping||!running||!capturedChild||child!==capturedChild||executionReadIncarnation!==capturedIncarnation)throw Error('KSWARM_ORIGINAL_SERVICE_NOT_CURRENT');
    };
    const assertCurrent=()=>{
      assertLocal();const connected=capturedChild!.connected;
      if(connected!==true)throw Error('KSWARM_ORIGINAL_SERVICE_NOT_CONNECTED',{cause:connected});
      assertLocal();
    };
    return preparationFreeze({kind:'kswarm_service_identity_v1' as const,ownedChild:!!capturedChild&&running&&!stopping&&!permanentlySealed,scope:scope??null,constructorId:constructorIdentity,assertCurrent,assertLocal});
  }]);
  businessApply(preparationWeakSet,protectedServiceFates,[service,preparationFreeze({assertPhysicalKnown:assertServicePhysical,async waitPhysicalKnown(){
    if(!closing)throw Error('KSWARM_ORIGINAL_SERVICE_PHYSICAL_UNCONFIRMED');physicalJoinStock.inventory(closing);
    try{await closing;}catch(raw){physicalJoinStock.inventory(raw);}await physicalJoinStock.waitPhysicalKnown();assertServicePhysical();
  }})]);
  instanceClosers.set(service, sealAndDrain);
  workflowReadPorts.set(service,{port:createNativeWorkflowReadPort(),request:service.request});
  return service;
}
