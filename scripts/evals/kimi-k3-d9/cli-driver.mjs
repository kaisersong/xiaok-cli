import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalize } from './canonical.mjs';
import { attestCliRuntimeClosure } from './cli-closure-build.mjs';
import {
  buildBoundedCliSessionRecord,
  reduceCliUsageEvidence,
  validateCliStratumEvidence,
} from './session-record.mjs';
import {
  JsonlTailReader,
  ReadinessGate,
  TmuxPtySession,
  TurnObservation,
  withExternalTimeout,
  waitForCondition,
} from './tty-driver.mjs';

const CLI_STRATA = new Set([
  'cli-no-tool-multiturn',
  'cli-single-tool',
  'cli-multi-tool',
  'cli-long-history',
  'cli-compaction-parent-continuation',
]);
const CLOSURE_MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'artifactKind',
  'closureRoot',
  'closureAttestation',
  'nodeRelativePath',
  'entryRelativePath',
  'guardRelativePath',
  'allowedModuleRelativePaths',
  'resolutionGraphDigest',
]);
const verifiedClosures = new WeakSet();
const verifiedPlans = new WeakSet();

function fail(code) {
  throw new Error(code);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every(key => typeof key === 'string' && keys.includes(key));
}

function safeRelativePath(value, expected) {
  return (
    value === expected
    && isSafeRelativePath(value)
  );
}

function isSafeRelativePath(value) {
  return (
    typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !isAbsolute(value)
    && normalize(value) === value
    && !value.split('/').includes('..')
  );
}

function assertAbsolute(value) {
  return typeof value === 'string' && isAbsolute(value);
}

function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === ''
    || (
      child !== '..'
      && !child.startsWith(`..${sep}`)
      && !isAbsolute(child)
    );
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export async function loadFrozenCliClosure(input) {
  if (isPlainObject(input) && Object.hasOwn(input, 'productRoot')) {
    fail('KIMI_D9_CLI_PRODUCT_ROOT_FORBIDDEN');
  }
  if (
    !hasExactKeys(input, [
      'closureManifestPath',
      'closureManifestHash',
    ])
    || !assertAbsolute(input.closureManifestPath)
    || !/^[0-9a-f]{64}$/u.test(input.closureManifestHash)
  ) {
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  }
  const bytes = await readFile(input.closureManifestPath).catch(() => {
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  });
  if (
    bytes.length === 0
    || bytes.length > 2_097_152
    || sha256(bytes) !== input.closureManifestHash
  ) {
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
    if (canonicalize(manifest) !== bytes.toString('utf8')) {
      fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
    }
  } catch (error) {
    if (error?.message === 'KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID') throw error;
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  }
  if (
    !hasExactKeys(manifest, CLOSURE_MANIFEST_KEYS)
    || manifest.schemaVersion !== 1
    || manifest.artifactKind !== 'cli-runtime-closure-v1'
    || !assertAbsolute(manifest.closureRoot)
    || !safeRelativePath(
      manifest.nodeRelativePath,
      'runtime/node/bin/node',
    )
    || !safeRelativePath(manifest.entryRelativePath, 'dist/index.js')
    || !safeRelativePath(
      manifest.guardRelativePath,
      'runtime/guard/runtime-guard.mjs',
    )
    || !Array.isArray(manifest.allowedModuleRelativePaths)
    || manifest.allowedModuleRelativePaths.length === 0
    || manifest.allowedModuleRelativePaths.some(
      path => !isSafeRelativePath(path),
    )
    || new Set(manifest.allowedModuleRelativePaths).size
      !== manifest.allowedModuleRelativePaths.length
    || !manifest.allowedModuleRelativePaths.includes(
      manifest.entryRelativePath,
    )
    || canonicalize([...manifest.allowedModuleRelativePaths].sort())
      !== canonicalize(manifest.allowedModuleRelativePaths)
    || !/^[0-9a-f]{64}$/u.test(manifest.resolutionGraphDigest)
    || sha256(canonicalize({
      entryRelativePath: manifest.entryRelativePath,
      modules: manifest.allowedModuleRelativePaths,
    })) !== manifest.resolutionGraphDigest
    || manifest.entryRelativePath.includes('.test-dist')
  ) {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  }
  const closureRoot = await realpath(manifest.closureRoot).catch(() => {
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  });
  if (closureRoot !== manifest.closureRoot) {
    fail('KIMI_D9_CLI_CLOSURE_MANIFEST_INVALID');
  }
  const actualAttestation = await attestCliRuntimeClosure(closureRoot)
    .catch(() => {
      fail('KIMI_D9_CLI_CLOSURE_DRIFT');
    });
  if (
    canonicalize(actualAttestation)
      !== canonicalize(manifest.closureAttestation)
  ) {
    fail('KIMI_D9_CLI_CLOSURE_DRIFT');
  }
  const command = await realpath(join(
    closureRoot,
    manifest.nodeRelativePath,
  )).catch(() => {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  });
  const entry = await realpath(join(
    closureRoot,
    manifest.entryRelativePath,
  )).catch(() => {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  });
  const guard = await realpath(join(
    closureRoot,
    manifest.guardRelativePath,
  )).catch(() => {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  });
  const allowedRealpaths = [];
  for (const relativePath of manifest.allowedModuleRelativePaths) {
    const modulePath = await realpath(join(
      closureRoot,
      relativePath,
    )).catch(() => {
      fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
    });
    const moduleStat = await stat(modulePath).catch(() => {
      fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
    });
    if (!isWithin(closureRoot, modulePath) || !moduleStat.isFile()) {
      fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
    }
    allowedRealpaths.push(modulePath);
  }
  if (
    !isWithin(closureRoot, command)
    || !isWithin(closureRoot, entry)
    || !isWithin(closureRoot, guard)
    || !(await stat(guard)).isFile()
    || ((await stat(command)).mode & 0o111) === 0
  ) {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  }
  const frozen = deepFreeze({
    closureManifestPath: await realpath(input.closureManifestPath),
    closureManifestHash: input.closureManifestHash,
    closureRoot,
    closureAttestation: actualAttestation,
    command,
    entry,
    guard,
    allowedRealpaths,
    resolutionGraphDigest: manifest.resolutionGraphDigest,
  });
  verifiedClosures.add(frozen);
  return frozen;
}

