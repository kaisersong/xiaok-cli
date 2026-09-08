// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';

describe('BDD: Desktop managed resources use the real Git worktree manager', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const action of cleanup.splice(0).reverse()) action(); });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-desktop-worktree-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init']); git(['-c', 'user.name=BDD', '-c', 'user.email=bdd@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
    const store = new DesktopMultiAgentStore(join(root, 'state.sqlite'));
    cleanup.push(() => store.close());
    store.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = store.createGroup('thread');
    store.putAgent(group.groupId, { id: 'child', parentId: `root_${group.groupId}`, taskName: 'child', canonicalName: '/main/child', depth: 1, status: 'running', turn: 1 });
    const worktrees = new DesktopMultiAgentWorktrees({ store });
    const allocate = (cleanupPolicy: 'keep' | 'delete' = 'delete') => worktrees.allocate({ groupId: group.groupId, agentId: 'child', cwd: root,
      cleanupPolicy, signal: new AbortController().signal });
    return { root, git, store, group, worktrees, allocate };
  }

  it('A26 Given a real repository, When allocating then releasing a clean delete worktree, Then the journal precedes Git creation and release actually removes the registered directory', async () => {
    const fixture = setup(); const states: string[] = [];
    const original = fixture.store.putResource.bind(fixture.store);
    const trace = vi.spyOn(fixture.store, 'putResource').mockImplementation((resource, control) => {
      states.push(resource.state);
      if (resource.state === 'planned') expect(existsSync(resource.canonicalPath)).toBe(false);
      return original(resource, control);
    });
    const allocation = await fixture.allocate();
    expect(existsSync(join(allocation.cwd, '.git'))).toBe(true);
    expect(states.slice(0, 2)).toEqual(['planned', 'allocated']);
    await allocation.release(); trace.mockRestore();
    expect(existsSync(allocation.cwd)).toBe(false);
    expect(fixture.store.resources(fixture.group.groupId)[0]?.state).toBe('released');
  });

  it('A15/A26 Given the planned journal cannot be saved, When allocating, Then no Git worktree is created', async () => {
    const fixture = setup(); const before = fixture.git(['worktree', 'list', '--porcelain']);
    const fault = vi.spyOn(fixture.store, 'putResource').mockImplementation(() => { throw new Error('SQLITE_FULL'); });
    try { await expect(fixture.allocate()).rejects.toThrow('SQLITE_FULL'); } finally { fault.mockRestore(); }
    expect(fixture.git(['worktree', 'list', '--porcelain'])).toBe(before);
  });

  it('A26 Given a dirty real worktree, When automatic deletion runs, Then non-force Git removal fails and user keep preserves every byte', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    writeFileSync(join(allocation.cwd, 'user-result.txt'), 'DO_NOT_DELETE');
    await expect(allocation.release()).rejects.toThrow();
    const record = fixture.store.resources(fixture.group.groupId)[0]!;
    expect(record.state).toBe('cleanup_pending');
    await fixture.worktrees.resolve({ requestSource: 'user', groupId: record.groupId, resourceId: record.resourceId, action: 'keep' });
    expect(readFileSync(join(allocation.cwd, 'user-result.txt'), 'utf8')).toBe('DO_NOT_DELETE');
    expect(fixture.store.resources(record.groupId)[0]?.state).toBe('retained_by_policy');
  });

  it('A30 Given an opaque tool may launch external work, When invoked before release, Then manual eligibility is persisted first and no automatic directory deletion occurs', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    await fixture.worktrees.beforeOpaqueInvocation(fixture.group.groupId, 'child');
    expect(fixture.store.resources(fixture.group.groupId)[0]?.cleanupEligibility).toBe('manual');
    await expect(allocation.release()).rejects.toThrow(/manual/);
    expect(existsSync(allocation.cwd)).toBe(true);
    await expect(fixture.worktrees.resolve({ requestSource: 'agent', groupId: fixture.group.groupId, resourceId: allocation.resourceId, action: 'keep' })).rejects.toThrow(/source/);
    await expect(fixture.worktrees.resolve({ requestSource: 'scheduler', groupId: fixture.group.groupId, resourceId: allocation.resourceId, action: 'retryCleanup' })).rejects.toThrow(/source/);
  });

  it('A26/A37 Given a live execution or a foreign resource ID, When user cleanup is requested, Then neither ownership nor physical execution can be bypassed', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    const agent = fixture.store.getAgent(fixture.group.groupId, 'child')!;
    fixture.store.putAgent(fixture.group.groupId, { ...agent, executionActive: true });
    await expect(fixture.worktrees.resolve({ requestSource: 'user', groupId: fixture.group.groupId, resourceId: allocation.resourceId, action: 'keep' })).rejects.toThrow(/live/);
    await expect(fixture.worktrees.resolve({ requestSource: 'user', groupId: fixture.group.groupId, resourceId: 'foreign', action: 'retryCleanup' })).rejects.toThrow(/unknown/);
    expect(existsSync(allocation.cwd)).toBe(true);
  });

  it('A26 Given the allocator record has a different owner token, When cleanup is retried, Then the registered directory is not deleted', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    const record = fixture.store.resources(fixture.group.groupId)[0]!;
    fixture.store.putResource({ ...record, allocationToken: 'forged-token' }, true);
    await expect(allocation.release()).rejects.toThrow(/owner|token|path/);
    expect(existsSync(allocation.cwd)).toBe(true);
  });

  it('A26 Given cleanup policy keep, When the real session releases its resource, Then its directory remains and is explicitly retained rather than reported deleted', async () => {
    const fixture = setup(); const allocation = await fixture.allocate('keep');
    await allocation.release();
    expect(existsSync(allocation.cwd)).toBe(true);
    expect(fixture.store.resources(fixture.group.groupId)[0]).toMatchObject({ cleanupPolicy: 'keep', state: 'retained_by_policy' });
  });

  it('A26 Given release already owns the directory, Then user keep is rejected before queueing and cannot label a deleted directory retained', async () => {
    const f = setup(); const allocation = await f.allocate();
    let entered!: () => void; const atGit = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void; const pause = new Promise<void>(resolve => { resume = resolve; });
    const port = f.worktrees as unknown as { git(cwd: string, args: string[]): Promise<string> }; const git = port.git.bind(port);
    vi.spyOn(port, 'git').mockImplementation(async (cwd, args) => { if (args[0] === 'worktree' && args[1] === 'list') { entered(); await pause; } return git(cwd, args); });
    const release = allocation.release(); await atGit;
    let settled = false;
    const keep = f.worktrees.resolve({ requestSource: 'user', groupId: f.group.groupId, resourceId: allocation.resourceId, action: 'keep' })
      .then(() => 'accepted', error => String(error)).finally(() => { settled = true; });
    try { await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 }); expect(await keep).toMatch(/progress|busy/); }
    finally { resume(); await release; await keep; }
    expect(f.store.resources(f.group.groupId)[0]?.state).toBe('released'); expect(existsSync(allocation.cwd)).toBe(false);
    await expect(f.worktrees.resolve({ requestSource: 'user', groupId: f.group.groupId, resourceId: allocation.resourceId, action: 'keep' })).rejects.toThrow(/released/);
  });

  it.each(['sessionResident', 'runtimeResident'] as const)('A26 Given an idle descendant with %s in its parent cwd, Then directory cleanup still refuses', async resident => {
    const f = setup(); const allocation = await f.allocate();
    f.store.putAgent(f.group.groupId, { id: 'nested-idle', parentId: 'child', taskName: 'nested', canonicalName: '/main/child/nested', depth: 2,
      turn: 1, status: 'completed', executionActive: false, activationState: 'settled', [resident]: true });
    await expect(f.worktrees.resolve({ requestSource: 'user', groupId: f.group.groupId, resourceId: allocation.resourceId, action: 'retryCleanup' })).rejects.toThrow(/live/);
    expect(existsSync(allocation.cwd)).toBe(true);
  });

  it('A26/A30 Given a sibling opaque invocation uses a real symlink cwd alias, Then the actual worktree is marked manual before any external work', async () => {
    const f = setup(); const allocation = await f.allocate(); const alias = join(f.root, 'cwd-alias');
    symlinkSync(allocation.cwd, alias, process.platform === 'win32' ? 'junction' : 'dir');
    f.worktrees.beforeOpaqueInvocation(f.group.groupId, `root_${f.group.groupId}`, alias);
    expect(f.store.resources(f.group.groupId)[0]?.cleanupEligibility).toBe('manual');
    await expect(allocation.release()).rejects.toThrow(/manual/); expect(existsSync(allocation.cwd)).toBe(true);
  });

  it.each(['keep', 'retryCleanup'] as const)('A26 Given allocation paused before real Git add, Then user %s cannot race the allocation journal', async action => {
    const fixture = setup();
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
    const port = fixture.worktrees as unknown as { git(cwd: string, args: string[]): Promise<string> };
    const original = port.git.bind(port);
    const fault = vi.spyOn(port, 'git').mockImplementation(async (cwd, args) => {
      if (args[0] === 'worktree' && args[1] === 'add') { entered(); await paused; }
      return original(cwd, args);
    });
    const pending = fixture.allocate();
    try {
      await enteredPromise;
      const resource = fixture.store.resources(fixture.group.groupId)[0]!;
      await expect(fixture.worktrees.resolve({ requestSource: 'user', groupId: fixture.group.groupId, resourceId: resource.resourceId, action })).rejects.toThrow(/allocating/);
    } finally { resume(); await pending; fault.mockRestore(); }
    expect(fixture.store.resources(fixture.group.groupId)[0]?.state).toBe('allocated');
  });

  it('A26/A30 Given cleanup paused at worktree-list, Then an opaque invocation cannot start while its directory is being released', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
    const port = fixture.worktrees as unknown as { git(cwd: string, args: string[]): Promise<string> }; const original = port.git.bind(port);
    const fault = vi.spyOn(port, 'git').mockImplementation(async (cwd, args) => {
      if (args[0] === 'worktree' && args[1] === 'list') { entered(); await paused; }
      return original(cwd, args);
    });
    const pending = allocation.release();
    try { await enteredPromise; expect(() => fixture.worktrees.beforeOpaqueInvocation(fixture.group.groupId, 'child')).toThrow(/cleanup|releasing/); }
    finally { resume(); await pending; fault.mockRestore(); }
    expect(fixture.store.resources(fixture.group.groupId)[0]?.state).toBe('released');
  });

  it('A26/A34 Given a nested descendant still executing inside its ancestor worktree, Then the ancestor session release cannot delete that shared directory', async () => {
    const fixture = setup(); const allocation = await fixture.allocate();
    fixture.store.putAgent(fixture.group.groupId, { id: 'nested', parentId: 'child', taskName: 'nested', canonicalName: '/main/child/nested', depth: 2,
      status: 'interrupted', turn: 1, executionActive: true });
    await allocation.releaseSessionResources();
    expect(existsSync(allocation.cwd)).toBe(true);
    expect(fixture.store.resources(fixture.group.groupId)[0]).toMatchObject({ state: 'cleanup_pending' });
    await expect(fixture.worktrees.resolve({ requestSource: 'user', groupId: fixture.group.groupId, resourceId: allocation.resourceId, action: 'keep' })).rejects.toThrow(/live/);
  });

  it.each([false, true])('A15/A26 Given a dirty directory, previous error=%s and failed cleanup journal, Then session release rejects rather than silently pretending its ownership was transferred', async previousError => {
    const fixture = setup(); const allocation = await fixture.allocate();
    writeFileSync(join(allocation.cwd, 'user-result.txt'), 'PRESERVE');
    if (previousError) await expect(allocation.release()).rejects.toThrow();
    const original = fixture.store.putResource.bind(fixture.store);
    const fault = vi.spyOn(fixture.store, 'putResource').mockImplementation((record, control) => {
      if (record.state === 'cleanup_pending') throw new Error('SQLITE_FULL');
      return original(record, control);
    });
    try { await expect(allocation.releaseSessionResources()).rejects.toThrow('SQLITE_FULL'); }
    finally { fault.mockRestore(); }
    expect(existsSync(allocation.cwd)).toBe(true);
    expect(fixture.store.resources(fixture.group.groupId)[0]?.state).toBe(previousError ? 'cleanup_pending' : 'allocated');
  });
});
