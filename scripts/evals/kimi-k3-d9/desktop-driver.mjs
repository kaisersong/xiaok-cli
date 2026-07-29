import { createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { canonicalize } from './canonical.mjs';
import { validateDesktopSourceCommitMap } from './desktop-build.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const DESKTOP_STRATA = new Set([
  'desktop-no-tool-multiturn',
  'desktop-single-tool',
  'desktop-multi-tool',
  'desktop-long-synthesized-history',
  'desktop-new-invocation-recovery',
]);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function fail(code) {
  throw new Error(code);
}

function freeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function assertNoSideEffects(counters) {
  const value = counters?.snapshot?.();
  if (
    value?.networkRequest !== 0
    || value?.fixtureMcpInvocation !== 0
    || value?.evidenceWrite !== 0
  ) {
    fail('KIMI_D9_DESKTOP_SESSION_START_REJECTED');
  }
}

export function createDesktopSideEffectCounters() {
  const counts = {
    networkRequest: 0,
    fixtureMcpInvocation: 0,
    evidenceWrite: 0,
  };
  return Object.freeze({
    increment(kind) {
      if (!Object.hasOwn(counts, kind)) {
        fail('KIMI_D9_DESKTOP_SIDE_EFFECT_COUNTER_INVALID');
      }
      counts[kind] += 1;
    },
    snapshot() {
      return { ...counts };
    },
  });
}

export function verifyDesktopSessionStart({
  frozenArtifactDigest,
  runningArtifactDigest,
  frozenSelectorContractDigest,
  runningSelectorContractDigest,
  frozenSourceCommitMap,
  runningSourceCommitMap,
  counters,
}) {
  try {
    assertNoSideEffects(counters);
    validateDesktopSourceCommitMap(frozenSourceCommitMap);
    validateDesktopSourceCommitMap(runningSourceCommitMap);
    if (
      !SHA256_PATTERN.test(frozenArtifactDigest)
      || runningArtifactDigest !== frozenArtifactDigest
      || !SHA256_PATTERN.test(frozenSelectorContractDigest)
      || runningSelectorContractDigest !== frozenSelectorContractDigest
      || canonicalize(runningSourceCommitMap)
        !== canonicalize(frozenSourceCommitMap)
    ) {
      fail('KIMI_D9_DESKTOP_SESSION_START_REJECTED');
    }
    assertNoSideEffects(counters);
    return true;
  } catch (error) {
    if (error?.message === 'KIMI_D9_DESKTOP_SESSION_START_REJECTED') {
      throw error;
    }
    fail('KIMI_D9_DESKTOP_SESSION_START_REJECTED');
  }
}

