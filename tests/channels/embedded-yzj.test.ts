import { confirmChatPermission } from '../../src/commands/chat-permission.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWithTurnOrigin } from '../../src/channels/turn-origin.js';
import { EmbeddedYZJChannel } from '../../src/channels/embedded-yzj.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';
import type { YZJNamedChannel } from '../../src/types.js';
import type { YZJResolvedConfig } from '../../src/channels/yzj-types.js';
import type { RuntimeFacade } from '../../src/ai/runtime/runtime-facade.js';
import type { StreamChunk } from '../../src/types.js';

function makeConfig(): YZJResolvedConfig {
  return {
    webhookUrl: 'https://example.invalid/ws',
    inboundMode: 'websocket',
    webhookPath: '/yzj/webhook',
    webhookPort: 3001,
    secret: undefined,
  };
}

function makeChannel(robotId = 'robot_1'): YZJNamedChannel {
  return { name: 'test-channel', robotId };
}

function makeFacade(chunks: StreamChunk[] = [{ type: 'text', delta: 'hello' }]) {
  return {
    runTurn: vi.fn(async (_req: unknown, onChunk: (c: StreamChunk) => void) => {
      for (const c of chunks) onChunk(c);
    }),
  } as unknown as RuntimeFacade;
}

describe('EmbeddedYZJChannel', () => {
  let sent: Array<{ text: string }>;
  let approvalStore: InMemoryApprovalStore;
  let hooks: ReturnType<typeof createRuntimeHooks>;

  beforeEach(() => {
    sent = [];
    approvalStore = new InMemoryApprovalStore();
    hooks = createRuntimeHooks();
  });

  function makeChannel_(
    robotId = 'robot_1',
    facade?: RuntimeFacade,
    extra: { approvalTimeoutMs?: number; deliverError?: boolean } = {},
  ) {
    const transport = {
      deliver: vi.fn(async (msg: { text: string; kind?: string }) => {
        if (extra.deliverError && msg.kind === 'approval') throw new Error('network down');
        sent.push({ text: msg.text });
      }),
    };
    const ch = new EmbeddedYZJChannel({
      runtimeFacade: facade ?? makeFacade(),
      runtimeHooks: hooks,
      approvalStore,
      ...(extra.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: extra.approvalTimeoutMs } : {}),
      allowedSenders: ['user_1', 'user_2'],
      transport: transport as any,
      selectedChannel: makeChannel(robotId),
      yzjConfig: makeConfig(),
      sessionId: 'sess_test',
      cwd: '/ws',
    });
    return { ch, transport };
  }

  it('routes plain text to runTurn and pushes reply to channel', async () => {
    const facade = makeFacade([{ type: 'text', delta: 'hi' }, { type: 'text', delta: '!' }]);
    const { ch } = makeChannel_('robot_1', facade);

    await ch.handleInboundForTest({
      robotId: 'robot_1',
      content: 'hello',
      operatorOpenid: 'user_1',
      msgId: 'msg_1',
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });

    expect(facade.runTurn).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe('hi!');
  });

  it('ignores messages with non-matching robotId', async () => {
    const facade = makeFacade();
    const { ch } = makeChannel_('robot_1', facade);

    await ch.handleInboundForTest({
      robotId: 'robot_other',
      content: 'hello',
      operatorOpenid: 'user_1',
      msgId: 'msg_1',
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });

    expect(facade.runTurn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('ignores /approve for approvals this channel did not issue', async () => {
    const approval = approvalStore.create({
      sessionId: 'sess_test',
      turnId: 'turn_1',
      summary: 'run bash',
    });
    const { ch } = makeChannel_();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await ch.handleInboundForTest({
        robotId: 'robot_1',
        content: `/approve ${approval.approvalId}`,
        operatorOpenid: 'user_1',
        msgId: 'msg_approve',
        operatorName: 'Alice',
        robotName: 'Bot',
        groupType: 0,
        time: Date.now(),
        type: 1,
      });
    } finally {
      stderr.mockRestore();
    }

    expect(approvalStore.get(approval.approvalId)).toBeDefined();
    approvalStore.expire(approval.approvalId);
  });

  it('ignores /deny for approvals this channel did not issue', async () => {
    const approval = approvalStore.create({
      sessionId: 'sess_test',
      turnId: 'turn_1',
      summary: 'run bash',
    });
    const { ch } = makeChannel_();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await ch.handleInboundForTest({
        robotId: 'robot_1',
        content: `/deny ${approval.approvalId}`,
        operatorOpenid: 'user_1',
        msgId: 'msg_deny',
        operatorName: 'Alice',
        robotName: 'Bot',
        groupType: 0,
        time: Date.now(),
        type: 1,
      });
    } finally {
      stderr.mockRestore();
    }

    expect(approvalStore.get(approval.approvalId)).toBeDefined();
    approvalStore.expire(approval.approvalId);
  });

  it('pushes approval request to channel when pushApprovalRequestForTest is called', async () => {
    const { ch } = makeChannel_();

    await ch.pushApprovalRequestForTest('approval_42', 'run bash', { chatId: 'robot_1', userId: 'user_1' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('approval_42');
    expect(sent[0]!.text).toContain('/approve');
    expect(sent[0]!.text).toContain('/deny');
  });

  it('does not push empty reply to channel', async () => {
    const facade = makeFacade([{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }]);
    const { ch } = makeChannel_('robot_1', facade);

    await ch.handleInboundForTest({
      robotId: 'robot_1',
      content: 'ping',
      operatorOpenid: 'user_1',
      msgId: 'msg_4',
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });

    expect(sent).toHaveLength(0);
  });

  describe('tool confirmation (makeOnPrompt) never auto-approves', () => {
    const inbound = (content: string, msgId = 'msg_in', operatorOpenid = 'user_1', robotId = 'robot_1') => ({
      robotId,
      content,
      operatorOpenid,
      msgId,
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });
    const pendingForever = () => new Promise<boolean>(() => {});
    const flush = () => new Promise((r) => setTimeout(r, 0));

    /** 让 channel 发起的 turn 一直处于运行中，直到调用 finish()。 */
    function gatedFacade() {
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const facade = { runTurn: vi.fn(async () => { await gate; }) } as unknown as RuntimeFacade;
      return { facade, finish: () => release() };
    }

    async function channelTurn(extra: { approvalTimeoutMs?: number; deliverError?: boolean } = {}) {
      const { facade, finish } = gatedFacade();
      const { ch } = makeChannel_('robot_1', facade, extra);
      const turn = ch.handleInboundForTest(inbound('please do it'));
      await flush();
      const makeOnPrompt = ch.makeOnPrompt.bind(ch);
      ch.makeOnPrompt = (tui) => (name, input) => runWithTurnOrigin(
        { source: 'yzj', initiator: 'user_1', channelTurnId: 'msg_in' },
        () => makeOnPrompt(tui)(name, input),
      );
      return { ch, done: async () => { finish(); await turn; } };
    }

    it('chat.ts no longer wires an always-true onPromptOverride and still routes prompts through makeOnPrompt', () => {
      const src = readFileSync(join(process.cwd(), 'src/commands/chat.ts'), 'utf-8');
      expect(src).not.toMatch(/onPromptOverride:\s*async\s*\(\)\s*=>\s*true/);
      expect(src).not.toMatch(/onPromptOverride/);
      expect(src).toMatch(/makeOnPrompt\(tuiDecide\)/);
    });

    it('terminal-originated turns use the terminal decision only (deny stays deny)', async () => {
      const { ch } = makeChannel_();
      await ch.handleInboundForTest(inbound('earlier message'));
      sent.length = 0;
      const tui = vi.fn(async () => false);
      await expect(ch.makeOnPrompt(tui)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(tui).toHaveBeenCalledOnce();
      expect(approvalStore.listPending()).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('explicit chat origin never participates even while a channel turn is active', async () => {
      const { facade, finish } = gatedFacade();
      const { ch } = makeChannel_('robot_1', facade);
      const turn = ch.handleInboundForTest(inbound('hello'));
      await flush();
      await expect(runWithTurnOrigin({ source: 'chat' }, () => ch.makeOnPrompt(async () => true)('web_fetch', { url: 'https://example.invalid/' }))).resolves.toBe(true);
      expect(sent).toHaveLength(0);
      expect(approvalStore.listPending()).toHaveLength(0);
      finish(); await turn;
    });

    it('matches the turn ID when the same sender has overlapping turns', async () => {
      const { facade, finish } = gatedFacade();
      const { ch, transport } = makeChannel_('robot_1', facade);
      const turns = [ch.handleInboundForTest(inbound('first', 'turn_a')), ch.handleInboundForTest(inbound('second', 'turn_b'))];
      await flush();
      const decision = runWithTurnOrigin({ source: 'yzj', initiator: 'user_1', channelTurnId: 'turn_b' }, () => ch.makeOnPrompt(pendingForever)('read', { path: '/ws' }));
      await flush();
      expect((transport.deliver.mock.calls[0]![0] as any).target.messageId).toBe('turn_b');
      const [pending] = approvalStore.listPending();
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`));
      await expect(decision).resolves.toBe(true);
      finish(); await Promise.all(turns);
    });

    it('missing initiator does not participate in channel confirmation', async () => {
      const { facade, finish } = gatedFacade();
      const { ch } = makeChannel_('robot_1', facade);
      const turn = ch.handleInboundForTest(inbound('hello'));
      await flush();
      await expect(runWithTurnOrigin({ source: 'yzj' }, () => ch.makeOnPrompt(async () => false)('read', { path: '/ws' }))).resolves.toBe(false);
      expect(sent).toHaveLength(0);
      finish(); await turn;
    });

    it('passes initiator and channel turn ID into the runtime', async () => {
      const facade = makeFacade([]);
      const { ch } = makeChannel_('robot_1', facade);
      await ch.handleInboundForTest(inbound('hello', 'turn_42'));
      expect(facade.runTurn).toHaveBeenCalledWith(expect.objectContaining({ source: 'yzj', initiator: 'user_1', channelTurnId: 'turn_42' }), expect.any(Function));
    });

    it('denied senders cannot start turns or resolve approvals and receive one fixed reply', async () => {
      const facade = makeFacade([]);
      const { ch } = makeChannel_('robot_1', facade);
      const pending = approvalStore.create({ sessionId: 's', turnId: 't', summary: 'read' });
      try {
        await ch.handleInboundForTest(inbound('private body', 'denied_1', 'outsider'));
        await ch.handleInboundForTest(inbound(`/approve ${pending.approvalId}`, 'denied_2', 'outsider'));
        expect(facade.runTurn).not.toHaveBeenCalled();
        expect(approvalStore.get(pending.approvalId)).toBeDefined();
        expect(sent).toEqual([{ text: '你没有权限使用这个助手。' }]);
      } finally { approvalStore.expire(pending.approvalId); }
    });

    it('terminal approval is still honoured', async () => {
      const { ch } = makeChannel_();
      await expect(ch.makeOnPrompt(async () => true)('bash', { command: 'ls' })).resolves.toBe(true);
    });

    it('messages for another robot do not make the channel take part in confirmations', async () => {
      const { facade } = gatedFacade();
      const { ch } = makeChannel_('robot_1', facade);
      void ch.handleInboundForTest(inbound('hello', 'msg_x', 'user_1', 'robot_other'));
      await flush();
      await expect(ch.makeOnPrompt(async () => false)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(sent).toHaveLength(0);
      expect(facade.runTurn).not.toHaveBeenCalled();
    });

    it('does not resolve on its own while nobody has answered, and asks the terminal too', async () => {
      const { ch, done } = await channelTurn();
      const tui = vi.fn(pendingForever);
      let settled = false;
      void ch.makeOnPrompt(tui)('bash', { command: 'ls' }).then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 30));
      expect(settled).toBe(false);
      expect(tui).toHaveBeenCalledOnce();
      expect(approvalStore.listPending()).toHaveLength(1);
      for (const p of approvalStore.listPending()) approvalStore.expire(p.approvalId);
      await done();
    });

    it('pushes the confirmation to the turn originator and approves only on their explicit /approve', async () => {
      const { ch, done } = await channelTurn();
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      expect(pending).toBeDefined();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain(pending!.approvalId);
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`, 'msg_ok'));
      await expect(decision).resolves.toBe(true);
      await done();
    });

    it('ignores /approve from a different user in the same channel', async () => {
      const { ch, done } = await channelTurn({ approvalTimeoutMs: 50 });
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`, 'msg_other', 'user_2'));
        expect(approvalStore.get(pending!.approvalId)).toBeDefined();
        await expect(decision).resolves.toBe(false);
      } finally {
        stderr.mockRestore();
      }
      await done();
    });

    it('ignores /deny from a different user and unknown approval ids without crashing', async () => {
      const { ch, done } = await channelTurn();
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await ch.handleInboundForTest(inbound(`/deny ${pending!.approvalId}`, 'msg_other_deny', 'user_2'));
        await ch.handleInboundForTest(inbound('/approve approval_does_not_exist', 'msg_garbage'));
      } finally {
        stderr.mockRestore();
      }
      expect(approvalStore.get(pending!.approvalId)).toBeDefined();
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`, 'msg_owner'));
      await expect(decision).resolves.toBe(true);
      await done();
    });

    it('does not route to the channel while two channel turns overlap', async () => {
      const a = gatedFacade();
      const { ch } = makeChannel_('robot_1', a.facade);
      const t1 = ch.handleInboundForTest(inbound('first', 'msg_a', 'user_1'));
      const t2 = ch.handleInboundForTest(inbound('second', 'msg_b', 'user_2'));
      await flush();
      sent.length = 0;
      await expect(ch.makeOnPrompt(async () => false)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(approvalStore.listPending()).toHaveLength(0);
      expect(sent).toHaveLength(0);
      a.finish();
      await Promise.all([t1, t2]);
    });

    it('denies when the terminal prompt throws synchronously', async () => {
      const { ch } = makeChannel_();
      const throwsSync = (() => { throw new Error('boom'); }) as unknown as (n: string, i: Record<string, unknown>) => Promise<boolean>;
      await expect(ch.makeOnPrompt(throwsSync)('bash', { command: 'ls' })).resolves.toBe(false);
    });

    it('denies on explicit /deny from the channel', async () => {
      const { ch, done } = await channelTurn();
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      await ch.handleInboundForTest(inbound(`/deny ${pending!.approvalId}`, 'msg_no'));
      await expect(decision).resolves.toBe(false);
      await done();
    });

    it('keeps consecutive confirmations separate', async () => {
      const { ch, done } = await channelTurn();
      const onPrompt = ch.makeOnPrompt(pendingForever);
      const first = onPrompt('bash', { command: 'ls' });
      await flush();
      const [p1] = approvalStore.listPending();
      await ch.handleInboundForTest(inbound(`/deny ${p1!.approvalId}`, 'msg_d'));
      await expect(first).resolves.toBe(false);
      const second = onPrompt('write', { file_path: '/ws/x' });
      await flush();
      const [p2] = approvalStore.listPending();
      expect(p2!.approvalId).not.toBe(p1!.approvalId);
      await ch.handleInboundForTest(inbound(`/approve ${p1!.approvalId}`, 'msg_stale'));
      expect(approvalStore.get(p2!.approvalId)).toBeDefined();
      await ch.handleInboundForTest(inbound(`/approve ${p2!.approvalId}`, 'msg_a'));
      await expect(second).resolves.toBe(true);
      await done();
    });

    it('denies when the channel confirmation times out', async () => {
      const { ch, done } = await channelTurn({ approvalTimeoutMs: 20 });
      await expect(ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(approvalStore.listPending()).toHaveLength(0);
      await done();
    });

    it('keeps the terminal decision when the confirmation cannot be delivered', async () => {
      const { ch, done } = await channelTurn({ deliverError: true });
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await expect(ch.makeOnPrompt(async () => { await flush(); return true; })('bash', { command: 'ls' })).resolves.toBe(true);
      } finally {
        stderr.mockRestore();
      }
      expect(approvalStore.listPending()).toHaveLength(0);
      await done();
    });

    it('denies when the terminal prompt errors on a terminal-originated turn', async () => {
      const { ch } = makeChannel_();
      await expect(ch.makeOnPrompt(async () => { throw new Error('tty gone'); })('bash', { command: 'ls' })).resolves.toBe(false);
    });


    it('withdraws the terminal before a channel decision can write rules and includes the URL', async () => {
      const { ch, done } = await channelTurn();
      const addRule = vi.fn();
      let signal!: AbortSignal;
      const decision = confirmChatPermission('web_fetch', { url: 'https://example.invalid/page' }, {
        prompt: async (_name, _input, abortSignal) => {
          signal = abortSignal!;
          await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
          return { action: 'allow_project', rule: 'web_fetch' };
        },
        race: tui => ch.makeOnPrompt(tui)('web_fetch', { url: 'https://example.invalid/page' }),
        addAllowRule: addRule,
        addSessionRule: addRule,
      });
      await flush();
      expect(sent[0]!.text).toContain('web_fetch: https://example.invalid/page');
      const [pending] = approvalStore.listPending();
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`));
      await expect(decision).resolves.toBe(true);
      expect(signal.aborted).toBe(true);
      expect(addRule).not.toHaveBeenCalled();
      await done();
    });

    it('leaves a hanging delivery after its deadline and lets the terminal decide', async () => {
      const { ch, done } = await channelTurn();
      const transport = (ch as any).options.transport;
      transport.deliver.mockImplementation(() => new Promise(() => {}));
      vi.useFakeTimers();
      try {
        let answer!: (value: boolean) => void;
        let settled = false;
        const decision = ch.makeOnPrompt(() => new Promise<boolean>(resolve => { answer = resolve; }))('web_fetch', { url: 'https://example.invalid/' });
        void decision.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(10_001);
        expect(settled).toBe(false);
        expect(approvalStore.listPending()).toHaveLength(0);
        answer(true);
        await expect(decision).resolves.toBe(true);
      } finally { vi.useRealTimers(); await done(); }
    });

    it('closes the pending channel confirmation once the terminal answers first', async () => {
      const { ch, done } = await channelTurn();
      let answer!: (v: boolean) => void;
      const decision = ch.makeOnPrompt(() => new Promise<boolean>((r) => { answer = r; }))('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      expect(pending).toBeDefined();
      answer(false);
      await expect(decision).resolves.toBe(false);
      expect(approvalStore.get(pending!.approvalId)).toBeUndefined();
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`, 'late'));
      expect(approvalStore.listPending()).toHaveLength(0);
      await done();
    });

    it('stops routing confirmations to the channel after the channel turn ends', async () => {
      const { ch, done } = await channelTurn();
      await done();
      await expect(ch.makeOnPrompt(async () => false)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(approvalStore.listPending()).toHaveLength(0);
    });
  });
});
