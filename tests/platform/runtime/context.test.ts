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

  beforeEach(() => {
    originalConfigDir = process.env.XIAOK_CONFIG_DIR;
    const configDir = join(tmpdir(), `xiaok-platform-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(configDir);
    mkdirSync(configDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.XIAOK_CONFIG_DIR;
    } else {
      process.env.XIAOK_CONFIG_DIR = originalConfigDir;
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
});
