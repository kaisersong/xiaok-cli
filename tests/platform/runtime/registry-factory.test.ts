import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelAdapter, StreamChunk } from '../../../src/types.js';
import { createPlatformRuntimeContext } from '../../../src/platform/runtime/context.js';
import { createPlatformRegistryFactory } from '../../../src/platform/runtime/registry-factory.js';
import { waitFor } from '../../support/wait-for.js';

function quote(value: string): string {
  return JSON.stringify(value);
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

function writeAgent(cwd: string, name: string, content: string): void {
  const agentsDir = join(cwd, '.xiaok', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${name}.md`), content, 'utf8');
}

function initGitRepo(cwd: string): void {
  execFileSync('git', ['init'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'xiaok-tests'], { cwd });
  writeFileSync(join(cwd, 'README.md'), '# fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd });
  execFileSync('git', ['commit', '-m', 'init'], { cwd });
}

function canSpawnChildProcesses(): boolean {
  const nodeResult = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'pipe' });
  const gitResult = spawnSync('git', ['--version'], { stdio: 'pipe' });
  return !nodeResult.error && nodeResult.status === 0 && !gitResult.error && gitResult.status === 0;
}

async function* mockStream(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('platform registry factory', () => {
  const tempDirs: string[] = [];
  const itIfCanSpawn = canSpawnChildProcesses() ? it : it.skip;

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  itIfCanSpawn('runs a longer chain across team tools, MCP tools, and background subagents with cwd and model propagation', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const packageCwd = join(cwd, 'packages', 'app');
    tempDirs.push(cwd);
    mkdirSync(packageCwd, { recursive: true });
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });

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
    });
    writeAgent(
      cwd,
      'planner',
      [
        '---',
        'background: true',
        'team: platform',
        'model: gpt-5.4',
        '---',
        'You plan rollout work.',
      ].join('\n'),
    );

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const buildSystemPrompt = vi.fn(async (promptCwd: string) => `system:${promptCwd}`);
    let selectedModel = 'base-model';
    const clonedAdapter: ModelAdapter = {
      getModelName: () => selectedModel,
      stream: () => mockStream([{ type: 'text', delta: 'background complete' }, { type: 'done' }]),
    };
    const adapter = {
      getModelName: () => 'base-model',
      stream: () => mockStream([{ type: 'done' }]),
      cloneWithModel(model: string) {
        selectedModel = model;
        return clonedAdapter;
      },
    } satisfies ModelAdapter & { cloneWithModel(model: string): ModelAdapter };

    const factory = createPlatformRegistryFactory({
      platform: context,
      source: 'chat',
      sessionId: 'sess_registry_long',
      adapter: () => adapter,
      buildSystemPrompt,
    });
    const registry = factory.createRegistry(packageCwd);

    const createdTeam = await registry.executeTool('team_create', {
      name: 'platform',
      owner: 'planner',
      members: ['planner'],
    });
    const teamId = createdTeam.match(/team_\d+/)?.[0];

    expect(teamId).toBeTruthy();
    await expect(registry.executeTool('mcp__fixture-docs__search', { q: 'prompt cache' }))
      .resolves.toBe('fixture:prompt cache');

    const queued = await registry.executeTool('subagent', {
      agent: 'planner',
      prompt: 'draft the rollout',
    });
    expect(queued).toContain('background subagent queued: job_');

    await waitFor(() => {
      expect(selectedModel).toBe('gpt-5.4');
      expect(buildSystemPrompt).toHaveBeenCalledWith(packageCwd);
      expect(context.listBackgroundJobs('sess_registry_long')[0]).toMatchObject({
        status: 'completed',
        resultSummary: 'background complete',
      });
      expect(context.teamService.listMessages(String(teamId))).toEqual([
        expect.objectContaining({
          from: 'planner',
          to: 'platform',
          body: '[background completed] background complete',
        }),
      ]);
    });

    await context.dispose();
  });

  itIfCanSpawn('runs isolated background subagents inside real git worktrees and deletes cleanup worktrees after completion', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });
    initGitRepo(cwd);

    writeAgent(
      cwd,
      'janitor',
      [
        '---',
        'background: true',
        'isolation: worktree',
        'cleanup: delete',
        '---',
        'You clean worktrees.',
      ].join('\n'),
    );

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const buildSystemPrompt = vi.fn(async (promptCwd: string) => `system:${promptCwd}`);
    const adapter: ModelAdapter = {
      getModelName: () => 'base-model',
      stream: () => mockStream([{ type: 'text', delta: 'worktree cleaned' }, { type: 'done' }]),
    };

    const factory = createPlatformRegistryFactory({
      platform: context,
      source: 'chat',
      sessionId: 'sess_registry_worktree',
      adapter: () => adapter,
      buildSystemPrompt,
    });
    const registry = factory.createRegistry(cwd);

    const queued = await registry.executeTool('subagent', {
      agent: 'janitor',
      prompt: 'clean it',
    });
    const expectedWorktreePath = join(cwd, '.worktrees', 'janitor-sess_registry_worktree');

    expect(queued).toContain('background subagent queued: job_');

    await waitFor(() => {
      expect(buildSystemPrompt).toHaveBeenCalledWith(expectedWorktreePath);
      expect(context.listBackgroundJobs('sess_registry_worktree')[0]).toMatchObject({
        status: 'completed',
        resultSummary: 'worktree cleaned',
      });
    });

    expect(() => execFileSync('git', ['-C', cwd, 'worktree', 'list'], { encoding: 'utf8' }))
      .not.toThrow();
    const worktreeList = execFileSync('git', ['-C', cwd, 'worktree', 'list'], { encoding: 'utf8' });
    expect(worktreeList).not.toContain(expectedWorktreePath);

    await context.dispose();
  });

  itIfCanSpawn('deletes cleanup worktrees even when an isolated background subagent fails', async () => {
    const cwd = join(tmpdir(), `xiaok-platform-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(cwd);
    mkdirSync(join(cwd, '.xiaok'), { recursive: true });
    initGitRepo(cwd);

    writeAgent(
      cwd,
      'broken-janitor',
      [
        '---',
        'background: true',
        'isolation: worktree',
        'cleanup: delete',
        '---',
        'You fail while cleaning worktrees.',
      ].join('\n'),
    );

    const context = await createPlatformRuntimeContext({
      cwd,
      builtinCommands: ['chat', 'yzj'],
      reminderMode: 'local',
    });

    const adapter: ModelAdapter = {
      getModelName: () => 'base-model',
      stream: () => mockStream([{ type: 'done' }]),
    };

    const factory = createPlatformRegistryFactory({
      platform: context,
      source: 'chat',
      sessionId: 'sess_registry_worktree_fail',
      adapter: () => adapter,
      buildSystemPrompt: async (promptCwd: string) => `system:${promptCwd}`,
    });
    const registry = factory.createRegistry(cwd);

    const queued = await registry.executeTool('subagent', {
      agent: 'broken-janitor',
      prompt: 'clean it badly',
    });
    const expectedWorktreePath = join(cwd, '.worktrees', 'broken-janitor-sess_registry_worktree_fail');

    expect(queued).toContain('background subagent queued: job_');

    await waitFor(() => {
      expect(context.listBackgroundJobs('sess_registry_worktree_fail')[0]).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('模型未返回任何文本或工具调用'),
      });
    });

    const worktreeList = execFileSync('git', ['-C', cwd, 'worktree', 'list'], { encoding: 'utf8' });
    expect(worktreeList).not.toContain(expectedWorktreePath);

    await context.dispose();
  });
});