export function createCliProductLaunch(input) {
  if (
    !isPlainObject(input)
    || !verifiedClosures.has(input.frozenClosure)
    || !assertAbsolute(input.workspace)
    || !assertAbsolute(input.homeDir)
    || !assertAbsolute(input.configDir)
    || !assertAbsolute(input.traceDir)
    || !assertAbsolute(input.tempDir)
    || !assertAbsolute(input.xdgConfigDir)
    || !assertAbsolute(input.xdgCacheDir)
    || !assertAbsolute(input.xdgDataDir)
    || typeof input.preservedThinking !== 'boolean'
  ) {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  }
  const roots = [
    input.workspace,
    input.homeDir,
    input.configDir,
    input.traceDir,
    input.tempDir,
    input.xdgConfigDir,
    input.xdgCacheDir,
    input.xdgDataDir,
  ].map(path => resolve(path));
  if (
    new Set(roots).size !== roots.length
    || roots.some(path => isWithin(input.frozenClosure.closureRoot, path))
  ) {
    fail('KIMI_D9_CLI_PRODUCT_CONTRACT_INVALID');
  }
  return deepFreeze({
    command: input.frozenClosure.command,
    args: [
      '--no-global-search-paths',
      '--import',
      input.frozenClosure.guard,
      input.frozenClosure.entry,
      'chat',
      '--auto',
    ],
    cwd: input.workspace,
    env: {
      HOME: input.homeDir,
      XIAOK_CONFIG_DIR: input.configDir,
      XIAOK_TRACE_DIR: input.traceDir,
      XIAOK_D9_RUNTIME_GUARD_POLICY: canonicalize({
        closureRoot: input.frozenClosure.closureRoot,
        allowedRealpaths: input.frozenClosure.allowedRealpaths,
      }),
      XIAOK_DISABLE_GLOBAL_PLUGINS: '1',
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '0',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING:
        input.preservedThinking ? '1' : '0',
      TMPDIR: input.tempDir,
      TMP: input.tempDir,
      TEMP: input.tempDir,
      XDG_CONFIG_HOME: input.xdgConfigDir,
      XDG_CACHE_HOME: input.xdgCacheDir,
      XDG_DATA_HOME: input.xdgDataDir,
      PATH: join(input.frozenClosure.closureRoot, 'runtime/node/bin'),
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      TERM: 'xterm-256color',
      NODE_OPTIONS: '',
      NODE_PATH: '',
      DYLD_LIBRARY_PATH: '',
      DYLD_FALLBACK_LIBRARY_PATH: '',
      DYLD_INSERT_LIBRARIES: '',
    },
  });
}

