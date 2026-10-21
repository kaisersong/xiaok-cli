// Candidate from exact 686d90bb08235c3e99da6189b96dadaa457c85df + accepted remember design.
// Public-behavior controls only; no private receipt API, shell, adapter, or foreign path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { IntersectedPermissionManager } from '../../../src/ai/permissions/intersection.js';
import { ToolRegistry, type RegistryOptions } from '../../../src/ai/tools/index.js';
import { confirmChatPermission } from '../../../src/commands/chat-permission.js';
import { buildPermissionPromptOptions, deriveRule } from '../../../src/ui/permission-prompt.js';
import { addAllowRule, loadSettings, mergeRules } from '../../../src/ai/permissions/settings.js';
import { createHooksRunner } from '../../../src/runtime/hooks-runner.js';
import type { PermissionChoice, Tool, ToolPermissionGrant } from '../../../src/types.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

type ConfirmOptions = Parameters<typeof confirmChatPermission>[2];
type RememberAction = 'allow_project' | 'allow_global' | 'allow_session';
const input = { command: 'head -1 probe.log; tail -1 probe.log' };
const registries: ToolRegistry[] = [];
const subscriptions: Array<() => void> = [];
let root: string, cwd: string, previousConfig: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'prompt-owned-remember-'));
  cwd = join(root, 'project'); mkdirSync(cwd);
  previousConfig = process.env.XIAOK_CONFIG_DIR;
  process.env.XIAOK_CONFIG_DIR = join(root, 'config');
});
afterEach(() => {
  const errors: unknown[] = [];
  for (const stop of subscriptions.splice(0)) { try { stop(); } catch (error) { errors.push(error); } }
  for (const registry of registries.splice(0)) { try { registry.dispose(); } catch (error) { errors.push(error); } }
  vi.restoreAllMocks();
  if (previousConfig === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = previousConfig;
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'owned remember control cleanup failed');
});
function barrier() {
  let release: () => void = () => { throw Error('barrier not initialized'); };
  const promise = new Promise<void>(resolve => { release = () => resolve(); });
  return { promise, release };
}
function remember(action: RememberAction = 'allow_session', value = input, name = 'bash') {
  const selected = buildPermissionPromptOptions(deriveRule(name, value), name, value)
    .find(option => option.choice.action === action);
  if (!selected || !('rule' in selected.choice)) throw Error('real UI remember choice missing');
  return selected.choice;
}
function setup(manager = new PermissionManager({ mode: 'default', cwd })) {
  const execute = vi.fn<Tool['execute']>().mockResolvedValue('EXECUTED');
  const tool: Tool = { permission: 'bash', definition: {
    name: 'bash', description: 'authorization effect spy, never starts a shell',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  }, execute };
  const persist = vi.fn<ConfirmOptions['addAllowRule']>((scope, rule) => addAllowRule(scope, rule, cwd));
  const add = vi.fn<ConfirmOptions['addSessionRule']>(rule => manager.addSessionRule(rule));
  const confirm = (options: Partial<ConfirmOptions> = {}, value = input, name = 'bash') =>
    confirmChatPermission(name, value, {
      prompt: async () => remember('allow_session', value, name), addAllowRule: persist, addSessionRule: add, ...options,
    });
  const make = (onPrompt: NonNullable<RegistryOptions['onPrompt']>, options: Omit<RegistryOptions, 'permissionManager' | 'onPrompt'> = {}) => {
    const registry = new ToolRegistry({ ...options, permissionManager: manager, onPrompt }, [tool]);
    registries.push(registry); return registry;
  };
  return { manager, execute, tool, persist, add, confirm, make };
}
async function blocked(work: Promise<string>, leaf: Pick<ReturnType<typeof setup>, 'execute'>, reason = /authorization changed/) {
  // Unexpected exceptions are not treated as a successful denial.
  expect(await work).toMatch(reason);
  expect(leaf.execute).not.toHaveBeenCalled();
}

