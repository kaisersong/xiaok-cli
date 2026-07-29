import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const TMUX_BIN = '/opt/homebrew/bin/tmux';
const STRATA = [
  'cli-no-tool-multiturn',
  'cli-single-tool',
  'cli-multi-tool',
  'cli-long-history',
  'cli-compaction-parent-continuation',
] as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

const FAKE_CLI_SOURCE = String.raw`
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(91);
const configDir = process.env.XIAOK_CONFIG_DIR;
const traceRoot = process.env.XIAOK_TRACE_DIR;
const workspace = process.cwd();
const sessionId = 'sess_' + process.pid;
const transcriptDir = join(configDir, 'transcripts');
const sessionDir = join(configDir, 'sessions');
const traceDir = join(traceRoot, sessionId);
mkdirSync(transcriptDir, { recursive: true });
mkdirSync(sessionDir, { recursive: true });
mkdirSync(traceDir, { recursive: true });
mkdirSync(join(workspace, '.xiaok', 'state'), { recursive: true });
writeFileSync(join(workspace, '.xiaok', 'state', 'capability-health.json'), JSON.stringify({
  schemaVersion: 1,
  entries: [{
    cwd: workspace,
    snapshot: {
      updatedAt: Date.now(),
      summary: 'mcp:d9_fixture connected (2 tools)',
      capabilities: [{
        kind: 'mcp',
        name: 'd9_fixture',
        status: 'connected',
        detail: '2 tools',
      }],
    },
  }],
}));
const transcriptPath = join(transcriptDir, sessionId + '.jsonl');
const sessionPath = join(sessionDir, sessionId + '.json');
const messages = [];
const compactions = [];
let usage = { inputTokens: 0, outputTokens: 0 };
let turnIndex = 0;
function record(event) {
  appendFileSync(transcriptPath, JSON.stringify({ ...event, timestamp: Date.now() }) + '\n');
}
function persist() {
  writeFileSync(sessionPath, JSON.stringify({
    schemaVersion: 1,
    sessionId,
    cwd: workspace,
    messages,
    usage,
    compactions,
  }));
}
function ready() {
  record({ type: 'input_read_attach' });
}
persist();
ready();
const rl = readline.createInterface({ input: process.stdin, terminal: true });
rl.on('line', (line) => {
  record({ type: 'input_read_detach', reason: 'submit' });
  record({ type: 'input_submit', value: line });
  if (line === '/exit') {
    rl.close();
    return;
  }
  if (line === '/compact') {
    compactions.push({ replacedMessages: Math.max(1, messages.length - 2) });
    const notice = '已压缩较早对话，释放上下文空间。';
    process.stdout.write(notice + '\n');
    record({ type: 'output', stream: 'stdout', raw: notice, normalized: notice });
    persist();
    ready();
    return;
  }
  turnIndex += 1;
  const markerMatch = line.match(/MARKER:([A-Z0-9_]+)/u);
  const marker = markerMatch ? markerMatch[1] : 'D9_MISSING_MARKER';
  const calculation = line.match(/CALC:(\d+)\+(\d+)/u);
  const calculatedResult = calculation
    ? String(Number(calculation[1]) + Number(calculation[2]))
    : 'D9_MISSING_RESULT';
  const previousAssistant = [...messages].reverse().find(
    message => message.role === 'assistant',
  );
  const previousFrame = previousAssistant?.content[0]?.text
    .match(/D9_RESULT_B64:([A-Za-z0-9_-]+)/u)?.[1];
  const previousPayload = previousFrame
    ? JSON.parse(Buffer.from(previousFrame, 'base64url').toString('utf8'))
    : null;
  const resultPayload = {
    result: line.includes('SEMANTIC_WRONG')
      ? 'D9_WRONG_RESULT'
      : calculatedResult,
    previousResult: line.includes('CONTINUITY_WRONG')
      ? 'D9_WRONG_PREVIOUS_RESULT'
      : previousPayload?.result ?? null,
  };
  const resultFrame = Buffer.from(
    JSON.stringify(resultPayload),
    'utf8',
  ).toString('base64url');
  const tools = line.includes(' MULTI_TOOL')
    ? ['mcp__d9_fixture__d9_fixture_echo', 'mcp__d9_fixture__d9_fixture_accumulate']
    : line.includes(' SINGLE_TOOL')
      ? ['mcp__d9_fixture__d9_fixture_echo']
      : [];
  const failed = line.includes('PROVIDER_422');
  const output = [
    marker,
    'D9_RESULT_B64:' + resultFrame,
    failed ? 'provider error 422' : 'deterministic result',
  ].filter(Boolean).join(' ');
  process.stdout.write(output + '\n');
  record({ type: 'output', stream: 'stdout', raw: output, normalized: output });
  messages.push({ role: 'user', content: [{ type: 'text', text: line }] });
  messages.push({ role: 'assistant', content: [{ type: 'text', text: output }] });
  if (!line.includes('USAGE_MISSING')) {
    usage = { inputTokens: 10 + turnIndex, outputTokens: 2 + turnIndex };
  } else {
    usage = {};
  }
  const turnId = 'turn_' + turnIndex;
  const traceBundle = (recordedToolCalls) => ({
    schemaVersion: 1,
    scope: { kind: 'session', sessionId },
    turns: [{ id: turnId }],
    events: [{
      id: turnId + ':terminal',
      type: failed ? 'runtime.turn_failed' : 'runtime.turn_completed',
      refs: { turnId },
    }],
    toolCalls: recordedToolCalls.map((name, index) => ({
      id: turnId + ':tool:' + index,
      turnId,
      name,
      ok: !line.includes('TOOL_FAILURE'),
    })),
    summary: { toolCallCount: recordedToolCalls.length },
  });
  if (line.includes('DELAY_TOOL_BUNDLE')) {
    writeFileSync(
      join(traceDir, 'trace-' + turnIndex + '-a-terminal.json'),
      JSON.stringify(traceBundle([])),
    );
    setTimeout(() => {
      writeFileSync(
        join(traceDir, 'trace-' + turnIndex + '-b-complete.json'),
        JSON.stringify(traceBundle(tools)),
      );
    }, 40);
  } else {
    writeFileSync(
      join(traceDir, 'trace-' + turnIndex + '.json'),
      JSON.stringify(traceBundle(tools)),
    );
  }
  persist();
  ready();
});
`;