export function validateCliFixtureBoundary({
  stratum,
  historyRoleVector,
  sameLiveTask,
}) {
  if (
    !CLI_STRATA.has(stratum)
    || !Array.isArray(historyRoleVector)
    || historyRoleVector.length === 0
    || historyRoleVector.some(role => (
      typeof role !== 'string'
      || !['system', 'user', 'tool'].includes(role)
    ))
  ) {
    if (historyRoleVector?.includes('assistant')) {
      fail('KIMI_K3_DURABLE_RESUME_UNSUPPORTED');
    }
    fail('KIMI_D9_CLI_DURABLE_BOUNDARY_INVALID');
  }
  if (
    stratum === 'cli-compaction-parent-continuation'
      ? sameLiveTask !== true
      : sameLiveTask === true
  ) {
    fail('KIMI_D9_CLI_DURABLE_BOUNDARY_INVALID');
  }
  return true;
}

function expectedToolNames(stratum, modelTurnIndex) {
  if (modelTurnIndex !== 0) return [];
  if (stratum === 'cli-single-tool') {
    return ['mcp__d9_fixture__d9_fixture_echo'];
  }
  if (stratum === 'cli-multi-tool') {
    return [
      'mcp__d9_fixture__d9_fixture_echo',
      'mcp__d9_fixture__d9_fixture_accumulate',
    ];
  }
  return [];
}

export function createCliStratumPlan(input) {
  const expectedModelTurnCount = input?.stratum === 'cli-long-history'
    ? 4
    : input?.stratum === 'cli-compaction-parent-continuation'
      ? 3
      : 2;
  if (
    !isPlainObject(input)
    || !CLI_STRATA.has(input.stratum)
    || typeof input.fixtureId !== 'string'
    || input.fixtureId.length === 0
    || !Array.isArray(input.assistantMarkers)
    || input.assistantMarkers.length !== expectedModelTurnCount
    || input.assistantMarkers.some(marker => (
      typeof marker !== 'string'
      || marker.length === 0
      || marker.includes('\0')
    ))
    || new Set(input.assistantMarkers).size !== input.assistantMarkers.length
    || !Array.isArray(input.prompts)
    || input.prompts.length !== expectedModelTurnCount
    || input.prompts.some(prompt => (
      typeof prompt !== 'string'
      || prompt.length === 0
      || prompt.includes('\0')
    ))
    || !Array.isArray(input.validators)
    || input.validators.length !== expectedModelTurnCount
    || input.validators.some((validator, index) => (
      !hasExactKeys(validator, [
        'kind',
        'resultDigest',
        'previousResultDigest',
      ])
      || validator.kind !== 'result-digest-v1'
      || !/^[0-9a-f]{64}$/u.test(validator.resultDigest)
      || (
        index === 0
          ? validator.previousResultDigest !== null
          : validator.previousResultDigest
            !== input.validators[index - 1]?.resultDigest
      )
      || input.prompts[index].includes(validator.resultDigest)
    ))
  ) {
    fail('KIMI_D9_CLI_STRATUM_INVALID');
  }
  validateCliFixtureBoundary(input);
  const modelTurns = input.prompts.map((prompt, modelTurnIndex) => ({
    kind: 'model',
    prompt,
    marker: input.assistantMarkers[modelTurnIndex],
    expectedToolNames: expectedToolNames(
      input.stratum,
      modelTurnIndex,
    ),
    validator: input.validators[modelTurnIndex],
  }));
  const turns = input.stratum === 'cli-compaction-parent-continuation'
    ? [
      modelTurns[0],
      modelTurns[1],
      { kind: 'control', command: '/compact' },
      modelTurns[2],
    ]
    : modelTurns;
  const plan = deepFreeze({
    stratum: input.stratum,
    fixtureId: input.fixtureId,
    processCount: 1,
    tty: true,
    freshSession: true,
    durableResume: false,
    sameLiveTask:
      input.stratum === 'cli-compaction-parent-continuation',
    mcpServerName: 'd9_fixture',
    expectedMcpToolCount: 2,
    turns,
  });
  verifiedPlans.add(plan);
  return plan;
}

