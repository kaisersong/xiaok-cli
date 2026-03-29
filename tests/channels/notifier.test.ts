import { describe, it, expect } from 'vitest';
import { ChannelNotifier } from '../../src/channels/notifier.js';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';
import type { OutboundChannelMessage } from '../../src/channels/types.js';
import { createRuntimeHooks } from '../../src/runtime/hooks.js';

describe('channel notifier', () => {
  it('sends plain text messages to the provided delivery transport', async () => {
    const sent: OutboundChannelMessage[] = [];
    const notifier = new ChannelNotifier({
      deliver: async (message) => {
        sent.push(message);
      },
    });

    await notifier.sendText(
      {
        channel: 'telegram',
        chatId: '1001',
        threadId: '99',
      },
      'working on it'
    );

    expect(sent).toEqual([
      {
        channel: 'telegram',
        target: {
          chatId: '1001',
          threadId: '99',
        },
        text: 'working on it',
      },
    ]);
  });

  it('subscribes to runtime events and emits approval plus completion notifications', async () => {
    const sent: OutboundChannelMessage[] = [];
    const hooks = createRuntimeHooks();
    const approvals = new InMemoryApprovalStore();
    const notifier = new ChannelNotifier({
      deliver: async (message) => {
        sent.push(message);
      },
    });

    const request = approvals.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: 'Allow bash command?',
    });

    notifier.bindRuntimeHooks(hooks, {
      resolveTarget: (sessionId) => {
        if (sessionId !== 'sess_1') {
          return undefined;
        }

        return {
          channel: 'slack',
          chatId: 'C123',
          threadId: '171',
        };
      },
      approvalStore: approvals,
    });

    hooks.emit({
      type: 'approval_required',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      approvalId: request.approvalId,
    });
    hooks.emit({
      type: 'turn_completed',
      sessionId: 'sess_1',
      turnId: 'turn_1',
    });

    expect(sent).toEqual([
      {
        channel: 'slack',
        target: {
          chatId: 'C123',
          threadId: '171',
        },
        text: 'Approval required: Allow bash command?',
      },
      {
        channel: 'slack',
        target: {
          chatId: 'C123',
          threadId: '171',
        },
        text: 'Turn completed: turn_1',
      },
    ]);
  });
});
