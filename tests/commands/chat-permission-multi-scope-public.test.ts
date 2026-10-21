import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { confirmChatPermission } from '../../src/commands/chat-permission.js';
import { showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../support/tty.js';

// Ordinary public permission-consumer DATA/TTY controls, not SDK/authority grants.
const command = 'cd /fixture && ls -la /fixture';
const expectedRules = ['bash(cd *)', 'bash(ls *)'];
const actions = [
  { key: '2', action: 'allow_session' as const, scope: null },
  { key: '3', action: 'allow_project' as const, scope: 'project' as const },
  { key: '4', action: 'allow_global' as const, scope: 'global' as const },
];

async function realPrompt(key: string, failAt?: number) {
  const tty = createTtyHarness(120, 24, { captureStderr: true });
  const abort = new AbortController();
  const initial = { data: tty.emitter.listenerCount('data'), end: tty.emitter.listenerCount('end'), abort: getEventListeners(abort.signal, 'abort').length };
  const persisted: Array<[string, string]> = [], session: string[] = [], order: string[] = [];
  let writes = 0;
  const pending = confirmChatPermission('bash', { command }, {
    prompt: (name, input) => showPermissionPrompt(name, input, { signal: abort.signal }),
    async addAllowRule(scope, rule) {
      writes += 1;
      order.push('persist:' + rule);
      if (writes === failAt) throw new Error('controlled second persistence callback failure');
      persisted.push([scope, rule]);
    },
    addSessionRule(rule) { order.push('session:' + rule); session.push(rule); },
  });
  try {
    expect(tty.output.normalized).toContain('工具: bash');
    expect(tty.output.normalized).toContain('1. 允许一次');
    expect(tty.output.normalized).toContain('5. 拒绝');
    for (const rule of expectedRules) expect(tty.output.normalized).toContain('始终允许的范围: ' + rule);
    tty.send(key);
    const allowed = await pending;
    expect(tty.emitter.listenerCount('data')).toBe(initial.data);
    expect(tty.emitter.listenerCount('end')).toBe(initial.end);
    expect(getEventListeners(abort.signal, 'abort').length).toBe(initial.abort);
    return { allowed, persisted, session, order, writes };
  } finally {
    abort.abort();
    try { await pending; } finally { tty.restore(); }
  }
}

describe('real public TTY choice to multi-scope permission consumer', () => {
  it.each(actions)('$action persists every actual displayed producer scope in order', async ({ key, scope }) => {
    const actual = await realPrompt(key);
    expect(actual.allowed).toBe(true);
    expect(actual.session).toEqual(expectedRules);
    expect(actual.persisted).toEqual(scope ? expectedRules.map(rule => [scope, rule]) : []);
    expect(actual.order).toEqual(scope ? expectedRules.flatMap(rule => ['persist:' + rule, 'session:' + rule]) : expectedRules.map(rule => 'session:' + rule));
  });

  it('real once returns allow without any future rule effect', async () => {
    const actual = await realPrompt('1');
    expect(actual.allowed).toBe(true);
    expect(actual.persisted).toEqual([]);
    expect(actual.session).toEqual([]);
  });

  it('real deny returns false without any rule effect', async () => {
    const actual = await realPrompt('5');
    expect(actual.allowed).toBe(false);
    expect(actual.persisted).toEqual([]);
    expect(actual.session).toEqual([]);
  });

  it('a second persistence callback failure retains only completed effects and the current explicit allow', async () => {
    const actual = await realPrompt('3', 2);
    expect(actual.allowed).toBe(true);
    expect(actual.writes).toBe(2);
    expect(actual.persisted).toEqual([['project', expectedRules[0]]]);
    expect(actual.session).toEqual([expectedRules[0]]);
    expect(actual.order).toEqual(['persist:' + expectedRules[0], 'session:' + expectedRules[0], 'persist:' + expectedRules[1]]);
  });
});

describe('ordinary structural consumer DATA controls, not user-consent or SDK qualification', () => {
  it.each(actions)('$action keeps the old single rule and empty-vector fallback', async ({ action, scope }) => {
    for (const empty of [false, true]) {
      const persisted: Array<[string, string]> = [], session: string[] = [];
      const choice = { action, rule: 'bash(ls *)', ...(empty ? { rules: [] } : {}) };
      expect(await confirmChatPermission('bash', {}, {
        prompt: async () => choice,
        async addAllowRule(s, r) { persisted.push([s, r]); },
        addSessionRule(r) { session.push(r); },
      })).toBe(true);
      expect(session).toEqual(['bash(ls *)']);
      expect(persisted).toEqual(scope ? [[scope, 'bash(ls *)']] : []);
    }
  });

  it('deduplicates only the explicit vector and does not secretly add a non-vector legacy fallback rule', async () => {
    const session: string[] = [];
    const choice = { action: 'allow_session' as const, rule: 'bash(legacy-not-selected *)', rules: ['bash(ls *)', 'bash(cd *)', 'bash(ls *)'] };
    expect(await confirmChatPermission('bash', {}, {
      prompt: async () => choice,
      async addAllowRule() { throw new Error('session action must not invoke persistence'); },
      addSessionRule(rule) { session.push(rule); },
    })).toBe(true);
    expect(session).toEqual(['bash(ls *)', 'bash(cd *)']);
  });

  it('an already-aborted real signal cannot persist a prompt result', async () => {
    const abort = new AbortController(); abort.abort();
    const effects: string[] = [];
    const choice = { action: 'allow_global' as const, rule: 'bash(ls *)', rules: expectedRules };
    expect(await confirmChatPermission('bash', {}, {
      prompt: async () => choice,
      race: terminal => terminal('bash', {}, abort.signal),
      async addAllowRule(_scope, rule) { effects.push(rule); },
      addSessionRule(rule) { effects.push(rule); },
    })).toBe(false);
    expect(effects).toEqual([]);
  });

  it('a scripted remote winner has no terminal choice to save', async () => {
    const effects: string[] = [];
    let promptCalls = 0;
    expect(await confirmChatPermission('bash', {}, {
      prompt: async () => { promptCalls += 1; return { action: 'allow_once' }; },
      race: async () => true,
      async addAllowRule(_scope, rule) { effects.push(rule); },
      addSessionRule(rule) { effects.push(rule); },
    })).toBe(true);
    expect(promptCalls).toBe(0);
    expect(effects).toEqual([]);
  });
});