async function createSessionRoots(parent) {
  const rootParent = resolve(parent ?? tmpdir());
  await mkdir(rootParent, { recursive: true, mode: 0o700 });
  const createdSessionRoot = await mkdtemp(
    join(rootParent, 'kimi-d9-cli-session-'),
  );
  await chmod(createdSessionRoot, 0o700);
  const sessionRoot = await realpath(createdSessionRoot);
  const paths = {
    sessionRoot,
    homeDir: join(sessionRoot, 'home'),
    configDir: join(sessionRoot, 'config'),
    workspace: join(sessionRoot, 'workspace'),
    traceDir: join(sessionRoot, 'trace'),
    tempDir: join(sessionRoot, 'temp'),
    xdgConfigDir: join(sessionRoot, 'xdg-config'),
    xdgCacheDir: join(sessionRoot, 'xdg-cache'),
    xdgDataDir: join(sessionRoot, 'xdg-data'),
  };
  await Promise.all(Object.entries(paths)
    .filter(([name]) => name !== 'sessionRoot')
    .map(([, path]) => mkdir(path, { recursive: true, mode: 0o700 })));
  return paths;
}

function boundedBytes(value, code) {
  const bytes = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : null;
  if (!bytes || bytes.length === 0 || bytes.length > 1_048_576) {
    fail(code);
  }
  return bytes;
}

async function findSingleTranscript(configDir) {
  const directory = join(configDir, 'transcripts');
  const names = await readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const transcripts = names.filter(name => name.endsWith('.jsonl'));
  if (transcripts.length > 1) {
    fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
  }
  return transcripts.length === 1
    ? join(directory, transcripts[0])
    : null;
}

async function readJson(path) {
  const bytes = await readFile(path);
  if (bytes.length > 2_097_152) {
    fail('KIMI_D9_CLI_PRODUCT_EVIDENCE_TOO_LARGE');
  }
  return JSON.parse(bytes.toString('utf8'));
}

async function listJsonFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await listJsonFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      paths.push(path);
    }
  }
  return paths.sort();
}

async function readTraceSnapshots(
  traceDir,
  {
    seenBundlePaths,
    expectedSessionId,
    consumedTurnIds,
  },
) {
  const snapshots = [];
  for (const path of await listJsonFiles(traceDir)) {
    if (seenBundlePaths.has(path)) continue;
    let bundle;
    try {
      bundle = await readJson(path);
    } catch {
      continue;
    }
    seenBundlePaths.add(path);
    const bundleSessionId = bundle?.scope?.sessionId;
    if (bundleSessionId !== expectedSessionId) {
      fail('KIMI_D9_CLI_TRACE_IDENTITY_INVALID');
    }
    const turns = Array.isArray(bundle?.turns) ? bundle.turns : [];
    const terminalEvents = (
      Array.isArray(bundle?.events) ? bundle.events : []
    ).filter(event => (
      event?.type === 'runtime.turn_completed'
      || event?.type === 'runtime.turn_failed'
    ));
    for (
      let terminalIndex = 0;
      terminalIndex < terminalEvents.length;
      terminalIndex += 1
    ) {
      const event = terminalEvents[terminalIndex];
      const turnId = typeof event?.refs?.turnId === 'string'
        ? event.refs.turnId
        : turns[terminalIndex]?.id;
      if (typeof turnId !== 'string' || turnId.length === 0) {
        fail('KIMI_D9_CLI_TRACE_IDENTITY_INVALID');
      }
      if (consumedTurnIds.has(turnId)) continue;
      const toolCalls = (
        Array.isArray(bundle?.toolCalls) ? bundle.toolCalls : []
      ).filter(toolCall => toolCall?.turnId === turnId)
        .map(toolCall => {
          if (
            typeof toolCall?.name !== 'string'
            || toolCall.name.length === 0
          ) {
            fail('KIMI_D9_CLI_TRACE_IDENTITY_INVALID');
          }
          return {
          name: toolCall.name,
          ok: toolCall.ok === true,
          };
        });
      snapshots.push({
        sessionId: bundleSessionId,
        turnId,
        terminalStatus: event.type === 'runtime.turn_completed'
          ? 'completed'
          : 'failed',
        toolCalls,
      });
    }
  }
  return snapshots;
}

async function readSessionSnapshot(configDir, sessionId) {
  const snapshot = await readJson(join(
    configDir,
    'sessions',
    `${sessionId}.json`,
  ));
  if (snapshot?.sessionId !== sessionId) {
    fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
  }
  return snapshot;
}

