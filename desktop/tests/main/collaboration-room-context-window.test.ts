import { describe, it, expect } from 'vitest';
import {
  buildRoomContextWindow,
  parseCollaborationRoomTurnEnvelope,
} from '../../electron/collaboration-room-wake-dispatcher.js';

// design §6.1/§6.2: Room 上下文完整性证明。
describe('buildRoomContextWindow', () => {
  it('marks the window complete when every message fits inside windowSize', () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({ roomSequence: i + 1, messageId: `m${i + 1}` }));
    const { window: contextWindow, windowedMessages } = buildRoomContextWindow(messages, { windowSize: 20 });

    expect(contextWindow.isComplete).toBe(true);
    expect(contextWindow.totalMessages).toBe(5);
    expect(contextWindow.fromSequence).toBe(1);
    expect(contextWindow.toSequence).toBe(5);
    expect(contextWindow.truncatedBeforeSequence).toBeUndefined();
    expect(windowedMessages).toHaveLength(5);
  });

  it('marks the window incomplete and records truncatedBeforeSequence when the room has more history than the window', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ roomSequence: i + 1, messageId: `m${i + 1}` }));
    const { window: contextWindow, windowedMessages } = buildRoomContextWindow(messages, { windowSize: 20 });

    expect(contextWindow.isComplete).toBe(false);
    expect(contextWindow.totalMessages).toBe(30);
    expect(windowedMessages).toHaveLength(20);
    expect(contextWindow.fromSequence).toBe(11);
    expect(contextWindow.toSequence).toBe(30);
    expect(contextWindow.truncatedBeforeSequence).toBe(11);
  });

  it('sorts messages by roomSequence before windowing, regardless of input order', () => {
    const messages = [
      { roomSequence: 3, messageId: 'm3' },
      { roomSequence: 1, messageId: 'm1' },
      { roomSequence: 2, messageId: 'm2' },
    ];
    const { windowedMessages } = buildRoomContextWindow(messages, { windowSize: 20 });
    expect(windowedMessages.map((m) => m.messageId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('handles an empty room with zero messages', () => {
    const { window: contextWindow, windowedMessages } = buildRoomContextWindow([], { windowSize: 20 });
    expect(contextWindow.totalMessages).toBe(0);
    expect(contextWindow.isComplete).toBe(true);
    expect(windowedMessages).toHaveLength(0);
  });

  it('records a fixed snapshotAt timestamp for the caller-provided now', () => {
    const now = new Date('2026-09-02T00:00:00.000Z');
    const { window: contextWindow } = buildRoomContextWindow([{ roomSequence: 1 }], { now });
    expect(contextWindow.snapshotAt).toBe('2026-09-02T00:00:00.000Z');
  });
});

describe('parseCollaborationRoomTurnEnvelope (design §6.2 consumer boundary)', () => {
  function validEnvelope(overrides: Record<string, unknown> = {}) {
    return {
      roomId: 'room-a',
      roomTitle: 'A',
      roomRevision: 1,
      roomMessageId: 'msg-1',
      logicalAgentId: 'agent-a',
      contextScope: { kind: 'room_only' },
      attachmentPaths: [],
      contextWindow: {
        fromSequence: 1,
        toSequence: 3,
        totalMessages: 3,
        isComplete: true,
        snapshotAt: '2026-09-02T00:00:00.000Z',
      },
      messages: [
        { messageId: 'm1', sender: {}, kind: 'text' },
        { messageId: 'm2', sender: {}, kind: 'text' },
        { messageId: 'm3', sender: {}, kind: 'text' },
      ],
      ...overrides,
    };
  }

  it('[GREEN] accepts a well-formed envelope with a consistent contextWindow', () => {
    const result = parseCollaborationRoomTurnEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
  });

  it('[SECURITY] rejects an envelope missing contextWindow entirely', () => {
    const envelope = validEnvelope();
    delete (envelope as Record<string, unknown>).contextWindow;
    const result = parseCollaborationRoomTurnEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('contextWindow_required');
  });

  it('[SECURITY] rejects an envelope whose contextWindow has non-numeric sequence fields', () => {
    const result = parseCollaborationRoomTurnEnvelope(
      validEnvelope({ contextWindow: { fromSequence: 'not-a-number', toSequence: 3, totalMessages: 3, isComplete: true, snapshotAt: 'x' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('contextWindow_sequence_invalid');
  });

  it('[SECURITY] rejects an envelope claiming isComplete=true but with a message count mismatch', () => {
    const result = parseCollaborationRoomTurnEnvelope(
      validEnvelope({
        contextWindow: { fromSequence: 1, toSequence: 3, totalMessages: 99, isComplete: true, snapshotAt: 'x' },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('contextWindow_total_mismatch');
  });

  it('[SECURITY] rejects an envelope with an inverted sequence range', () => {
    const result = parseCollaborationRoomTurnEnvelope(
      validEnvelope({ contextWindow: { fromSequence: 10, toSequence: 1, totalMessages: 3, isComplete: false, snapshotAt: 'x' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('contextWindow_sequence_range_invalid');
  });

  it('accepts an incomplete window (isComplete=false) as long as its shape is internally consistent', () => {
    const result = parseCollaborationRoomTurnEnvelope(
      validEnvelope({
        contextWindow: { fromSequence: 11, toSequence: 30, totalMessages: 30, isComplete: false, truncatedBeforeSequence: 11, snapshotAt: 'x' },
        messages: [{ messageId: 'm1', sender: {}, kind: 'text' }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('[SECURITY] rejects a non-object envelope', () => {
    expect(parseCollaborationRoomTurnEnvelope(null).ok).toBe(false);
    expect(parseCollaborationRoomTurnEnvelope('not an object').ok).toBe(false);
  });

  it('[SECURITY] rejects an envelope with messages missing entirely', () => {
    const envelope = validEnvelope();
    delete (envelope as Record<string, unknown>).messages;
    const result = parseCollaborationRoomTurnEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('messages_required');
  });
});
