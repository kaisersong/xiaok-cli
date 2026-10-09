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
    const inbound = (content: string, msgId = 'msg_in') => ({
      robotId: 'robot_1',
      content,
      operatorOpenid: 'user_1',
      msgId,
      operatorName: 'Alice',
      robotName: 'Bot',
      groupType: 0,
      time: Date.now(),
      type: 1,
    });
    const pendingForever = () => new Promise<boolean>(() => {});
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('chat.ts no longer wires an always-true onPromptOverride', () => {
      const src = readFileSync(join(__dirname, '../../src/commands/chat.ts'), 'utf-8');
      expect(src).not.toMatch(/onPromptOverride:\s*async\s*\(\)\s*=>\s*true/);
    });

    it('without a channel user, the terminal decision is used (deny stays deny)', async () => {
      const { ch } = makeChannel_();
      const onPrompt = ch.makeOnPrompt(async () => false);
      await expect(onPrompt('bash', { command: 'ls' })).resolves.toBe(false);
      expect(approvalStore.listPending()).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('without a channel user, terminal approval is still honoured', async () => {
      const { ch } = makeChannel_();
      await expect(ch.makeOnPrompt(async () => true)('bash', { command: 'ls' })).resolves.toBe(true);
    });

    it('does not resolve on its own while nobody has answered', async () => {
      const { ch } = makeChannel_();
      await ch.handleInboundForTest(inbound('hello'));
      let settled = false;
      void ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' }).then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 30));
      expect(settled).toBe(false);
      expect(approvalStore.listPending()).toHaveLength(1);
    });

    it('pushes the confirmation to the channel user and approves only on explicit /approve', async () => {
      const { ch } = makeChannel_();
      await ch.handleInboundForTest(inbound('hello'));
      sent.length = 0;
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      expect(pending).toBeDefined();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain(pending!.approvalId);
      await ch.handleInboundForTest(inbound(`/approve ${pending!.approvalId}`, 'msg_ok'));
      await expect(decision).resolves.toBe(true);
    });

    it('denies on explicit /deny from the channel', async () => {
      const { ch } = makeChannel_();
      await ch.handleInboundForTest(inbound('hello'));
      const decision = ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      await ch.handleInboundForTest(inbound(`/deny ${pending!.approvalId}`, 'msg_no'));
      await expect(decision).resolves.toBe(false);
    });

    it('denies when the channel confirmation times out', async () => {
      const { ch } = makeChannel_('robot_1', undefined, { approvalTimeoutMs: 20 });
      await ch.handleInboundForTest(inbound('hello'));
      await expect(ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' })).resolves.toBe(false);
      expect(approvalStore.listPending()).toHaveLength(0);
    });

    it('denies when the confirmation cannot be delivered to the channel', async () => {
      const { ch } = makeChannel_('robot_1', undefined, { deliverError: true });
      await ch.handleInboundForTest(inbound('hello'));
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await expect(ch.makeOnPrompt(pendingForever)('bash', { command: 'ls' })).resolves.toBe(false);
      } finally {
        stderr.mockRestore();
      }
      expect(approvalStore.listPending()).toHaveLength(0);
    });

    it('denies when the terminal prompt errors and no channel user exists', async () => {
      const { ch } = makeChannel_();
      await expect(ch.makeOnPrompt(async () => { throw new Error('tty gone'); })('bash', { command: 'ls' })).resolves.toBe(false);
    });

    it('closes the pending channel confirmation once the terminal answers first', async () => {
      const { ch } = makeChannel_();
      await ch.handleInboundForTest(inbound('hello'));
      let answer!: (v: boolean) => void;
      const decision = ch.makeOnPrompt(() => new Promise<boolean>((r) => { answer = r; }))('bash', { command: 'ls' });
      await flush();
      const [pending] = approvalStore.listPending();
      expect(pending).toBeDefined();
      answer(false);
      await expect(decision).resolves.toBe(false);
      expect(approvalStore.get(pending!.approvalId)).toBeUndefined();
    });
  });
});
