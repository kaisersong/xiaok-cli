import { describe, expect, it, vi, beforeEach } from 'vitest';
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

  function makeChannel_(robotId = 'robot_1', facade?: RuntimeFacade) {
    const transport = {
      deliver: vi.fn(async (msg: { text: string }) => { sent.push({ text: msg.text }); }),
    };
    const ch = new EmbeddedYZJChannel({
      runtimeFacade: facade ?? makeFacade(),
      runtimeHooks: hooks,
      approvalStore,
      onPromptOverride: vi.fn(async () => true),
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
});