async function loadDriver(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-driver.mjs',
  )).href);
}

async function loadRecord(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/session-record.mjs',
  )).href);
}

async function syntheticInteractiveClosure(): Promise<{
  root: string;
  closureRoot: string;
  manifestPath: string;
  manifestHash: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'kimi-d9-cli-runner-'));
  roots.push(root);
  const closureRoot = join(root, 'closure');
  for (const directory of [
    'dist',
    'data',
    'node_modules/fixture',
    'runtime/node/bin',
    'runtime/guard',
  ]) {
    await mkdir(join(closureRoot, directory), { recursive: true });
  }
  await writeFile(join(closureRoot, 'dist/index.js'), FAKE_CLI_SOURCE);
  await writeFile(join(closureRoot, 'data/catalog.json'), '{}\n');
  await writeFile(join(closureRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(closureRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(closureRoot, 'node_modules/fixture/index.js'), 'export {};\n');
  await writeFile(
    join(closureRoot, 'runtime/guard/runtime-guard.mjs'),
    await readFile(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/runtime-guard.mjs',
    )),
  );
  await writeFile(
    join(closureRoot, 'runtime/node/bin/node'),
    `#!/bin/sh\nexec '${process.execPath}' "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(join(closureRoot, 'runtime/node/bin/node'), 0o755);
  const { attestCliRuntimeClosure } = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/cli-closure-build.mjs',
  )).href);
  const { canonicalize } = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/canonical.mjs',
  )).href);
  const attestation = await attestCliRuntimeClosure(closureRoot);
  const allowedModuleRelativePaths = ['dist/index.js'];
  const manifest = {
    schemaVersion: 1,
    artifactKind: 'cli-runtime-closure-v1',
    closureRoot: attestation.physicalIdentity.realpath,
    closureAttestation: attestation,
    nodeRelativePath: 'runtime/node/bin/node',
    entryRelativePath: 'dist/index.js',
    guardRelativePath: 'runtime/guard/runtime-guard.mjs',
    allowedModuleRelativePaths,
    resolutionGraphDigest: createHash('sha256').update(canonicalize({
      entryRelativePath: 'dist/index.js',
      modules: allowedModuleRelativePaths,
    })).digest('hex'),
  };
  const bytes = canonicalize(manifest);
  const manifestPath = join(root, 'closure-manifest.json');
  await writeFile(manifestPath, bytes, { mode: 0o400 });
  return {
    root,
    closureRoot: attestation.physicalIdentity.realpath,
    manifestPath,
    manifestHash: createHash('sha256').update(bytes).digest('hex'),
  };
}

function planInput(stratum: typeof STRATA[number]) {
  const modelTurns = stratum === 'cli-long-history'
    ? 4
    : stratum === 'cli-compaction-parent-continuation'
      ? 3
      : 2;
  const markers = Array.from(
    { length: modelTurns },
    (_, index) => `D9_${stratum.replace(/[^A-Z0-9]/giu, '_').toUpperCase()}_${index}`,
  );
  const calculations = [
    [2, 3],
    [4, 4],
    [6, 7],
    [9, 8],
  ].slice(0, modelTurns);
  const expectedResults = calculations.map(
    ([left, right]) => String(left + right),
  );
  const prompts = markers.map((marker, index) => {
    const toolInstruction = stratum === 'cli-single-tool' && index === 0
      ? ' SINGLE_TOOL'
      : stratum === 'cli-multi-tool' && index === 0
        ? ' MULTI_TOOL'
        : '';
    const corpus = stratum === 'cli-long-history'
      ? ` ${'history-safe-user-text '.repeat(128)}`
      : '';
    const [left, right] = calculations[index];
    return `MARKER:${marker} CALC:${left}+${right} Return one D9_RESULT_B64 frame with the computed result and the prior turn result, if any.${toolInstruction}${corpus}`;
  });
  return {
    stratum,
    fixtureId: `fixture:${stratum}`,
    assistantMarkers: markers,
    prompts,
    validators: expectedResults.map((expectedResult, index) => ({
      kind: 'result-digest-v1',
      resultDigest: createHash('sha256')
        .update(JSON.stringify(expectedResult))
        .digest('hex'),
      previousResultDigest: index === 0
        ? null
        : createHash('sha256')
          .update(JSON.stringify(expectedResults[index - 1]))
          .digest('hex'),
    })),
    historyRoleVector: ['user'],
    sameLiveTask: stratum === 'cli-compaction-parent-continuation',
  };
}

function sessionRunInput(
  frozen: Awaited<ReturnType<typeof syntheticInteractiveClosure>>,
  plan: unknown,
) {
  return {
    closureManifestPath: frozen.manifestPath,
    closureManifestHash: frozen.manifestHash,
    plan,
    profile: 'k3',
    arm: 'candidate',
    preservedThinking: true,
    productConfigBytes: Buffer.from('{"provider":"kimi"}\n'),
    mcpSettingsBytes: Buffer.from('{"mcpServers":{"d9_fixture":{}}}\n'),
    sessionRootParent: frozen.root,
    tmuxExecutable: TMUX_BIN,
    timeoutMs: 5_000,
    preserveSessionRoot: true,
  };
}

describe('Kimi K3 D9 CLI strata', () => {
  it('freezes all five single-process live-TTY plans and rejects durable assistant recovery', async () => {
    const {
      createCliStratumPlan,
      validateCliFixtureBoundary,
    } = await loadDriver();
    const driverSource = await readFile(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/cli-driver.mjs',
    ), 'utf8');
    expect(driverSource).toContain('withExternalTimeout');
    for (const stratum of STRATA) {
      const plan = createCliStratumPlan(planInput(stratum));
      expect(plan.processCount).toBe(1);
      expect(plan.tty).toBe(true);
      expect(plan.durableResume).toBe(false);
      expect(JSON.stringify(plan)).not.toMatch(/--resume|--continue|--fork-session/u);
      if (stratum === 'cli-compaction-parent-continuation') {
        expect(plan.turns.filter((turn: any) => turn.command === '/compact')).toHaveLength(1);
        expect(plan.sameLiveTask).toBe(true);
      }
    }

    expect(() => validateCliFixtureBoundary({
      stratum: 'cli-compaction-parent-continuation',
      historyRoleVector: ['user', 'assistant'],
      sameLiveTask: true,
    })).toThrow('KIMI_K3_DURABLE_RESUME_UNSUPPORTED');
    expect(() => validateCliFixtureBoundary({
      stratum: 'cli-compaction-parent-continuation',
      historyRoleVector: ['user'],
      sameLiveTask: false,
    })).toThrow('KIMI_D9_CLI_DURABLE_BOUNDARY_INVALID');
  });

  it('runs all five strata through fresh real tmux TTY product sessions with bounded evidence', async () => {
    const {
      createCliStratumPlan,
      runCliProductSession,
    } = await loadDriver();
    const frozen = await syntheticInteractiveClosure();
    const processDigests = new Set<string>();
    const sessionDigests = new Set<string>();

    for (const stratum of STRATA) {
      const result = await runCliProductSession(sessionRunInput(
        frozen,
        createCliStratumPlan(planInput(stratum)),
      ));
      expect(result.evidence).toMatchObject({
        schemaVersion: 1,
        surface: 'cli',
        profile: 'k3',
        arm: 'candidate',
        stratum,
        status: 'completed',
        plannedTurnCount: planInput(stratum).prompts.length,
        promptCacheKeySent: false,
        taskSuccess: true,
        continuitySuccess: true,
        toolSuccess: true,
      });
      expect(result.evidence.processIdentityDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.evidence.sessionIdentityDigest).toMatch(/^[0-9a-f]{64}$/u);
      processDigests.add(result.evidence.processIdentityDigest);
      sessionDigests.add(result.evidence.sessionIdentityDigest);

      const serialized = JSON.stringify(result.evidence);
      expect(Buffer.byteLength(serialized)).toBeLessThan(16_384);
      expect(serialized).not.toContain('MARKER:');
      expect(serialized).not.toContain(frozen.root);
      expect(serialized).not.toContain('sess_');
      expect(serialized).not.toContain('deterministic result');
      expect(serialized).not.toContain('provider":"kimi');

      const configMode = (await stat(join(
        result.runtime.sessionRoot,
        'config',
        'config.json',
      ))).mode & 0o777;
      expect(configMode).toBe(0o600);
      expect(result.runtime.productPid).toBeGreaterThan(0);
      expect(result.runtime.tty).toBe(true);

      if (stratum === 'cli-single-tool') {
        expect(result.evidence.observedToolNames).toEqual([
          'mcp__d9_fixture__d9_fixture_echo',
        ]);
        expect(result.evidence.usage.status).toBe('incomplete');
      }
      if (stratum === 'cli-multi-tool') {
        expect(result.evidence.observedToolNames).toEqual([
          'mcp__d9_fixture__d9_fixture_echo',
          'mcp__d9_fixture__d9_fixture_accumulate',
        ]);
        expect(result.evidence.usage.status).toBe('incomplete');
      }
      if (stratum === 'cli-compaction-parent-continuation') {
        expect(result.evidence.processIdentityObservationCount)
          .toBeGreaterThanOrEqual(3);
        expect(result.evidence.sessionIdentityObservationCount)
          .toBeGreaterThanOrEqual(2);
        expect(result.evidence.compaction).toEqual({
          sameLiveTask: true,
          productNoticeObserved: true,
          recordCount: 1,
          replacedMessages: expect.any(Number),
        });
      }
    }
    expect(processDigests.size).toBe(5);
    expect(sessionDigests.size).toBe(5);
  }, 30_000);

  it('fails semantic, follow-up, and structured tool validators before raw output is discarded', async () => {
    const {
      createCliStratumPlan,
      runCliProductSession,
    } = await loadDriver();
    const frozen = await syntheticInteractiveClosure();

    const semanticInput = planInput('cli-no-tool-multiturn');
    semanticInput.prompts[0] += ' SEMANTIC_WRONG';
    semanticInput.prompts[1] += ' CONTINUITY_WRONG';
    const semanticResult = await runCliProductSession(sessionRunInput(
      frozen,
      createCliStratumPlan(semanticInput),
    ));
    expect(semanticResult.evidence).toMatchObject({
      status: 'failed',
      taskSuccess: false,
      continuitySuccess: false,
      turns: [
        { semanticSuccess: false, continuitySuccess: true },
        { semanticSuccess: true, continuitySuccess: false },
      ],
    });

    const toolInput = planInput('cli-single-tool');
    toolInput.prompts[0] += ' TOOL_FAILURE';
    const toolResult = await runCliProductSession(sessionRunInput(
      frozen,
      createCliStratumPlan(toolInput),
    ));
    expect(toolResult.evidence).toMatchObject({
      status: 'failed',
      toolSuccess: false,
      failedToolCallCount: 1,
    });
    expect(toolResult.evidence.observedToolNames).toEqual([
      'mcp__d9_fixture__d9_fixture_echo',
    ]);

    const delayedToolInput = planInput('cli-single-tool');
    delayedToolInput.prompts[0] += ' DELAY_TOOL_BUNDLE';
    const delayedToolResult = await runCliProductSession(sessionRunInput(
      frozen,
      createCliStratumPlan(delayedToolInput),
    ));
    expect(delayedToolResult.evidence).toMatchObject({
      status: 'completed',
      toolSuccess: true,
      failedToolCallCount: 0,
    });
  }, 15_000);

  it('re-reads physical process and session identities around same-live-task compaction', async () => {
    const {
      createCliStratumPlan,
      runCliProductSession,
    } = await loadDriver();
    const { TmuxPtySession } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/tty-driver.mjs',
    )).href);
    const frozen = await syntheticInteractiveClosure();
    const originalPanePid = TmuxPtySession.prototype.panePid;
    let initialPid: number | undefined;
    TmuxPtySession.prototype.panePid = async function panePidWithDrift() {
      const actual = await originalPanePid.call(this);
      if (initialPid === undefined) {
        initialPid = actual;
        return actual;
      }
      return actual + 1;
    };
    try {
      await expect(runCliProductSession(sessionRunInput(
        frozen,
        createCliStratumPlan(
          planInput('cli-compaction-parent-continuation'),
        ),
      ))).rejects.toThrow('KIMI_D9_CLI_SESSION_IDENTITY_INVALID');
    } finally {
      TmuxPtySession.prototype.panePid = originalPanePid;
    }
  }, 10_000);

  it('bounds tmux startup and cleanup hangs with one full-session deadline', async () => {
    const {
      createCliStratumPlan,
      runCliProductSession,
    } = await loadDriver();
    const { TmuxPtySession } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/tty-driver.mjs',
    )).href);
    const frozen = await syntheticInteractiveClosure();
    const originalStart = TmuxPtySession.prototype.start;
    TmuxPtySession.prototype.start = () => new Promise(() => {});
    try {
      const startupInput = sessionRunInput(
        frozen,
        createCliStratumPlan(planInput('cli-no-tool-multiturn')),
      );
      startupInput.timeoutMs = 50;
      const startupOutcome = await Promise.race([
        runCliProductSession(startupInput).then(
          () => 'resolved',
          (error: unknown) => String(error),
        ),
        new Promise(resolve => setTimeout(() => resolve('hung'), 500)),
      ]);
      expect(startupOutcome).toContain('KIMI_D9_PRODUCT_TIMEOUT');
    } finally {
      TmuxPtySession.prototype.start = originalStart;
    }

    const originalStop = TmuxPtySession.prototype.stop;
    TmuxPtySession.prototype.stop = async function stopThenHang() {
      await originalStop.call(this);
      return new Promise(() => {});
    };
    try {
      const cleanupInput = sessionRunInput(
        frozen,
        createCliStratumPlan(planInput('cli-no-tool-multiturn')),
      );
      cleanupInput.timeoutMs = 500;
      const cleanupOutcome = await Promise.race([
        runCliProductSession(cleanupInput),
        new Promise(resolve => setTimeout(() => resolve('hung'), 2_000)),
      ]);
      expect(cleanupOutcome).not.toBe('hung');
      expect((cleanupOutcome as any).evidence.status).toBe('completed');
    } finally {
      TmuxPtySession.prototype.stop = originalStop;
    }
  }, 10_000);

  it('retains missing timing, usage, provider 4xx and timeout in the planned denominator', async () => {
    const {
      buildBoundedCliSessionRecord,
      reduceCliUsageEvidence,
    } = await loadRecord();
    expect(reduceCliUsageEvidence({
      stratum: 'cli-no-tool-multiturn',
      perTurnSnapshots: [{ inputTokens: null, outputTokens: null }],
    })).toEqual({
      status: 'missing',
      inputTokens: null,
      outputTokens: null,
    });

    const record = buildBoundedCliSessionRecord({
      profile: 'k3',
      arm: 'candidate',
      stratum: 'cli-no-tool-multiturn',
      fixtureId: 'fixture:failure',
      closureManifestHash: '11'.repeat(32),
      processId: 123,
      sessionId: 'secret-session-id',
      processIdentityObservationCount: 1,
      sessionIdentityObservationCount: 1,
      turns: [
        {
          marker: 'secret-marker',
          ttfvMs: null,
          totalLatencyMs: null,
          terminalStatus: 'failed',
          semanticPassed: false,
          continuityPassed: true,
          expectedToolNames: [],
          observedToolCalls: [],
        },
        {
          marker: 'secret-follow-up',
          ttfvMs: null,
          totalLatencyMs: null,
          terminalStatus: 'timeout',
          semanticPassed: false,
          continuityPassed: false,
          expectedToolNames: [],
          observedToolCalls: [],
        },
      ],
      usage: { status: 'missing', inputTokens: null, outputTokens: null },
      providerErrorClass: 'reasoning-422',
      compaction: null,
      promptCacheKeySent: false,
    });
    expect(record).toMatchObject({
      status: 'failed',
      plannedTurnCount: 2,
      completedTurnCount: 0,
      missingTimingCount: 2,
      timeoutCount: 1,
      reasoningRelated4xxCount: 1,
      usage: { status: 'missing' },
    });
    expect(JSON.stringify(record)).not.toContain('secret-');
  });
});