function usageSnapshot(snapshot) {
  return {
    inputTokens: snapshot?.usage?.inputTokens,
    outputTokens: snapshot?.usage?.outputTokens,
  };
}

async function runCliProductSessionWork(input, lifecycle) {
  if (
    !isPlainObject(input)
    || !verifiedPlans.has(input.plan)
    || !['k3', 'k3-256k'].includes(input.profile)
    || !['baseline', 'candidate'].includes(input.arm)
    || typeof input.preservedThinking !== 'boolean'
    || !assertAbsolute(input.tmuxExecutable)
    || !Number.isSafeInteger(input.timeoutMs)
    || input.timeoutMs <= 0
    || input.timeoutMs > 300_000
  ) {
    fail('KIMI_D9_CLI_RUNNER_INPUT_INVALID');
  }
  const frozenClosure = await loadFrozenCliClosure({
    closureManifestPath: input.closureManifestPath,
    closureManifestHash: input.closureManifestHash,
  });
  const productConfigBytes = boundedBytes(
    input.productConfigBytes,
    'KIMI_D9_CLI_PRODUCT_CONFIG_INVALID',
  );
  const mcpSettingsBytes = boundedBytes(
    input.mcpSettingsBytes,
    'KIMI_D9_CLI_MCP_SETTINGS_INVALID',
  );
  const paths = await createSessionRoots(input.sessionRootParent);
  await writeFile(
    join(paths.configDir, 'config.json'),
    productConfigBytes,
    { mode: 0o600 },
  );
  await writeFile(
    join(paths.configDir, 'settings.json'),
    mcpSettingsBytes,
    { mode: 0o600 },
  );
  await chmod(join(paths.configDir, 'config.json'), 0o600);
  await chmod(join(paths.configDir, 'settings.json'), 0o600);

  const launch = createCliProductLaunch({
    frozenClosure,
    workspace: paths.workspace,
    homeDir: paths.homeDir,
    configDir: paths.configDir,
    traceDir: paths.traceDir,
    tempDir: paths.tempDir,
    xdgConfigDir: paths.xdgConfigDir,
    xdgCacheDir: paths.xdgCacheDir,
    xdgDataDir: paths.xdgDataDir,
    preservedThinking: input.preservedThinking,
  });
  const tmux = new TmuxPtySession({
    tmuxExecutable: input.tmuxExecutable,
    sessionName: `kimi_d9_${randomUUID().replaceAll('-', '')}`,
  });
  lifecycle.activeTmux = tmux;
  let productPid;
  let transcriptReader;
  let sessionId;
  let finalSnapshot;
  const turnRecords = [];
  const usageSnapshots = [];
  const seenTraceBundlePaths = new Set();
  const consumedTraceTurnIds = new Set();
  let providerErrorClass = null;
  let compactionNoticeObserved = false;
  let timedOut = false;
  const observedProductPids = [];
  const observedSessionIds = [];

  const runWithProductTimeout = (
    work,
    timeoutMs = input.timeoutMs,
  ) => withExternalTimeout(
    Promise.resolve().then(work),
    {
      timeoutMs,
      terminate: () => tmux.stop(),
    },
  );

  const observeProductIdentity = async () => {
    const observedPid = await tmux.panePid();
    observedProductPids.push(observedPid);
    if (productPid !== undefined && observedPid !== productPid) {
      fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
    }
    return observedPid;
  };

  const observeSessionIdentity = async () => {
    const transcriptPath = await findSingleTranscript(paths.configDir);
    if (!transcriptPath) {
      fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
    }
    const observedSessionId = basename(transcriptPath, '.jsonl');
    observedSessionIds.push(observedSessionId);
    if (sessionId !== undefined && observedSessionId !== sessionId) {
      fail('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
    }
    return observedSessionId;
  };

  try {
    productPid = await tmux.start(launch);
    observedProductPids.push(productPid);
    const gate = new ReadinessGate({
      workspace: paths.workspace,
      serverName: input.plan.mcpServerName,
      expectedToolCount: input.plan.expectedMcpToolCount,
    });
    await runWithProductTimeout(() => waitForCondition(async () => {
        if (await tmux.isDead()) {
          fail('KIMI_D9_CLI_PRODUCT_EXITED_BEFORE_READY');
        }
        const transcriptPath = await findSingleTranscript(paths.configDir);
        if (transcriptPath && !transcriptReader) {
          transcriptReader = new JsonlTailReader(transcriptPath);
          sessionId = basename(transcriptPath, '.jsonl');
        }
        if (transcriptReader) {
          for (const event of await transcriptReader.readAvailable()) {
            gate.observeTranscript(event);
          }
        }
        const healthPath = join(
          paths.workspace,
          '.xiaok',
          'state',
          'capability-health.json',
        );
        const health = await readJson(healthPath).catch((error) => {
          if (error?.code === 'ENOENT') return null;
          return null;
        });
        if (health) gate.observeCapabilityHealth(health);
        return gate.ready;
      }, {
        timeoutMs: input.timeoutMs * 2,
        timeoutCode: 'KIMI_D9_MCP_READINESS_FAILED',
      }));
    await observeSessionIdentity();

    let modelTurnIndex = 0;
    for (const turn of input.plan.turns) {
      if (turn.kind === 'control') {
        let readyObserved = false;
        await runWithProductTimeout(async () => {
          await observeProductIdentity();
          await observeSessionIdentity();
          await tmux.sendText(turn.command);
          await tmux.pressEnter();
          await waitForCondition(async () => {
            for (const event of await transcriptReader.readAvailable()) {
              if (
                event?.type === 'output'
                && String(event.normalized ?? event.raw ?? '')
                  .includes('已压缩较早对话')
              ) {
                compactionNoticeObserved = true;
              }
              if (event?.type === 'input_read_attach') {
                readyObserved = true;
              }
            }
            return compactionNoticeObserved && readyObserved;
          }, { timeoutMs: input.timeoutMs * 2 });
          await observeProductIdentity();
          await observeSessionIdentity();
        });
        continue;
      }

      let observation;
      const observedToolCalls = [];
      let traceTerminal = false;
      try {
        await runWithProductTimeout(async () => {
          await tmux.sendText(turn.prompt);
          const submittedAtMs = performance.now();
          observation = new TurnObservation({
            marker: turn.marker,
            validator: turn.validator,
            submittedAtMs,
          });
          await tmux.pressEnter();
          await waitForCondition(async () => {
            for (const event of await transcriptReader.readAvailable()) {
              const observedAtMs = performance.now();
              if (event?.type === 'input_read_attach') {
                observation.observe({
                  type: 'input_read_attach',
                  observedAtMs,
                });
              } else if (event?.type === 'output') {
                const text = String(event.normalized ?? event.raw ?? '');
                observation.observe({
                  type: 'output',
                  text,
                  observedAtMs,
                });
                if (text.includes('422')) {
                  providerErrorClass = 'reasoning-422';
                } else if (text.includes('400')) {
                  providerErrorClass = 'reasoning-400';
                }
              }
            }
            const traceSnapshots = await readTraceSnapshots(paths.traceDir, {
              seenBundlePaths: seenTraceBundlePaths,
              expectedSessionId: sessionId,
              consumedTurnIds: consumedTraceTurnIds,
            });
            const completeSnapshots = traceSnapshots.filter(snapshot => (
              snapshot.terminalStatus === 'failed'
              || snapshot.toolCalls.length >= turn.expectedToolNames.length
            ));
            if (completeSnapshots.length > 1) {
              fail('KIMI_D9_CLI_TRACE_IDENTITY_INVALID');
            }
            for (const snapshot of completeSnapshots) {
              traceTerminal = true;
              consumedTraceTurnIds.add(snapshot.turnId);
              observedToolCalls.splice(
                0,
                observedToolCalls.length,
                ...snapshot.toolCalls,
              );
              observation.observe({
                type: snapshot.terminalStatus === 'completed'
                  ? 'turn_completed'
                  : 'turn_failed',
                observedAtMs: performance.now(),
              });
            }
            if (await tmux.isDead() && !traceTerminal) {
              fail('KIMI_D9_CLI_PRODUCT_EXITED_DURING_TURN');
            }
            return observation.snapshot().terminal;
          }, { timeoutMs: input.timeoutMs * 2 });
        });
      } catch (error) {
        if (error?.message !== 'KIMI_D9_PRODUCT_TIMEOUT') throw error;
        timedOut = true;
        turnRecords.push({
          marker: turn.marker,
          ttfvMs: null,
          totalLatencyMs: null,
          terminalStatus: 'timeout',
          semanticPassed: false,
          continuityPassed: false,
          expectedToolNames: turn.expectedToolNames,
          observedToolCalls,
        });
        modelTurnIndex += 1;
        break;
      }
      const observed = observation.snapshot();
      turnRecords.push({
        marker: turn.marker,
        ttfvMs: observed.ttfvMs,
        totalLatencyMs: observed.totalLatencyMs,
        terminalStatus: observed.terminalStatus,
        semanticPassed: observed.semanticPassed,
        continuityPassed: observed.continuityPassed,
        expectedToolNames: turn.expectedToolNames,
        observedToolCalls,
      });
      finalSnapshot = await readSessionSnapshot(paths.configDir, sessionId);
      usageSnapshots.push(usageSnapshot(finalSnapshot));
      modelTurnIndex += 1;
    }

    if (timedOut) {
      const plannedModelTurns = input.plan.turns.filter(
        turn => turn.kind === 'model',
      );
      for (
        let index = modelTurnIndex;
        index < plannedModelTurns.length;
        index += 1
      ) {
        turnRecords.push({
          marker: plannedModelTurns[index].marker,
          ttfvMs: null,
          totalLatencyMs: null,
          terminalStatus: 'timeout',
          semanticPassed: false,
          continuityPassed: false,
          expectedToolNames: plannedModelTurns[index].expectedToolNames,
          observedToolCalls: [],
        });
      }
    } else {
      const exitTimeoutMs = Math.min(input.timeoutMs, 2_000);
      await runWithProductTimeout(async () => {
        await tmux.sendLine('/exit');
        await waitForCondition(
          () => tmux.isDead(),
          {
            timeoutMs: exitTimeoutMs * 2,
            timeoutCode: 'KIMI_D9_CLI_EXIT_TIMEOUT',
          },
        );
      }, exitTimeoutMs);
    }

    finalSnapshot ??= await readSessionSnapshot(paths.configDir, sessionId);
    const compactions = Array.isArray(finalSnapshot.compactions)
      ? finalSnapshot.compactions
      : [];
    const compaction = input.plan.stratum
      === 'cli-compaction-parent-continuation'
      ? {
        sameLiveTask: true,
        productNoticeObserved: compactionNoticeObserved,
        recordCount: compactions.length,
        replacedMessages: compactions[0]?.replacedMessages ?? 0,
      }
      : null;
    validateCliStratumEvidence({
      stratum: input.plan.stratum,
      processIds: observedProductPids,
      sessionIds: observedSessionIds,
      compaction,
      fixtureInvocations:
        input.plan.stratum === 'cli-compaction-parent-continuation'
          ? 0
          : undefined,
    });
    const usage = reduceCliUsageEvidence({
      stratum: input.plan.stratum,
      perTurnSnapshots: usageSnapshots,
    });
    const evidence = buildBoundedCliSessionRecord({
      profile: input.profile,
      arm: input.arm,
      stratum: input.plan.stratum,
      fixtureId: input.plan.fixtureId,
      closureManifestHash: frozenClosure.closureManifestHash,
      processId: productPid,
      sessionId,
      processIdentityObservationCount: observedProductPids.length,
      sessionIdentityObservationCount: observedSessionIds.length,
      turns: turnRecords,
      usage,
      providerErrorClass,
      compaction,
      promptCacheKeySent: false,
    });
    return {
      evidence,
      runtime: Object.freeze({
        sessionRoot: paths.sessionRoot,
        productPid,
        tty: true,
        closureDigest: frozenClosure.closureAttestation.closureDigest,
      }),
    };
  } finally {
    await withExternalTimeout(
      Promise.resolve().then(() => tmux.stop()),
      {
        timeoutMs: Math.min(input.timeoutMs, 500),
        terminate: () => {},
      },
    ).catch(() => {});
    if (input.preserveSessionRoot === false) {
      await rm(paths.sessionRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
      });
    }
  }
}

export function runCliProductSession(input) {
  const lifecycle = { activeTmux: null };
  const perStageTimeoutMs = Number.isSafeInteger(input?.timeoutMs)
    && input.timeoutMs > 0
    && input.timeoutMs <= 300_000
    ? input.timeoutMs
    : 1_000;
  const stageCount = Array.isArray(input?.plan?.turns)
    ? Math.min(input.plan.turns.length + 3, 16)
    : 3;
  return withExternalTimeout(
    runCliProductSessionWork(input, lifecycle),
    {
      timeoutMs: perStageTimeoutMs * stageCount,
      terminate: () => lifecycle.activeTmux?.stop(),
    },
  );
}
