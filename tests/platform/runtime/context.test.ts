import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import { FileCapabilityHealthStore } from '../../../src/platform/runtime/health-store.js';
import { resolvePluginShellCommand } from '../../../src/platform/plugins/runtime.js';
import { waitFor } from '../../support/wait-for.js';

function quote(value: string): string {
  return JSON.stringify(value);
}

function canSpawnChildProcesses(): boolean {
  const command = `${quote(process.execPath)} ${quote('-e')} ${quote('process.exit(0)')}`;
  const shell = resolvePluginShellCommand(command);
  const result = spawnSync(shell.command, shell.args, {
    stdio: 'pipe',
    windowsVerbatimArguments: process.platform === 'win32' && shell.command.toLowerCase() === 'cmd.exe',
  });
  return !result.error && result.status === 0;
}

function writePlugin(
  cwd: string,
  name: string,
  manifest: Record<string, unknown>,
): void {
  const pluginDir = join(cwd, '.xiaok', 'plugins', name);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

describe('platform runtime context', () => {
  const tempDirs: string[] = [];
  let originalConfigDir: string | undefined;
  let originalDisableGlobalPlugins: string | undefined;
  let originalMcpStartupTimeoutMs: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    originalDisableGlobalPlugins = process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    originalMcpStartupTimeoutMs = process.env.XIAOK_MCP_STARTUP_TIMEOUT_MS;
    const configDir = join(tmpdir(), `xiaok-platform-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(configDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
    process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = '1';
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
    }
    if (originalDisableGlobalPlugins === undefined) {
      delete process.env.XIAOK_DISABLE_GLOBAL_PLUGINS;
    } else {
      process.env.XIAOK_DISABLE_GLOBAL_PLUGINS = originalDisableGlobalPlugins;
    }
    if (originalMcpStartupTimeoutMs === undefined) {
      delete process.env.XIAOK_MCP_STARTUP_TIMEOUT_MS;
    } else {
      process.env.XIAOK_MCP_STARTUP_TIMEOUT_MS = originalMcpStartupTimeoutMs;
    }

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a stable summary when no plugin capabilities are declared', async () => {
    const context = await createPlatformRuntimeContext({
      cwd: process.cwd(),
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    expect(context.health.hasDegradedCapabilities()).toBe(false);
    expect(context.health.summary()).toBe('capabilities: none declared');

    await context.dispose();
  });

  it('routes background agent completion into an existing team mailbox when metadata carries a team name', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const team = context.teamService.createTeam({
      name: 'platform',
      owner: 'planner',
      members: ['planner'],
    });
    const runner = context.createBackgroundRunner(async ({ agent, prompt }) => `${agent}:${prompt}`);

    const job = await runner.start({
      sessionId: 'sess_team',
      source: 'chat',
      metadata: {
        agent: 'planner',
        team: 'platform',
      },
      input: {
        agent: 'planner',
        prompt: 'draft the rollout',
      },
    });

    await waitFor(() => {
      expect(context.teamService.listMessages(team.teamId)).toEqual([
        expect.objectContaining({
          from: 'planner',
          to: 'platform',
          body: `[background completed] planner:draft the rollout`,
        }),
      ]);
      expect(context.listBackgroundJobs('sess_team')[0]).toMatchObject({
        jobId: job.jobId,
        status: 'completed',
      });
    });

    await context.dispose();
  });

  it('does not mark an in-flight background job as failed when only listing jobs', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const runner = context.createBackgroundRunner(async () => {
      await new Promise(() => undefined);
      return 'never';
    });

    const job = await runner.start({
      sessionId: 'sess_running',
      source: 'chat',
      input: {
        agent: 'planner',
        prompt: 'keep running',
      },
    });

    const listed = context.listBackgroundJobs('sess_running');

    expect(listed[0]).toMatchObject({
      jobId: job.jobId,
    });
    expect(listed[0]?.status).not.toBe('failed');

    await context.dispose();
  });

  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;

  itIfCanSpawn('loads declared MCP and LSP plugins end-to-end and persists connected capability health', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'index.ts'), 'const fixture: string = 1;\n', 'utf8');
    writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }, null, 2), 'utf8');

    writePlugin(cwd, 'fixture-platform', {
      name: 'fixture-platform',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'fixture-docs',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js')],
        },
      ],
      lspServers: [
        {
          name: 'fixture-lsp',
          command: `${quote(process.execPath)} ${quote(join(process.cwd(), 'tests', 'support', 'lsp-stdio-server.js'))}`,
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    await context.mcpReady;

    expect(context.health.hasDegradedCapabilities()).toBe(false);
    expect(context.health.summary()).toContain('mcp:fixture-docs connected');
    expect(context.health.summary()).toContain('lsp:fixture-lsp connected');
    expect(context.mcpTools.map((tool) => tool.definition.name)).toEqual(['mcp__fixture-docs__search']);
    expect(context.capabilityRegistry.get('mcp__fixture-docs__search')).toMatchObject({
      kind: 'mcp',
      description: 'search fixture docs',
    });
    await waitFor(() => {
      expect(context.lspManager.getSummary()).toContain('fixture diagnostic');
    });

    const healthStore = new FileCapabilityHealthStore(join(cwd, '.xiaok', 'state', 'capability-health.json'));
    expect(healthStore.get(cwd)?.summary).toContain('mcp:fixture-docs connected');
    expect(healthStore.get(cwd)?.summary).toContain('lsp:fixture-lsp connected');

    await context.dispose();
  });

  itIfCanSpawn('wraps CUA MCP servers as xiaok_computer_use instead of exposing raw tools', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    writePlugin(cwd, 'cua-computer-use', {
      name: 'cua-computer-use',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), 'tests', 'support', 'cua-mcp-stdio-server.js')],
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
      platform: 'darwin',
    });
    await context.mcpReady;

    expect(context.mcpTools.map((tool) => tool.definition.name)).toEqual(['xiaok_computer_use']);
    expect(context.capabilityRegistry.get('xiaok_computer_use')).toMatchObject({
      kind: 'mcp',
      description: expect.stringContaining('local macOS apps'),
    });
    expect(context.capabilityRegistry.get('mcp__cua-driver__search')).toBeUndefined();

    await context.dispose();
  });

  it('degrades failed plugin capabilities without aborting runtime context creation', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    writePlugin(cwd, 'broken-platform', {
      name: 'broken-platform',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'broken-docs',
          type: 'stdio',
          command: process.execPath,
          args: ['-e', 'process.exit(1)'],
        },
      ],
      lspServers: [
        {
          name: 'broken-lsp',
          command: `${quote(process.execPath)} ${quote('-e')} ${quote('process.exit(1)')}`,
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    await context.mcpReady;

    expect(context.health.hasDegradedCapabilities()).toBe(true);
    expect(context.health.summary()).toContain('mcp:broken-docs degraded');
    expect(context.health.summary()).toContain('lsp:broken-lsp degraded');
    expect(context.mcpTools).toEqual([]);
    expect(context.capabilityRegistry.get('mcp__broken-docs__search')).toBeUndefined();

    const healthStore = new FileCapabilityHealthStore(join(cwd, '.xiaok', 'state', 'capability-health.json'));
    expect(healthStore.get(cwd)?.summary).toContain('mcp:broken-docs degraded');
    expect(healthStore.get(cwd)?.summary).toContain('lsp:broken-lsp degraded');

    await context.dispose();
  });

  itIfCanSpawn('does not await MCP startup when a server never responds', async () => {
    process.env.XIAOK_MCP_STARTUP_TIMEOUT_MS = '500';
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    writePlugin(cwd, 'silent-platform', {
      name: 'silent-platform',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'silent-docs',
          type: 'stdio',
          command: process.execPath,
          args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
        },
      ],
    });

    const startedAt = Date.now();
    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(300);
    expect(context.mcpTools).toEqual([]);

    await context.mcpReady;

    expect(context.health.hasDegradedCapabilities()).toBe(true);
    expect(context.health.summary()).toContain('mcp:silent-docs degraded');
    expect(context.mcpTools).toEqual([]);

    await context.dispose();
  });

  itIfCanSpawn('does not spawn cua-driver mcp at startup when requiresUserActivation is set', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    writePlugin(cwd, 'cua-computer-use', {
      name: 'cua-computer-use',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), 'tests', 'support', 'cua-mcp-stdio-server.js')],
          requiresUserActivation: true,
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
      platform: 'darwin',
    });
    await context.mcpReady;

    // wrapper tool registered (model can see it) but no connection was made
    expect(context.mcpTools.map((tool) => tool.definition.name)).toEqual(['xiaok_computer_use']);
    // health should NOT show cua-driver as connected (it was deferred)
    expect(context.health.summary()).not.toContain('mcp:cua-driver connected');
    expect(context.health.summary()).toContain('mcp:cua-driver deferred');
    expect(context.health.hasDegradedCapabilities()).toBe(false);

    await context.dispose();
  });

  itIfCanSpawn('runtime fallback: cua-driver server without requiresUserActivation field is still deferred', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    // Simulates a deployed plugin that was never updated with requiresUserActivation
    writePlugin(cwd, 'cua-computer-use', {
      name: 'cua-computer-use',
      version: '0.2.0',
      commands: [],
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), 'tests', 'support', 'cua-mcp-stdio-server.js')],
          // NO requiresUserActivation — registry pluginName+name match still defers
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
      platform: 'darwin',
    });
    await context.mcpReady;

    expect(context.mcpTools.map((tool) => tool.definition.name)).toEqual(['xiaok_computer_use']);
    expect(context.health.summary()).not.toContain('mcp:cua-driver connected');
    expect(context.health.summary()).toContain('mcp:cua-driver deferred');

    await context.dispose();
  });

  itIfCanSpawn('third-party plugin naming its server cua-driver does NOT trigger lazy CUA wrapper', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    // A different plugin (not cua-computer-use) declaring its server name = 'cua-driver'.
    // Registry must NOT match (pluginName guard) — server should connect eagerly as a normal MCP server.
    writePlugin(cwd, 'evil-clone', {
      name: 'evil-clone',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), 'tests', 'support', 'mcp-stdio-server.js')],
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    await context.mcpReady;

    // Wrapper tool MUST NOT appear; the third-party server gets normal eager treatment
    expect(context.mcpTools.map((tool) => tool.definition.name)).not.toContain('xiaok_computer_use');
    // It should be either connected (mcp-stdio-server fixture exposes search) or degraded — but never deferred
    expect(context.health.summary()).not.toContain('mcp:cua-driver deferred');

    await context.dispose();
  });

  it('non-CUA plugin with requiresUserActivation degrades to eager with observable reason', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    // Non-CUA plugin tries to use legacy requiresUserActivation; should NOT enter lazy wrapper.
    // command path is intentionally invalid so eager connect fails fast (degraded), but the
    // key assertion is that it's eager (not deferred / wrapped).
    writePlugin(cwd, 'random-plugin', {
      name: 'random-plugin',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'weird-driver',
          type: 'stdio',
          command: '/nonexistent/never-runs',
          requiresUserActivation: true,
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    await context.mcpReady;

    expect(context.mcpTools.map((tool) => tool.definition.name)).not.toContain('xiaok_computer_use');
    expect(context.health.summary()).not.toContain('mcp:weird-driver deferred');
    expect(context.health.summary()).toContain('mcp:weird-driver');
    // Degraded reason must explain the legacy fallback was rejected
    const reasonEntry = context.health.capabilities.find((c) => c.name === 'weird-driver');
    expect(reasonEntry?.detail).toMatch(/only honored for official cua-computer-use|never-runs|ENOENT|spawn/i);

    await context.dispose();
  });

  it('reports merge conflicts as degraded health entries when plugin overrides settings', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-context-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

    // settings.json with a server, AND a plugin with same name → merge conflict expected
    const configDir = process.env.XIAOK_CONFIG_DIR!;
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        mcpServers: {
          docs: { type: 'stdio', command: '/never-runs-settings' },
        },
      }),
      'utf8',
    );

    writePlugin(cwd, 'docs-plugin', {
      name: 'docs-plugin',
      version: '1.0.0',
      commands: [],
      mcpServers: [
        {
          name: 'docs',
          type: 'stdio',
          command: '/never-runs-plugin',
        },
      ],
    });

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });
    await context.mcpReady;

    // A degraded health entry surfacing the override is expected
    const conflictEntry = context.health.capabilities.find(
      (c) => c.kind === 'mcp' && c.name === 'docs' && c.status === 'degraded' && /overridden/i.test(c.detail),
    );
    expect(conflictEntry).toBeDefined();

    await context.dispose();
  });
});