describe('prompt-owned remember authorization through existing public behavior', () => {
  it.each(['allow_project', 'allow_global', 'allow_session'] as const)('%s permits the first effect and repeats without another prompt', async action => {
    const leaf = setup();
    const prompt = vi.fn(() => leaf.confirm({ prompt: async () => remember(action) }));
    const registry = leaf.make(prompt);
    expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
    expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
    expect(prompt).toHaveBeenCalledTimes(1); expect(leaf.execute).toHaveBeenCalledTimes(2);
    expect(mergeRules(await loadSettings(cwd)).allowRules).toEqual(action === 'allow_session' ? [] : remember(action).rules ?? [remember(action).rule]);
  });

  it.each(['boolean', 'allow_once', 'public_grant'] as const)('%s retains ordinary approval without remembered mutations', async kind => {
    const leaf = setup(); const current = vi.fn();
    const grant: ToolPermissionGrant = { approved: true, prepareInput: value => value, assertCurrent: current };
    const registry = leaf.make(async () => kind === 'public_grant' ? grant : kind === 'boolean' ? true : leaf.confirm({ prompt: async () => ({ action: 'allow_once' }) }));
    const context = kind === 'public_grant' ? mcpTestContext(new AbortController().signal) : undefined;
    expect(await registry.executeTool('bash', input, context)).toBe('EXECUTED');
    expect(leaf.execute).toHaveBeenCalledTimes(1); expect(leaf.add).not.toHaveBeenCalled();
    expect(await leaf.manager.check('bash', input)).toBe('prompt');
    if (kind === 'public_grant') expect(current).toHaveBeenCalled();
  });

  it.each(['allow', 'deny', 'mode-ABA'] as const)('external %s cannot be absorbed into remembered approval', async kind => {
    const leaf = setup(); const registry = leaf.make(async () => {
      if (kind === 'allow') leaf.manager.addSessionRule('read(*)');
      else if (kind === 'deny') leaf.manager.addSessionDenyRule('bash(tail *)');
      else { leaf.manager.setMode('plan'); leaf.manager.setMode('default'); }
      return leaf.confirm();
    });
    await blocked(registry.executeTool('bash', input), leaf);
  });

  it('a generic true callback cannot authorize its own rule mutation', async () => {
    const leaf = setup(); const registry = leaf.make(async () => { leaf.add('bash(*)'); return true; });
    await blocked(registry.executeTool('bash', input), leaf);
  });

  it.each(['allow-reentry', 'mode-ABA', 'filter-ABA', 'replacement', 'dispose'] as const)('remember listener %s retains revocation precedence', async kind => {
    const leaf = setup(); const registry = leaf.make(() => leaf.confirm()); let fired = false;
    subscriptions.push(leaf.manager.onRevisionChanged(() => {
      if (fired) return; fired = true;
      if (kind === 'allow-reentry') leaf.add('read(*)');
      else if (kind === 'mode-ABA') { leaf.manager.setMode('plan'); leaf.manager.setMode('default'); }
      else if (kind === 'filter-ABA') { registry.setAllowedTools([]); registry.setAllowedTools(null); }
      else if (kind === 'replacement') registry.registerTool({ ...leaf.tool });
      else registry.dispose();
    }));
    await blocked(registry.executeTool('bash', input), leaf);
    expect(fired).toBe(true);
  });

  it('a throwing revision listener cannot hide behind persistence failure; later listeners still run', async () => {
    const leaf = setup(); const notified = vi.fn(); const diagnostic = vi.spyOn(process.stderr, 'write');
    subscriptions.push(leaf.manager.onRevisionChanged(() => { throw Error('listener-control-failure'); }));
    subscriptions.push(leaf.manager.onRevisionChanged(notified));
    await blocked(leaf.make(() => leaf.confirm()).executeTool('bash', input), leaf);
    expect(notified).toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('failed to persist allow rule'));
  });

  it('listener abort prevents the effect even after a real remembered mutation', async () => {
    const leaf = setup(); const controller = new AbortController();
    subscriptions.push(leaf.manager.onRevisionChanged(() => { controller.abort(); }));
    await expect(leaf.make(() => leaf.confirm()).executeTool('bash', input, mcpTestContext(controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(leaf.execute).not.toHaveBeenCalled();
  });

  it.each(['prompt', 'persistence'] as const)('external mutation while held in %s is not prompt-owned', async stage => {
    const leaf = setup(); const entered = barrier(), release = barrier();
    const registry = leaf.make(() => leaf.confirm({
      prompt: async () => { if (stage === 'prompt') { entered.release(); await release.promise; } return remember('allow_project'); },
      addAllowRule: async (scope, rule) => { if (stage === 'persistence') { entered.release(); await release.promise; } await leaf.persist(scope, rule); },
    }));
    const work = registry.executeTool('bash', input);
    try { await entered.promise; leaf.add('read(*)'); release.release(); await blocked(work, leaf); }
    finally { release.release(); await work; }
  });

  it("simultaneous prompts cannot consume each other's remembered authority", async () => {
    const leaf = setup(); const entered = barrier(), release = barrier();
    const slow = leaf.make(() => leaf.confirm({ prompt: async () => { entered.release(); await release.promise; return remember(); } }));
    const fast = leaf.make(() => leaf.confirm()); const pending = slow.executeTool('bash', input);
    try {
      await entered.promise; expect(await fast.executeTool('bash', input)).toBe('EXECUTED');
      release.release(); expect(await pending).toMatch(/authorization changed/);
      expect(leaf.execute).toHaveBeenCalledTimes(1);
    } finally { release.release(); await pending; }
  });

  it('a nested second confirmation cannot extend the same invocation', async () => {
    const leaf = setup(); const registry = leaf.make(async () => { await leaf.confirm(); return leaf.confirm(); });
    await blocked(registry.executeTool('bash', input), leaf);
  });

  it.each(['wrong-manager', 'wrong-input', 'wrong-name', 'broader-rule', 'suffix', 'accessor', 'extra-fields', 'proxy'] as const)('%s choice/callback cannot authorize the effect', async kind => {
    const leaf = setup(); const other = new PermissionManager({ mode: 'default', cwd }); const touched = vi.fn(); const thenReads = vi.fn();
    const registry = leaf.make(() => {
      if (kind === 'wrong-manager') return leaf.confirm({ addSessionRule: rule => other.addSessionRule(rule) });
      if (kind === 'wrong-input') return leaf.confirm({}, { command: 'head -1 another.log' });
      if (kind === 'wrong-name') return leaf.confirm({}, input, 'write');
      return leaf.confirm({ prompt: async () => {
        const actual = remember();
        if (kind === 'broader-rule') return { ...actual, rule: 'bash(*)' };
        if (kind === 'suffix') return { ...actual, rules: [...(actual.rules ?? [actual.rule]), 'bash(ls *)'] };
        if (kind === 'extra-fields') return { ...actual, bypass: true };
        if (kind === 'accessor') return { action: 'allow_session', get rule() { touched(); return actual.rule; } };
        return new Proxy(actual, {
          get(target, key, receiver) {
            // Promise resolution must assimilate an async callback's result before snapshot.
            if (key === 'then') { thenReads(); return undefined; }
            touched(); return Reflect.get(target, key, receiver);
          },
          getPrototypeOf(target) { touched(); return Reflect.getPrototypeOf(target); },
          ownKeys(target) { touched(); return Reflect.ownKeys(target); },
          getOwnPropertyDescriptor(target, key) { touched(); return Reflect.getOwnPropertyDescriptor(target, key); },
        });
      } });
    });
    await blocked(registry.executeTool('bash', input), leaf);
    expect(leaf.add).not.toHaveBeenCalled(); expect(leaf.persist).not.toHaveBeenCalled();
    expect(touched).not.toHaveBeenCalled();
    if (kind === 'proxy') expect(thenReads).toHaveBeenCalled();
  });

  it.each(['foreign-then-own', 'own-then-foreign'] as const)('a session callback with %s actual mutations cannot authorize the effect', async order => {
    const leaf = setup(); const other = new PermissionManager({ mode: 'default', cwd });
    const registry = leaf.make(() => leaf.confirm({ addSessionRule: rule => {
      if (order === 'foreign-then-own') { other.addSessionRule('write(*)'); leaf.add(rule); }
      else { leaf.add(rule); other.addSessionRule('write(*)'); }
    } }));
    await blocked(registry.executeTool('bash', input), leaf);
    expect(await other.check('write', { file_path: join(cwd, 'owned-output.txt') })).toBe('allow');
  });

  it('async session callbacks cannot be awaited into authority or retroactively approve the effect', async () => {
    const leaf = setup(); const release = barrier(); const pending: Promise<void>[] = [];
    const registry = leaf.make(() => leaf.confirm({ addSessionRule: rule => {
      const work = release.promise.then(() => leaf.add(rule)); pending.push(work); return work;
    } }));
    try { await blocked(registry.executeTool('bash', input), leaf); }
    finally { release.release(); await Promise.all(pending); }
    expect(leaf.execute).not.toHaveBeenCalled();
  });

  it('an inherited late prompt context cannot remember rules after its once approval settles', async () => {
    const leaf = setup(); const release = barrier(); let late: Promise<boolean> | undefined;
    const registry = leaf.make(async () => { late = release.promise.then(() => leaf.confirm()); return true; });
    try {
      expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
      release.release(); await late;
      expect(await leaf.manager.check('bash', input)).toBe('prompt');
      expect(leaf.add).not.toHaveBeenCalled(); expect(leaf.persist).not.toHaveBeenCalled();
      expect(leaf.execute).toHaveBeenCalledTimes(1);
    } finally { release.release(); await late; }
  });

  it.each(['revision', 'deny'] as const)('parent %s is never replaced by the child remember choice', async kind => {
    const parent = new PermissionManager({ mode: 'default', cwd });
    const leaf = setup(new IntersectedPermissionManager(parent, 'default'));
    const registry = leaf.make(() => leaf.confirm({ addSessionRule: rule => {
      leaf.add(rule);
      if (kind === 'revision') parent.addSessionRule('read(*)');
      else parent.addSessionDenyRule('bash(tail *)');
    } }));
    await blocked(registry.executeTool('bash', input), leaf);
    if (kind === 'deny') expect(await leaf.manager.check('bash', input)).toBe('deny');
  });

  it.each([0, 1] as const)('durable failure after %i completed rules preserves only this explicit once effect', async completed => {
    const leaf = setup(); const diagnostic = vi.spyOn(process.stderr, 'write'); let writes = 0;
    const registry = leaf.make(() => leaf.confirm({ prompt: async () => remember('allow_project'), addAllowRule: async (scope, rule) => {
      if (writes++ === completed) throw Error('owned-persistence-fault');
      await leaf.persist(scope, rule);
    } }));
    expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
    expect(leaf.execute).toHaveBeenCalledTimes(1);
    expect(await leaf.manager.check('bash', input)).toBe('prompt');
    const choice = remember('allow_project'); const rules = choice.rules ?? [choice.rule];
    expect(mergeRules(await loadSettings(cwd)).allowRules).toEqual(rules.slice(0, completed));
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('owned-persistence-fault'));
  });

  it('an existing-rule no-op remains a no-op and does not invalidate the remaining legitimate remember step', async () => {
    const existing = remember().rule;
    const leaf = setup(new PermissionManager({ mode: 'default', cwd, allowRules: [existing] })); const notices = vi.fn();
    subscriptions.push(leaf.manager.onRevisionChanged(notices));
    const prompt = vi.fn(() => leaf.confirm()); const registry = leaf.make(prompt);
    expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
    expect(await registry.executeTool('bash', input)).toBe('EXECUTED');
    expect(prompt).toHaveBeenCalledTimes(1); expect(leaf.execute).toHaveBeenCalledTimes(2);
    expect(notices).toHaveBeenCalledTimes(1);
  });

  it('a pre-hook input change still requires fresh approval after a legitimate remember choice', async () => {
    const leaf = setup(); const hooks = createHooksRunner();
    vi.spyOn(hooks, 'runPreHooks').mockResolvedValue({ ok: true, updatedInput: { command: input.command + '; ls' } });
    const registry = leaf.make(() => leaf.confirm(), { hooksRunner: hooks });
    try { await blocked(registry.executeTool('bash', input), leaf, /fresh approval/); }
    finally { await hooks.closeAndDrain(); }
  });
});
