import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attestFrozenDesktopFixtureRuntime,
} from './desktop-fixture-runtime.mjs';
import { runPackagedRendererTask } from './playwright-driver.mjs';

const FIXTURE_SERVER_NAME = 'd9_fixture';
const FIXTURE_PLUGIN_NAME = 'd9-fixture';
const EXPECTED_TOOL_RESULTS_BY_STRATUM = Object.freeze({
  'desktop-no-tool-multiturn': Object.freeze([0, 0]),
  'desktop-single-tool': Object.freeze([1, 0]),
  'desktop-multi-tool': Object.freeze([1, 1, 0]),
  'desktop-long-synthesized-history': Object.freeze([0, 0]),
  'desktop-new-invocation-recovery': Object.freeze([0, 0]),
});
const EXPECTED_INVOCATION_KEYS = Object.freeze([
  'toolName',
  'canonicalArgs',
  'cwd',
  'nonce',
  'environmentDigest',
  'assignmentDigest',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CLEANUP_TIMEOUT_MS = 2_000;
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const requireFromDesktop = createRequire(join(REPO_ROOT, 'desktop', 'package.json'));

function fail(code) {
  throw new Error(code);
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolvePromise => setTimeout(resolvePromise, delayMs));
}

function isAbsolutePath(value) {
  return typeof value === 'string' && isAbsolute(value);
}

function isWithin(root, child) {
  const path = relative(resolve(root), resolve(child));
  return path === ''
    || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function remainingMs(
  deadline,
  nowImpl,
  failureCode = 'KIMI_D9_DESKTOP_SESSION_TIMEOUT',
) {
  const remaining = Math.floor(deadline - nowImpl());
  if (remaining <= 0) fail(failureCode);
  return remaining;
}

async function boundedOperation(operation, timeoutMs, failureCode) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, rejectPromise) => {
        timer = setTimeout(() => {
          rejectPromise(new Error(failureCode));
        }, Math.max(1, timeoutMs));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateExpectedInvocation(invocation, pluginRoot) {
  if (
    typeof invocation !== 'object'
    || invocation === null
    || Array.isArray(invocation)
    || Object.keys(invocation).length !== EXPECTED_INVOCATION_KEYS.length
    || EXPECTED_INVOCATION_KEYS.some(key => (
      typeof invocation[key] !== 'string' || invocation[key].length === 0
    ))
    || !['d9_fixture_echo', 'd9_fixture_accumulate'].includes(
      invocation.toolName,
    )
    || invocation.cwd !== pluginRoot
    || !SHA256_PATTERN.test(invocation.nonce)
    || !SHA256_PATTERN.test(invocation.environmentDigest)
    || !SHA256_PATTERN.test(invocation.assignmentDigest)
  ) {
    fail('KIMI_D9_DESKTOP_FIXTURE_CONTRACT_INVALID');
  }
  try {
    const args = JSON.parse(invocation.canonicalArgs);
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      fail('KIMI_D9_DESKTOP_FIXTURE_CONTRACT_INVALID');
    }
  } catch {
    fail('KIMI_D9_DESKTOP_FIXTURE_CONTRACT_INVALID');
  }
}

function validateRunnerInput({
  session,
  launch,
  fixtureRuntime,
  expectedInvocations,
  stratum,
  turns,
  timeoutMs,
  pollIntervalMs,
}) {
  const expectedToolResults = EXPECTED_TOOL_RESULTS_BY_STRATUM[stratum];
  const isolatedPaths = [
    session?.userData,
    session?.home,
    session?.config,
    session?.temp,
    session?.workspace,
  ];
  if (
    !expectedToolResults
    || !isAbsolutePath(session?.sessionRoot)
    || isolatedPaths.some(path => !isAbsolutePath(path))
    || new Set(isolatedPaths).size !== isolatedPaths.length
    || isolatedPaths.some(path => !isWithin(session.sessionRoot, path))
    || !isAbsolutePath(session?.portReservationPath)
    || !isWithin(session.sessionRoot, session.portReservationPath)
    || !Number.isSafeInteger(session?.debuggingPort)
    || session.debuggingPort < 1024
    || session.debuggingPort > 65_535
    || !isAbsolutePath(launch?.command)
    || !Array.isArray(launch?.args)
    || launch.args.some(argument => typeof argument !== 'string')
    || launch.cwd !== session.workspace
    || typeof launch.env !== 'object'
    || launch.env === null
    || !launch.args.includes(
      `--remote-debugging-port=${session.debuggingPort}`,
    )
    || !launch.args.includes(`--user-data-dir=${session.userData}`)
    || launch.env.HOME !== session.home
    || launch.env.XIAOK_CONFIG_DIR !== session.config
    || launch.env.TMPDIR !== session.temp
    || launch.env.TMP !== session.temp
    || launch.env.TEMP !== session.temp
    || fixtureRuntime?.schemaVersion !== 1
    || !isAbsolutePath(fixtureRuntime?.runtimeRoot)
    || !isAbsolutePath(fixtureRuntime?.nodeExecutable)
    || !isAbsolutePath(fixtureRuntime?.serverEntryPath)
    || !isAbsolutePath(fixtureRuntime?.guardPath)
    || !isAbsolutePath(fixtureRuntime?.sdkPackageRoot)
    || !isAbsolutePath(fixtureRuntime?.zodPackageRoot)
    || !isWithin(fixtureRuntime.runtimeRoot, fixtureRuntime.serverEntryPath)
    || !isWithin(fixtureRuntime.runtimeRoot, fixtureRuntime.guardPath)
    || !isWithin(fixtureRuntime.runtimeRoot, fixtureRuntime.sdkPackageRoot)
    || !isWithin(fixtureRuntime.runtimeRoot, fixtureRuntime.zodPackageRoot)
    || !SHA256_PATTERN.test(fixtureRuntime?.treeDigest)
    || !SHA256_PATTERN.test(fixtureRuntime?.nodeExecutableDigest)
    || !Array.isArray(expectedInvocations)
    || !Array.isArray(turns)
    || turns.length !== expectedToolResults.length
    || turns.length < 2
    || turns.some(turn => (
      typeof turn?.prompt !== 'string'
      || turn.prompt.length === 0
      || typeof turn.expectedMarker !== 'string'
      || turn.expectedMarker.length === 0
    ))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || !Number.isSafeInteger(pollIntervalMs)
    || pollIntervalMs < 0
  ) {
    fail('KIMI_D9_DESKTOP_SESSION_RUNNER_INPUT_INVALID');
  }
  const expectedInvocationCount = expectedToolResults.reduce(
    (sum, count) => sum + count,
    0,
  );
  if (expectedInvocations.length !== expectedInvocationCount) {
    fail('KIMI_D9_DESKTOP_FIXTURE_CONTRACT_INVALID');
  }
  const pluginRoot = join(session.config, 'plugins', FIXTURE_PLUGIN_NAME);
  for (const invocation of expectedInvocations) {
    validateExpectedInvocation(invocation, pluginRoot);
  }
  return {
    expectedToolResults,
    pluginRoot,
  };
}

async function writeSessionFixturePlugin({
  pluginRoot,
  fixtureRuntime,
  expectedInvocations,
}) {
  await mkdir(pluginRoot, { recursive: true, mode: 0o700 });
  const manifest = {
    name: FIXTURE_PLUGIN_NAME,
    version: '1.0.0',
    skills: [],
    agents: [],
    hooks: [],
    commands: [],
    mcpServers: [{
      name: FIXTURE_SERVER_NAME,
      type: 'stdio',
      command: fixtureRuntime.nodeExecutable,
      args: [
        '--no-global-search-paths',
        '--import',
        fixtureRuntime.guardPath,
        fixtureRuntime.serverEntryPath,
      ],
      env: {
        KIMI_D9_EXPECTED_INVOCATIONS: JSON.stringify(expectedInvocations),
        KIMI_D9_FIXTURE_RUNTIME_ROOT: fixtureRuntime.runtimeRoot,
      },
    }],
  };
  await writeFile(
    join(pluginRoot, 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

async function defaultConnectOverCDP(endpoint) {
  const { chromium } = requireFromDesktop('playwright');
  return chromium.connectOverCDP(endpoint);
}

function assertChildHealthy(childState) {
  if (childState.failure) throw childState.failure;
  if (childState.exited) fail('KIMI_D9_DESKTOP_APP_EXITED_EARLY');
}

async function connectBrowser({
  endpoint,
  connectOverCDPImpl,
  deadline,
  pollIntervalMs,
  waitImpl,
  nowImpl,
  childState,
}) {
  let lastError;
  do {
    assertChildHealthy(childState);
    try {
      return await boundedOperation(
        () => connectOverCDPImpl(endpoint),
        remainingMs(deadline, nowImpl, 'KIMI_D9_DESKTOP_CDP_ATTACH_FAILED'),
        'KIMI_D9_DESKTOP_CDP_ATTACH_FAILED',
      );
    } catch (error) {
      lastError = error;
    }
    await boundedOperation(
      () => waitImpl(pollIntervalMs),
      remainingMs(deadline, nowImpl),
      'KIMI_D9_DESKTOP_SESSION_TIMEOUT',
    );
  } while (nowImpl() < deadline);
  if (lastError) fail('KIMI_D9_DESKTOP_CDP_ATTACH_FAILED');
  fail('KIMI_D9_DESKTOP_CDP_ATTACH_FAILED');
}

async function selectRendererPage({
  browser,
  injectedPage,
  deadline,
  pollIntervalMs,
  waitImpl,
  nowImpl,
  childState,
}) {
  if (injectedPage) return injectedPage;
  do {
    assertChildHealthy(childState);
    const pages = browser.contexts()
      .flatMap(context => context.pages());
    const renderer = pages.find(page => (
      typeof page.url === 'function' && page.url().includes('renderer')
    ));
    if (renderer) return renderer;
    await boundedOperation(
      () => waitImpl(pollIntervalMs),
      remainingMs(deadline, nowImpl),
      'KIMI_D9_DESKTOP_SESSION_TIMEOUT',
    );
  } while (nowImpl() < deadline);
  fail('KIMI_D9_DESKTOP_RENDERER_PAGE_MISSING');
}

async function waitForFixtureReady({
  page,
  deadline,
  pollIntervalMs,
  waitImpl,
  nowImpl,
  childState,
}) {
  do {
    assertChildHealthy(childState);
    let servers;
    try {
      servers = await boundedOperation(
        () => page.evaluate(async () => (
          window.xiaokDesktop.listPluginMcpServers()
        )),
        remainingMs(
          deadline,
          nowImpl,
          'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
        ),
        'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
      );
    } catch {
      await boundedOperation(
        () => waitImpl(pollIntervalMs),
        remainingMs(
          deadline,
          nowImpl,
          'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
        ),
        'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
      );
      continue;
    }
    const fixture = Array.isArray(servers)
      ? servers.find(server => (
          server?.name === FIXTURE_SERVER_NAME
          && server?.pluginName === FIXTURE_PLUGIN_NAME
        ))
      : null;
    if (
      fixture?.connected === true
      && fixture?.enabled === true
      && fixture?.toolCount === 2
    ) {
      return Object.freeze({
        name: FIXTURE_SERVER_NAME,
        connected: true,
        toolCount: 2,
      });
    }
    await boundedOperation(
      () => waitImpl(pollIntervalMs),
      remainingMs(
        deadline,
        nowImpl,
        'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
      ),
      'KIMI_D9_DESKTOP_FIXTURE_NOT_READY',
    );
  } while (nowImpl() < deadline);
  fail('KIMI_D9_DESKTOP_FIXTURE_NOT_READY');
}

async function terminateChild(
  child,
  waitImpl,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  let exited = false;
  const exitedPromise = new Promise(resolvePromise => {
    child.once('exit', () => {
      exited = true;
      resolvePromise();
    });
  });
  child.kill('SIGTERM');
  await boundedOperation(
    () => Promise.race([exitedPromise, waitImpl(cleanupTimeoutMs)]),
    cleanupTimeoutMs,
    'KIMI_D9_DESKTOP_CLEANUP_TIMEOUT',
  ).catch(() => {});
  if (!exited && child.exitCode === null && !child.signalCode) {
    child.kill('SIGKILL');
  }
}

async function closeBrowser(
  browser,
  cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
) {
  if (!browser?.close) return;
  await boundedOperation(
    () => browser.close(),
    cleanupTimeoutMs,
    'KIMI_D9_DESKTOP_CLEANUP_TIMEOUT',
  );
}

export async function runPackagedDesktopSession(input) {
  const {
    session,
    launch,
    fixtureRuntime,
    expectedInvocations,
    stratum,
    turns,
    timeoutMs,
    pollIntervalMs,
    dependencies = {},
  } = input ?? {};
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const connectOverCDPImpl = dependencies.connectOverCDPImpl
    ?? defaultConnectOverCDP;
  const runPackagedRendererTaskImpl =
    dependencies.runPackagedRendererTaskImpl ?? runPackagedRendererTask;
  const waitImpl = dependencies.waitImpl ?? wait;
  const nowImpl = dependencies.nowImpl ?? Date.now;
  const attestFrozenDesktopFixtureRuntimeImpl =
    dependencies.attestFrozenDesktopFixtureRuntimeImpl
    ?? attestFrozenDesktopFixtureRuntime;
  const cleanupTimeoutMs = Number.isSafeInteger(dependencies.cleanupTimeoutMs)
    && dependencies.cleanupTimeoutMs > 0
    ? Math.min(dependencies.cleanupTimeoutMs, CLEANUP_TIMEOUT_MS)
    : CLEANUP_TIMEOUT_MS;
  const lifecycleDeadline = nowImpl() + timeoutMs;
  let child;
  let browser;
  let childState = {
    exited: false,
    failure: null,
  };

  try {
    const {
      expectedToolResults,
      pluginRoot,
    } = validateRunnerInput({
      session,
      launch,
      fixtureRuntime,
      expectedInvocations,
      stratum,
      turns,
      timeoutMs,
      pollIntervalMs,
    });
    await boundedOperation(
      () => attestFrozenDesktopFixtureRuntimeImpl(fixtureRuntime),
      remainingMs(lifecycleDeadline, nowImpl),
      'KIMI_D9_DESKTOP_FIXTURE_RUNTIME_DRIFT',
    );
    await writeSessionFixturePlugin({
      pluginRoot,
      fixtureRuntime,
      expectedInvocations,
    });

    const launchInvocation = async () => {
      const invocationState = {
        exited: false,
        failure: null,
      };
      const invocationChild = spawnImpl(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: false,
      });
      if (
        typeof invocationChild?.once !== 'function'
        || typeof invocationChild?.kill !== 'function'
      ) {
        fail('KIMI_D9_DESKTOP_APP_SPAWN_FAILED');
      }
      child = invocationChild;
      childState = invocationState;
      invocationChild.stdout?.on?.('data', () => {});
      invocationChild.stderr?.on?.('data', () => {});
      invocationChild.once('error', () => {
        invocationState.failure =
          new Error('KIMI_D9_DESKTOP_APP_SPAWN_FAILED');
      });
      invocationChild.once('exit', (code, signal) => {
        if (code !== null || signal !== null) invocationState.exited = true;
      });

      const endpoint = `http://127.0.0.1:${session.debuggingPort}`;
      const invocationBrowser = await connectBrowser({
        endpoint,
        connectOverCDPImpl,
        deadline: lifecycleDeadline,
        pollIntervalMs,
        waitImpl,
        nowImpl,
        childState: invocationState,
      });
      browser = invocationBrowser;
      const invocationPage = await selectRendererPage({
        browser: invocationBrowser,
        injectedPage: dependencies.page,
        deadline: lifecycleDeadline,
        pollIntervalMs,
        waitImpl,
        nowImpl,
        childState: invocationState,
      });
      const invocationPlugin = await waitForFixtureReady({
        page: invocationPage,
        deadline: lifecycleDeadline,
        pollIntervalMs,
        waitImpl,
        nowImpl,
        childState: invocationState,
      });
      return {
        browser: invocationBrowser,
        child: invocationChild,
        childState: invocationState,
        page: invocationPage,
        plugin: invocationPlugin,
      };
    };

    let invocation = await launchInvocation();
    ({
      browser,
      child,
      childState,
    } = invocation);
    if (stratum === 'desktop-new-invocation-recovery') {
      await closeBrowser(browser, cleanupTimeoutMs);
      browser = undefined;
      await terminateChild(child, waitImpl, cleanupTimeoutMs);
      child = undefined;
      invocation = await launchInvocation();
      ({
        browser,
        child,
        childState,
      } = invocation);
    }
    const { page, plugin } = invocation;

    const records = [];
    for (let index = 0; index < turns.length; index += 1) {
      assertChildHealthy(childState);
      const turn = turns[index];
      let record;
      try {
        const turnTimeoutMs = remainingMs(lifecycleDeadline, nowImpl);
        record = await boundedOperation(
          () => runPackagedRendererTaskImpl({
            page,
            prompt: turn.prompt,
            expectedMarker: turn.expectedMarker,
            timeoutMs: turnTimeoutMs,
            pollIntervalMs,
          }),
          turnTimeoutMs,
          'KIMI_D9_DESKTOP_SESSION_TIMEOUT',
        );
      } catch (error) {
        if (error?.message === 'KIMI_D9_DESKTOP_SESSION_TIMEOUT') {
          throw error;
        }
        fail('KIMI_D9_DESKTOP_RENDERER_TASK_FAILED');
      }
      if (
        record?.status !== 'completed'
        || record.toolResultCount !== expectedToolResults[index]
      ) {
        fail('KIMI_D9_DESKTOP_TOOL_RESULT_COUNT_MISMATCH');
      }
      records.push(record);
    }

    return deepFreeze({
      schemaVersion: 1,
      stratum,
      status: 'completed',
      plugin,
      turns: records.map(record => ({
        taskIdDigest: record.taskIdDigest,
        status: record.status,
        eventTypes: [...record.eventTypes],
        usagePresent: record.usagePresent,
        toolResultCount: record.toolResultCount,
        durableCanaryCount: record.durableCanaryCount,
        timeToFirstUserVisibleAssistantContentMs:
          record.timeToFirstUserVisibleAssistantContentMs,
        totalLatencyMs: record.totalLatencyMs,
      })),
      recoveryInvocationCount:
        stratum === 'desktop-new-invocation-recovery' ? 2 : 1,
      totalToolResultCount: records.reduce(
        (sum, record) => sum + record.toolResultCount,
        0,
      ),
      totalLatencyMs: records.reduce(
        (sum, record) => sum + record.totalLatencyMs,
        0,
      ),
      timeToFirstUserVisibleAssistantContentMs:
        records[0].timeToFirstUserVisibleAssistantContentMs,
    });
  } finally {
    await closeBrowser(browser, cleanupTimeoutMs).catch(() => {});
    await terminateChild(child, waitImpl, cleanupTimeoutMs).catch(() => {});
    if (isAbsolute(session?.portReservationPath ?? '')) {
      await rm(session.portReservationPath, { force: true }).catch(() => {});
    }
  }
}
