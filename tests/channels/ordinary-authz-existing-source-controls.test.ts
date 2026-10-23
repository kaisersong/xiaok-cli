import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionManager } from '../../src/ai/permissions/manager.js';
import { loadSettings, mergeRules, addAllowRule } from '../../src/ai/permissions/settings.js';
import { EmbeddedYZJChannel } from '../../src/channels/embedded-yzj.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';

// All imports already exist before apply. Real production methods only; no new-module fake RED.
const roots: string[] = [];
let restoreConfig: (() => void) | undefined;
afterEach(async () => { restoreConfig?.(); restoreConfig = undefined; await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'ordinary-authz-source-before-')); roots.push(root);
  const old = process.env.XIAOK_CONFIG_DIR; process.env.XIAOK_CONFIG_DIR = join(root, 'local-config');
  restoreConfig = () => { if (old === undefined) delete process.env.XIAOK_CONFIG_DIR; else process.env.XIAOK_CONFIG_DIR = old; };
  const repo = join(root, 'repo'); await mkdir(join(repo, '.xiaok'), { recursive: true }); return repo;
}
function channel(allowedSenders?: string[]) {
  const store = new InMemoryApprovalStore();
  const runTurn = vi.fn(async () => {});
  const options = {
    allowedSenders, runtimeFacade: { runTurn }, runtimeHooks: createRuntimeHooks(), approvalStore: store,
    onPromptOverride: async () => true, // Before-source unsafe legacy option, removed/ignored after fix.
    transport: { deliver: vi.fn(async () => ({ ok: true })) }, selectedChannel: { name: 'owned', robotId: 'robot' },
    yzjConfig: { robotId: 'robot', openid: 'owner', secret: 'fixture', webhookUrl: 'https://example.invalid', inboundMode: 'websocket', wsPath: '/ws' }, sessionId: 'owned-session', cwd: '/owned-fixture',
  };
  return { instance: new EmbeddedYZJChannel(options as unknown as ConstructorParameters<typeof EmbeddedYZJChannel>[0]), store, runTurn };
}
function inbound(instance: EmbeddedYZJChannel, user = 'alice', content = 'hello') {
  // Exercise the existing handler body; no start/socket/model/TaskHost/native constructor.
  return instance.handleInboundForTest({ type: 1, robotName: 'fixture', groupType: 0, msgId: 'message', robotId: 'robot', operatorOpenid: user, operatorName: user, content, time: 1 });
}
describe('ordinary authz source-before actual existing-production controls', () => {
  it('does not let one remembered prefix authorize a second shell command', async () => {
    const manager = new PermissionManager({ mode: 'default', allowRules: ['bash(git *)'] });
    expect(await manager.check('bash', { command: 'git status; printf extra' })).toBe('prompt');
  });
  it('keeps warn-level data-loss commands asking even with a broad remembered rule', async () => {
    const manager = new PermissionManager({ mode: 'auto', allowRules: ['bash(git *)'] });
    expect(await manager.check('bash', { command: 'git reset --hard' })).toBe('prompt');
  });
  it('does not silently adopt repository-provided allow rules', async () => {
    const repo = await workspace(); await writeFile(join(repo, '.xiaok/settings.json'), JSON.stringify({ permissions: { allow: ['bash(git *)'] } }));
    expect(mergeRules(await loadSettings(repo)).allowRules).toEqual([]);
  });
  it('stores a project-local user choice locally without changing repository settings', async () => {
    const repo = await workspace(); const file = join(repo, '.xiaok/settings.json'); await writeFile(file, '{}');
    await addAllowRule('project', 'bash(ls *)', repo); expect(await readFile(file, 'utf8')).toBe('{}');
    expect(mergeRules(await loadSettings(repo)).allowRules).toContain('bash(ls *)');
  });
  it('blocks all inbound turn effects when the sender list is absent', async () => {
    const { instance, runTurn } = channel(); await inbound(instance); expect(runTurn).not.toHaveBeenCalled();
  });
  it('blocks an unlisted sender before the actual turn delegate', async () => {
    const { instance, runTurn } = channel(['alice']); await inbound(instance, 'mallory'); expect(runTurn).not.toHaveBeenCalled();
  });
  it('keeps a normal allowed sender flowing through the same existing handler', async () => {
    const { instance, runTurn } = channel(['alice']); await inbound(instance); expect(runTurn).toHaveBeenCalledTimes(1);
  });
  it('does not resolve a channel approval that it did not issue to that requester', async () => {
    const { instance, store } = channel(['alice']);
    const request = store.create({ sessionId: 'owned-session', turnId: 'foreign-turn', toolName: 'read', summary: 'fixture' });
    try { await inbound(instance, 'alice', `/approve ${request.approvalId}`); expect(store.get(request.approvalId)).toBeDefined(); }
    finally { store.expire(request.approvalId); }
  });
  it('does not let the legacy unconditional override win over terminal denial', async () => {
    const { instance } = channel(['alice']); expect(await instance.makeOnPrompt(async () => { await Promise.resolve(); return false; })('read', { file_path: '/fixture' })).toBe(false);
  });
  it('retains actual synchronous policy-revision notifications', () => {
    const manager = new PermissionManager({ mode: 'default' }); const revisions: number[] = [];
    const off = manager.onRevisionChanged(revision => { revisions.push(revision); });
    manager.setMode('auto'); manager.addSessionDenyRule('bash(git *)'); off(); expect(revisions).toEqual([1, 2]);
  });
});
