import { describe, expect, it, vi } from 'vitest';
import { ReminderDeliveryError } from '../../../src/runtime/reminder/errors.js';
import {
  ReminderDaemonRegistry,
  type ReminderDaemonSessionRegistration,
} from '../../../src/runtime/reminder/daemon-registry.js';

function createRegistration(overrides: Partial<ReminderDaemonSessionRegistration> = {}): ReminderDaemonSessionRegistration {
  return {
    clientInstanceId: 'client_1',
    sessionId: 'sess_1',
    creatorUserId: 'user_1',
    workspaceRoot: 'D:/projects/xiaok-cli',
    clientVersion: '0.5.7',
    protocolVersion: 1,
    heartbeatAt: 1_000,
    ...overrides,
  };
}

describe('reminder daemon registry', () => {
  it('routes a bound-session delivery only to the currently registered sink for that session', async () => {
    const registry = new ReminderDaemonRegistry();
    const firstSink = vi.fn(async () => undefined);
    const secondSink = vi.fn(async () => undefined);

    registry.register(createRegistration(), firstSink);
    registry.register(createRegistration({
      clientInstanceId: 'client_2',
      heartbeatAt: 2_000,
    }), secondSink);

    await registry.deliverToSession({
      sessionId: 'sess_1',
      reminderId: 'reminder_1',
      content: '发日报',
      createdAt: 3_000,
    });

    expect(firstSink).not.toHaveBeenCalled();
    expect(secondSink).toHaveBeenCalledOnce();
    expect(secondSink).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_1',
      reminderId: 'reminder_1',
      content: '发日报',
    }));
  });

  it('fails with a non-retryable offline error when the target session has no active sink', async () => {
    const registry = new ReminderDaemonRegistry();

    await expect(registry.deliverToSession({
      sessionId: 'sess_missing',
      reminderId: 'reminder_1',
      content: '发日报',
      createdAt: 3_000,
    })).rejects.toMatchObject({
      name: ReminderDeliveryError.name,
      message: 'target session offline',
      retryable: false,
    });
  });

  it('expires stale registrations without affecting newer sessions', () => {
    const registry = new ReminderDaemonRegistry();
    const sink = vi.fn(async () => undefined);

    registry.register(createRegistration({
      clientInstanceId: 'client_old',
      sessionId: 'sess_old',
      heartbeatAt: 1_000,
    }), sink);
    registry.register(createRegistration({
      clientInstanceId: 'client_new',
      sessionId: 'sess_new',
      heartbeatAt: 12_000,
    }), sink);

    const expired = registry.expireStaleSessions(15_500, 5_000);

    expect(expired).toEqual(['sess_old']);
    expect(registry.listActiveSessions().map((entry) => entry.sessionId)).toEqual(['sess_new']);
  });
});
