import { EventEmitter } from 'node:events';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

async function loadRunner(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/desktop-session-runner.mjs',
  )).href);
}

class FakeChild extends EventEmitter {
  pid = 9123;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedWith: string[] = [];

  kill(signal: string) {
    this.killedWith.push(signal);
    this.exitCode = 0;
    this.emit('exit', 0, signal);
    return true;
  }
}

async function makeSessionRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sessionRoot = join(root, 'session');
  const userData = join(sessionRoot, 'user-data');
  const home = join(sessionRoot, 'home');
  const config = join(sessionRoot, 'config');
  const temp = join(sessionRoot, 'temp');
  const workspace = join(sessionRoot, 'workspace');
  for (const path of [userData, home, config, temp, workspace]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const portReservationPath = join(sessionRoot, '19341.lock');
  await writeFile(portReservationPath, 'reserved\n', { mode: 0o600 });
  return {
    root,
    session: {
      sessionRoot,
      userData,
      home,
      config,
      temp,
      workspace,
      debuggingPort: 19341,
      portReservationPath,
    },
  };
}

function fixtureRuntime(root: string) {
  const runtimeRoot = join(root, 'frozen-fixture-runtime');
  return {
    schemaVersion: 1,
    runtimeRoot,
    nodeExecutable: join(root, 'frozen-node', 'bin', 'node'),
    serverEntryPath: join(runtimeRoot, 'fixture-server-entry.mjs'),
    guardPath: join(runtimeRoot, 'fixture-runtime-guard.mjs'),
    sdkPackageRoot: join(
      runtimeRoot,
      'node_modules',
      '@modelcontextprotocol',
      'sdk',
    ),
    zodPackageRoot: join(runtimeRoot, 'node_modules', 'zod'),
    treeDigest: '44'.repeat(32),
    nodeExecutableDigest: '55'.repeat(32),
  };
}

