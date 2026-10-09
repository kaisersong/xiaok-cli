import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmbeddedYZJChannel } from '../../src/channels/embedded-yzj.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';
import type { YZJNamedChannel } from '../../src/types.js';
import type { YZJResolvedConfig } from '../../src/channels/yzj-types.js';
import type { RuntimeFacade } from '../../src/ai/runtime/runtime-facade.js';
import type { StreamChunk } from '../../src/types.js';

function makeConfig(): YZJResolvedConfig {
  return {
    webhookUrl: 'https://example.com/webhook',
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
      transport: transport as any,
      selectedChannel: makeChannel(robotId),
      yzjConfig: makeConfig(),
      sessionId: 'sess_test',
      cwd: '/tmp',
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

  it('resolves approve command', async () => {
    const approval = approvalStore.create({
      sessionId: 'sess_test',
      turnId: 'turn_1',
      summary: 'run bash',
    });
    const { ch } = makeChannel_();

    const decisionPromise = approvalStore.waitForDecision(approval.approvalId);

    await ch.handleInboundForTest({
      robotId: 'robot_1',
      content: `/approve ${approval.approvalId}`,
      operatorOpenid: 'user_1',
      msgId: 'msg_2',
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });

    const decision = await decisionPromise;
    expect(decision).toBe('approve');
  });

  it('resolves deny command', async () => {
    const approval = approvalStore.create({
      sessionId: 'sess_test',
      turnId: 'turn_1',
      summary: 'run bash',
    });
    const { ch } = makeChannel_();

    const decisionPromise = approvalStore.waitForDecision(approval.approvalId);

    await ch.handleInboundForTest({
      robotId: 'robot_1',
      content: `/deny ${approval.approvalId}`,
      operatorOpenid: 'user_1',
      msgId: 'msg_3',
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });

    const decision = await decisionPromise;
    expect(decision).toBe('deny');
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
      return { ch, done: async () => { finish(); await turn; } };
    }

    it('chat.ts no longer wires an always-true onPromptOverride and still routes prompts through makeOnPrompt', () => {
      const src = readFileSync(join(__dirname, '../../src/commands/chat.ts'), 'utf-8');
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
      const second = onPrompt('write', { file_path: '/tmp/x' });
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

    it('denies when the confirmation cannot be delivered to the channel', async () => {
      const { ch, done } = await channelTurn({ deliverError: true });
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await expect(ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' })).resolves.toBe(false);
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
