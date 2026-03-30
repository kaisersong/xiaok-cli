import type { YZJIncomingMessage } from './yzj-types.js';

export const DEFAULT_WEBSOCKET_HEALTH = {
  heartbeatMs: 15_000,
  staleMs: 45_000,
} as const;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

export function getReconnectDelayMs(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1)] ?? 60_000;
}

export function shouldReconnectAfterInvalidFrames(consecutiveInvalidFrames: number): boolean {
  return consecutiveInvalidFrames >= 3;
}

type ControlResult = {
  kind: 'control';
  reason: string;
  ack?: string;
};

type DispatchResult = {
  kind: 'dispatch';
  message: YZJIncomingMessage;
};

type InvalidResult = {
  kind: 'invalid';
};

export function classifyWebSocketPayload(payload: unknown): ControlResult | DispatchResult | InvalidResult {
  if (typeof payload === 'string') {
    const normalized = payload.trim().toLowerCase();
    if (normalized === 'ping' || normalized === 'pong') {
      return { kind: 'control', reason: normalized };
    }
    return { kind: 'invalid' };
  }

  if (!payload || typeof payload !== 'object') return { kind: 'invalid' };
  const record = payload as Record<string, unknown>;

  const directBusinessMessage = normalizeBusinessMessage(record);
  if (directBusinessMessage) return { kind: 'dispatch', message: directBusinessMessage };

  const nestedBusinessMessage = normalizeBusinessEnvelope(record);
  if (nestedBusinessMessage) return { kind: 'dispatch', message: nestedBusinessMessage };

  const cmd = typeof record.cmd === 'string' ? record.cmd.trim().toLowerCase() : '';
  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  const event = typeof record.event === 'string' ? record.event.trim().toLowerCase() : '';
  const controlName = cmd || type || event;

  if (cmd === 'directpush' || type === 'msgchg') {
    const ack = record.needAck === true && typeof record.seq === 'number'
      ? JSON.stringify({ cmd: 'ack', seq: record.seq })
      : undefined;
    return { kind: 'control', reason: 'directPush', ...(ack ? { ack } : {}) };
  }

  if (controlName !== '') {
    return { kind: 'control', reason: controlName };
  }

  return { kind: 'invalid' };
}

function normalizeBusinessEnvelope(record: Record<string, unknown>): YZJIncomingMessage | null {
  const envelopeType = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  if (envelopeType !== 'robotmessage') return null;
  if (!record.msg || typeof record.msg !== 'object') return null;
  return normalizeBusinessMessage(record.msg as Record<string, unknown>);
}

function normalizeBusinessMessage(record: Record<string, unknown>): YZJIncomingMessage | null {
  if (typeof record.robotId !== 'string') return null;
  if (typeof record.robotName !== 'string') return null;
  if (typeof record.operatorOpenid !== 'string') return null;
  if (typeof record.operatorName !== 'string') return null;
  if (typeof record.msgId !== 'string') return null;
  if (typeof record.content !== 'string') return null;
  if (typeof record.type !== 'number') return null;
  if (typeof record.time !== 'number') return null;

  return {
    type: record.type,
    robotId: record.robotId,
    robotName: record.robotName,
    operatorOpenid: record.operatorOpenid,
    operatorName: record.operatorName,
    time: record.time,
    msgId: record.msgId,
    content: record.content,
    groupType: typeof record.groupType === 'number' ? record.groupType : 0,
  };
}