function productLaunch(session: Awaited<ReturnType<typeof makeSessionRoot>>['session']) {
  return {
    command: '/private/tmp/xiaok.app/Contents/MacOS/xiaok',
    args: [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${session.debuggingPort}`,
      `--user-data-dir=${session.userData}`,
    ],
    cwd: session.workspace,
    env: {
      HOME: session.home,
      XIAOK_CONFIG_DIR: session.config,
      TMPDIR: session.temp,
      TMP: session.temp,
      TEMP: session.temp,
    },
  };
}

function expectedInvocation(pluginRoot: string) {
  return {
    toolName: 'd9_fixture_echo',
    canonicalArgs: '{"value":7}',
    cwd: pluginRoot,
    nonce: '11'.repeat(32),
    environmentDigest: '22'.repeat(32),
    assignmentDigest: '33'.repeat(32),
  };
}

function turns() {
  return [
    {
      prompt: 'RAW_FIRST_PROMPT',
      expectedMarker: 'RAW_FIRST_MARKER',
    },
    {
      prompt: 'RAW_FOLLOWUP_PROMPT',
      expectedMarker: 'RAW_FOLLOWUP_MARKER',
    },
  ];
}

function rendererResult(ordinal: number, toolResultCount: number) {
  return {
    taskIdDigest: String(ordinal).repeat(64),
    status: 'completed',
    eventTypes: toolResultCount > 0
      ? ['assistant_delta', 'canvas_tool_result', 'task_completed']
      : ['assistant_delta', 'task_completed'],
    usagePresent: true,
    toolResultCount,
    durableCanaryCount: 0,
    timeToFirstUserVisibleAssistantContentMs: ordinal * 10,
    totalLatencyMs: ordinal * 100,
  };
}

describe('Kimi K3 D9 packaged Desktop session runner', () => {
  it('registers the session fixture, waits for two tools, runs first and follow-up, and cleans up', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-runner-',
    );
    const runtime = fixtureRuntime(root);
    const pluginRoot = join(session.config, 'plugins', 'd9-fixture');
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => child);
    const browser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const connectOverCDPImpl = vi.fn()
      .mockRejectedValueOnce(new Error('CDP not listening yet'))
      .mockResolvedValueOnce(browser);
    const page = {
      evaluate: vi.fn()
        .mockRejectedValueOnce(new Error('preload not ready yet'))
        .mockResolvedValueOnce([{
          name: 'd9_fixture',
          pluginName: 'd9-fixture',
          connected: true,
          enabled: true,
          toolCount: 2,
        }]),
    };
    const runPackagedRendererTaskImpl = vi.fn()
      .mockResolvedValueOnce(rendererResult(1, 1))
      .mockResolvedValueOnce(rendererResult(2, 0));

    try {
      const record = await runPackagedDesktopSession({
        session,
        launch: productLaunch(session),
        fixtureRuntime: runtime,
        expectedInvocations: [expectedInvocation(pluginRoot)],
        stratum: 'desktop-single-tool',
        turns: turns(),
        timeoutMs: 100,
        pollIntervalMs: 0,
        dependencies: {
          spawnImpl,
          connectOverCDPImpl,
          page,
          runPackagedRendererTaskImpl,
          waitImpl: async () => {},
          attestFrozenDesktopFixtureRuntimeImpl: async () => true,
        },
      });

      const manifest = JSON.parse(await readFile(
        join(pluginRoot, 'plugin.json'),
        'utf8',
      ));
      expect(manifest).toEqual({
        name: 'd9-fixture',
        version: '1.0.0',
        skills: [],
        agents: [],
        hooks: [],
        commands: [],
        mcpServers: [{
          name: 'd9_fixture',
          type: 'stdio',
          command: runtime.nodeExecutable,
          args: [
            '--no-global-search-paths',
            '--import',
            runtime.guardPath,
            runtime.serverEntryPath,
          ],
          env: {
            KIMI_D9_EXPECTED_INVOCATIONS: JSON.stringify([
              expectedInvocation(pluginRoot),
            ]),
            KIMI_D9_FIXTURE_RUNTIME_ROOT: runtime.runtimeRoot,
          },
        }],
      });
      expect(spawnImpl).toHaveBeenCalledWith(
        '/private/tmp/xiaok.app/Contents/MacOS/xiaok',
        [
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=19341',
          `--user-data-dir=${session.userData}`,
        ],
        expect.objectContaining({
          cwd: session.workspace,
          env: productLaunch(session).env,
          shell: false,
        }),
      );
      expect(connectOverCDPImpl).toHaveBeenCalledWith(
        'http://127.0.0.1:19341',
      );
      expect(connectOverCDPImpl).toHaveBeenCalledTimes(2);
      expect(page.evaluate).toHaveBeenCalledTimes(2);
      expect(runPackagedRendererTaskImpl).toHaveBeenCalledTimes(2);
      expect(record).toEqual({
        schemaVersion: 1,
        stratum: 'desktop-single-tool',
        status: 'completed',
        plugin: {
          name: 'd9_fixture',
          connected: true,
          toolCount: 2,
        },
        turns: [
          rendererResult(1, 1),
          rendererResult(2, 0),
        ],
        recoveryInvocationCount: 1,
        totalToolResultCount: 1,
        totalLatencyMs: 300,
        timeToFirstUserVisibleAssistantContentMs: 10,
      });
      expect(JSON.stringify(record)).not.toMatch(
        /RAW_FIRST|RAW_FOLLOWUP|canonicalArgs|nonce/u,
      );
      expect(browser.close).toHaveBeenCalledOnce();
      expect(child.killedWith).toContain('SIGTERM');
      await expect(access(session.portReservationPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restarts the packaged product before the first assistant turn for the recovery stratum', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-recovery-',
    );
    const runtime = fixtureRuntime(root);
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    const spawnImpl = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const firstBrowser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const secondBrowser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const connectOverCDPImpl = vi.fn()
      .mockResolvedValueOnce(firstBrowser)
      .mockResolvedValueOnce(secondBrowser);
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: true,
        enabled: true,
        toolCount: 2,
      }]),
    };
    const renderer = vi.fn()
      .mockImplementation(async () => {
        expect(firstChild.killedWith).toContain('SIGTERM');
        return rendererResult(renderer.mock.calls.length, 0);
      });

    try {
      const record = await runPackagedDesktopSession({
        session,
        launch: productLaunch(session),
        fixtureRuntime: runtime,
        expectedInvocations: [],
        stratum: 'desktop-new-invocation-recovery',
        turns: turns(),
        timeoutMs: 100,
        pollIntervalMs: 0,
        dependencies: {
          spawnImpl,
          connectOverCDPImpl,
          page,
          runPackagedRendererTaskImpl: renderer,
          waitImpl: async () => {},
          attestFrozenDesktopFixtureRuntimeImpl: async () => true,
        },
      });

      expect(spawnImpl).toHaveBeenCalledTimes(2);
      expect(connectOverCDPImpl).toHaveBeenCalledTimes(2);
      expect(page.evaluate).toHaveBeenCalledTimes(2);
      expect(renderer).toHaveBeenCalledTimes(2);
      expect(firstBrowser.close).toHaveBeenCalledOnce();
      expect(secondBrowser.close).toHaveBeenCalledOnce();
      expect(firstChild.killedWith).toContain('SIGTERM');
      expect(secondChild.killedWith).toContain('SIGTERM');
      expect(record.recoveryInvocationCount).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when d9_fixture is disconnected or does not expose exactly two tools', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-not-ready-',
    );
    const runtime = fixtureRuntime(root);
    const pluginRoot = join(session.config, 'plugins', 'd9-fixture');
    const child = new FakeChild();
    const browser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: false,
        enabled: true,
        toolCount: 1,
      }]),
    };
    const renderer = vi.fn();
    let now = 0;

    try {
      await expect(runPackagedDesktopSession({
        session,
        launch: productLaunch(session),
        fixtureRuntime: runtime,
        expectedInvocations: [expectedInvocation(pluginRoot)],
        stratum: 'desktop-single-tool',
        turns: turns(),
        timeoutMs: 5,
        pollIntervalMs: 0,
        dependencies: {
          spawnImpl: () => child,
          connectOverCDPImpl: async () => browser,
          page,
          runPackagedRendererTaskImpl: renderer,
          waitImpl: async () => {},
          nowImpl: () => {
            now += 2;
            return now;
          },
          attestFrozenDesktopFixtureRuntimeImpl: async () => true,
        },
      })).rejects.toThrow('KIMI_D9_DESKTOP_FIXTURE_NOT_READY');
      expect(renderer).not.toHaveBeenCalled();
      expect(browser.close).toHaveBeenCalledOnce();
      expect(child.killedWith).toContain('SIGTERM');
      await expect(access(session.portReservationPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects stratum tool-result drift and still cleans browser, process, and port lock', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-drift-',
    );
    const runtime = fixtureRuntime(root);
    const pluginRoot = join(session.config, 'plugins', 'd9-fixture');
    const child = new FakeChild();
    const browser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: true,
        enabled: true,
        toolCount: 2,
      }]),
    };
    const renderer = vi.fn()
      .mockResolvedValueOnce(rendererResult(1, 1))
      .mockResolvedValueOnce(rendererResult(2, 1));

    try {
      await expect(runPackagedDesktopSession({
        session,
        launch: productLaunch(session),
        fixtureRuntime: runtime,
        expectedInvocations: [expectedInvocation(pluginRoot)],
        stratum: 'desktop-single-tool',
        turns: turns(),
        timeoutMs: 100,
        pollIntervalMs: 0,
        dependencies: {
          spawnImpl: () => child,
          connectOverCDPImpl: async () => browser,
          page,
          runPackagedRendererTaskImpl: renderer,
          waitImpl: async () => {},
          attestFrozenDesktopFixtureRuntimeImpl: async () => true,
        },
      })).rejects.toThrow(
        'KIMI_D9_DESKTOP_TOOL_RESULT_COUNT_MISMATCH',
      );
      expect(renderer).toHaveBeenCalledTimes(2);
      expect(browser.close).toHaveBeenCalledOnce();
      expect(child.killedWith).toContain('SIGTERM');
      await expect(access(session.portReservationPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses one lifecycle deadline instead of resetting the full timeout per turn', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-deadline-',
    );
    const runtime = fixtureRuntime(root);
    const pluginRoot = join(session.config, 'plugins', 'd9-fixture');
    const child = new FakeChild();
    const browser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: true,
        enabled: true,
        toolCount: 2,
      }]),
    };
    let now = 1_000;
    const renderer = vi.fn()
      .mockImplementationOnce(async () => {
        now += 60;
        return rendererResult(1, 1);
      })
      .mockResolvedValueOnce(rendererResult(2, 0));

    try {
      await runPackagedDesktopSession({
        session,
        launch: productLaunch(session),
        fixtureRuntime: runtime,
        expectedInvocations: [expectedInvocation(pluginRoot)],
        stratum: 'desktop-single-tool',
        turns: turns(),
        timeoutMs: 100,
        pollIntervalMs: 0,
        dependencies: {
          spawnImpl: () => child,
          connectOverCDPImpl: async () => browser,
          page,
          runPackagedRendererTaskImpl: renderer,
          waitImpl: async () => {},
          nowImpl: () => now,
          attestFrozenDesktopFixtureRuntimeImpl: async () => true,
        },
      });

      const firstTimeout = renderer.mock.calls[0][0].timeoutMs;
      const secondTimeout = renderer.mock.calls[1][0].timeoutMs;
      expect(firstTimeout).toBeLessThanOrEqual(100);
      expect(secondTimeout).toBeLessThan(firstTimeout);
      expect(secondTimeout).toBeLessThanOrEqual(40);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes renderer failures so raw prompts and secrets never escape', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-secret-',
    );
    const runtime = fixtureRuntime(root);
    const child = new FakeChild();
    const browser = {
      close: vi.fn(async () => {}),
      contexts: () => [],
    };
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: true,
        enabled: true,
        toolCount: 2,
      }]),
    };

    try {
      let errorMessage = '';
      try {
        await runPackagedDesktopSession({
          session,
          launch: productLaunch(session),
          fixtureRuntime: runtime,
          expectedInvocations: [],
          stratum: 'desktop-no-tool-multiturn',
          turns: turns(),
          timeoutMs: 100,
          pollIntervalMs: 0,
          dependencies: {
            spawnImpl: () => child,
            connectOverCDPImpl: async () => browser,
            page,
            runPackagedRendererTaskImpl: async () => {
              throw new Error(
                'RAW_FIRST_PROMPT Authorization: Bearer TOP_SECRET',
              );
            },
            waitImpl: async () => {},
            attestFrozenDesktopFixtureRuntimeImpl: async () => true,
            cleanupTimeoutMs: 1,
          },
        });
      } catch (error) {
        errorMessage = (error as Error).message;
      }
      expect(errorMessage).toBe('KIMI_D9_DESKTOP_RENDERER_TASK_FAILED');
      expect(errorMessage).not.toMatch(/RAW_FIRST_PROMPT|TOP_SECRET/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds browser cleanup even when close never settles', async () => {
    const { runPackagedDesktopSession } = await loadRunner();
    const { root, session } = await makeSessionRoot(
      'kimi-d9-desktop-session-cleanup-',
    );
    const runtime = fixtureRuntime(root);
    const child = new FakeChild();
    const browser = {
      close: vi.fn(() => new Promise(() => {})),
      contexts: () => [],
    };
    const page = {
      evaluate: vi.fn(async () => [{
        name: 'd9_fixture',
        pluginName: 'd9-fixture',
        connected: true,
        enabled: true,
        toolCount: 2,
      }]),
    };

    try {
      const outcome = await Promise.race([
        runPackagedDesktopSession({
          session,
          launch: productLaunch(session),
          fixtureRuntime: runtime,
          expectedInvocations: [],
          stratum: 'desktop-no-tool-multiturn',
          turns: turns(),
          timeoutMs: 100,
          pollIntervalMs: 0,
          dependencies: {
            spawnImpl: () => child,
            connectOverCDPImpl: async () => browser,
            page,
            runPackagedRendererTaskImpl: async () => (
              rendererResult(1, 0)
            ),
            waitImpl: async () => {},
            attestFrozenDesktopFixtureRuntimeImpl: async () => true,
            cleanupTimeoutMs: 1,
          },
        }).then(() => 'completed'),
        new Promise(resolvePromise => {
          setTimeout(() => resolvePromise('hung'), 100);
        }),
      ]);
      expect(outcome).toBe('completed');
      expect(child.killedWith).toContain('SIGTERM');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