export async function materializeFreshDesktopSession({
  runRoot,
  sessionId,
  debuggingPort,
}) {
  if (
    !isAbsolute(runRoot)
    || !SESSION_ID_PATTERN.test(sessionId)
    || !Number.isSafeInteger(debuggingPort)
    || debuggingPort < 1024
    || debuggingPort > 65_535
  ) {
    fail('KIMI_D9_DESKTOP_SESSION_LAYOUT_INVALID');
  }
  const sessionsRoot = join(resolve(runRoot), 'desktop-sessions');
  const sessionRoot = join(sessionsRoot, sessionId);
  const portsRoot = join(sessionsRoot, '.ports');
  const portReservationPath = join(portsRoot, `${debuggingPort}.lock`);
  let portReservation;
  let ownsPortReservation = false;
  let ownsSessionRoot = false;
  try {
    await mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
    await mkdir(portsRoot, { recursive: true, mode: 0o700 });
    portReservation = await open(portReservationPath, 'wx', 0o600);
    ownsPortReservation = true;
    await portReservation.writeFile(`${sessionId}\n`, 'utf8');
    await portReservation.sync();
    await portReservation.close();
    portReservation = undefined;
    await mkdir(sessionRoot, { recursive: false, mode: 0o700 });
    ownsSessionRoot = true;
    const paths = {
      userData: join(sessionRoot, 'user-data'),
      home: join(sessionRoot, 'home'),
      config: join(sessionRoot, 'config'),
      temp: join(sessionRoot, 'temp'),
      workspace: join(sessionRoot, 'workspace'),
      logs: join(sessionRoot, 'logs'),
      crash: join(sessionRoot, 'crash'),
      taskRoot: join(sessionRoot, 'tasks'),
    };
    for (const path of Object.values(paths)) {
      await mkdir(path, { mode: 0o700 });
    }
    return freeze({
      sessionRoot,
      portReservationPath,
      ...paths,
      debuggingPort,
    });
  } catch {
    await portReservation?.close().catch(() => {});
    if (ownsSessionRoot) {
      await rm(sessionRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (ownsPortReservation) {
      await rm(portReservationPath, { force: true }).catch(() => {});
    }
    fail('KIMI_D9_DESKTOP_SESSION_LAYOUT_INVALID');
  }
}

export function createDesktopProductLaunch({
  artifactPath,
  artifactDigest,
  sourceCommitMap,
  session,
  preservedThinking,
}) {
  validateDesktopSourceCommitMap(sourceCommitMap);
  if (
    !isAbsolute(artifactPath)
    || !artifactPath.endsWith('.app')
    || !SHA256_PATTERN.test(artifactDigest)
    || typeof preservedThinking !== 'boolean'
    || !isAbsolute(session?.userData)
    || !isAbsolute(session?.home)
    || !isAbsolute(session?.config)
    || !isAbsolute(session?.temp)
    || !isAbsolute(session?.workspace)
    || !Number.isSafeInteger(session?.debuggingPort)
  ) {
    fail('KIMI_D9_DESKTOP_PRODUCT_CONTRACT_INVALID');
  }
  const appPath = resolve(artifactPath);
  return freeze({
    command: join(appPath, 'Contents', 'MacOS', 'xiaok'),
    args: [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${session.debuggingPort}`,
      `--user-data-dir=${session.userData}`,
    ],
    cwd: session.workspace,
    env: {
      HOME: session.home,
      XIAOK_CONFIG_DIR: session.config,
      XIAOK_TRACE_DIR: session.logs,
      TMPDIR: session.temp,
      TMP: session.temp,
      TEMP: session.temp,
      XDG_CONFIG_HOME: join(session.home, '.config'),
      XDG_CACHE_HOME: join(session.home, '.cache'),
      XDG_DATA_HOME: join(session.home, '.local', 'share'),
      XIAOK_DISABLE_GLOBAL_PLUGINS: '1',
      XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE: '0',
      XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING:
        preservedThinking ? '1' : '0',
      LANG: 'C.UTF-8',
      PATH: dirname(process.execPath),
    },
    artifactDigest,
    sourceCommitMap: structuredClone(sourceCommitMap),
  });
}

export function validateDesktopRecoveryBoundary(input) {
  if (
    input?.recoveryPhase !== 'before-first-assistant'
    || !Array.isArray(input.canonicalHistoryRoleVector)
    || input.canonicalHistoryRoleVector.length === 0
    || input.canonicalHistoryRoleVector.some(role => (
      !['system', 'user', 'tool'].includes(role) || role === 'assistant'
    ))
    || typeof input.baselineTerminalSemantics !== 'string'
    || input.baselineTerminalSemantics.length === 0
    || input.candidateTerminalSemantics !== input.baselineTerminalSemantics
    || input.candidateOnlyDurableResumeUnsupported !== false
  ) {
    fail('KIMI_D9_DESKTOP_RECOVERY_BOUNDARY_INVALID');
  }
  return true;
}

function turnsForDesktopStratum(stratum, fixtureId, historyDigest) {
  switch (stratum) {
    case 'desktop-no-tool-multiturn':
      return [
        { kind: 'model', ordinal: 1, toolPolicy: 'none' },
        { kind: 'model', ordinal: 2, toolPolicy: 'none', continuityFrom: 1 },
      ];
    case 'desktop-single-tool':
      return [
        { kind: 'model', ordinal: 1, expectedTool: 'd9_fixture_echo', fixtureId },
        { kind: 'model', ordinal: 2, toolPolicy: 'none', continuityFrom: 1 },
      ];
    case 'desktop-multi-tool':
      return [
        { kind: 'model', ordinal: 1, expectedTool: 'd9_fixture_accumulate', fixtureId },
        { kind: 'model', ordinal: 2, expectedTool: 'd9_fixture_accumulate', fixtureId },
        { kind: 'model', ordinal: 3, toolPolicy: 'none', continuityFrom: 2 },
      ];
    case 'desktop-long-synthesized-history':
      return [
        { kind: 'model', ordinal: 1, synthesizedHistoryDigest: historyDigest },
        { kind: 'model', ordinal: 2, toolPolicy: 'none', continuityFrom: 1 },
      ];
    case 'desktop-new-invocation-recovery':
      return [
        { kind: 'recovery', ordinal: 1, phase: 'before-first-assistant' },
        { kind: 'model', ordinal: 2, toolPolicy: 'none' },
      ];
    default:
      fail('KIMI_D9_DESKTOP_STRATUM_INVALID');
  }
}

export function createDesktopStratumPlan({
  stratum,
  fixtureId,
  promptDigest,
  synthesizedHistoryDigest,
}) {
  if (
    !DESKTOP_STRATA.has(stratum)
    || typeof fixtureId !== 'string'
    || fixtureId.length === 0
    || !SHA256_PATTERN.test(promptDigest)
    || (
      stratum === 'desktop-long-synthesized-history'
        ? !SHA256_PATTERN.test(synthesizedHistoryDigest)
        : synthesizedHistoryDigest !== null
    )
  ) {
    fail('KIMI_D9_DESKTOP_STRATUM_INVALID');
  }
  const recoveryBoundary = stratum === 'desktop-new-invocation-recovery'
    ? freeze({
        recoveryPhase: 'before-first-assistant',
        canonicalHistoryRoleVector: ['system', 'user'],
        baselineTerminalSemantics: 'task-not-started',
        candidateTerminalSemantics: 'task-not-started',
        candidateOnlyDurableResumeUnsupported: false,
      })
    : null;
  if (recoveryBoundary) validateDesktopRecoveryBoundary(recoveryBoundary);
  const turns = turnsForDesktopStratum(
    stratum,
    fixtureId,
    synthesizedHistoryDigest,
  );
  const expectedFixtureInvocations = turns.filter(
    turn => typeof turn.expectedTool === 'string',
  ).length;
  return freeze({
    stratum,
    surface: 'desktop',
    packagedProductOnly: true,
    validatorId: `d9-validator:${stratum}:v1`,
    fixtureId,
    promptDigest,
    synthesizedHistoryDigest,
    turns,
    expectedFixtureInvocations,
    recoveryInvocationCount: recoveryBoundary ? 2 : 1,
    recoveryBoundary,
  });
}

export function validateDesktopStratumEvidence(evidence) {
  if (
    !DESKTOP_STRATA.has(evidence?.stratum)
    || !Number.isSafeInteger(evidence.completedTurns)
    || evidence.completedTurns !== evidence.expectedTurns
    || !Number.isSafeInteger(evidence.fixtureInvocations)
    || evidence.fixtureInvocations !== evidence.expectedFixtureInvocations
    || evidence.continuityMarkersMatched !== true
    || !TERMINAL_STATUSES.has(evidence.terminalStatus)
    || evidence.terminalStatus !== 'completed'
  ) {
    fail('KIMI_D9_DESKTOP_STRATUM_EVIDENCE_INVALID');
  }
  if (
    evidence.stratum === 'desktop-long-synthesized-history'
    && !SHA256_PATTERN.test(evidence.synthesizedHistoryDigest)
  ) {
    fail('KIMI_D9_DESKTOP_STRATUM_EVIDENCE_INVALID');
  }
  if (evidence.stratum === 'desktop-new-invocation-recovery') {
    if (evidence.recoveryInvocationCount !== 2) {
      fail('KIMI_D9_DESKTOP_STRATUM_EVIDENCE_INVALID');
    }
    try {
      validateDesktopRecoveryBoundary(evidence.recoveryBoundary);
    } catch {
      fail('KIMI_D9_DESKTOP_STRATUM_EVIDENCE_INVALID');
    }
  }
  return Object.freeze({
    success: true,
    stratum: evidence.stratum,
  });
}

export function digestTaskIdentity(taskId) {
  if (typeof taskId !== 'string' || taskId.length === 0) {
    fail('KIMI_D9_DESKTOP_TASK_ID_INVALID');
  }
  return createHash('sha256').update(taskId, 'utf8').digest('hex');
}
