import { ReminderDeliveryError } from './errors.js';
import type { TaskExecution, ReminderTaskType } from './types.js';

export interface ReminderDaemonSessionRegistration {
  clientInstanceId: string;
  sessionId: string;
  creatorUserId: string;
  workspaceRoot: string;
  clientVersion: string;
  protocolVersion: number;
  heartbeatAt: number;
}

export interface ReminderDaemonDelivery {
  sessionId: string;
  reminderId: string;
  content: string;
  createdAt: number;
  taskType: ReminderTaskType;
  execution?: TaskExecution;
}

export type ReminderDaemonSink = (
  delivery: ReminderDaemonDelivery,
) => Promise<void> | void;

interface RegisteredSession {
  registration: ReminderDaemonSessionRegistration;
  sink: ReminderDaemonSink;
}

export class ReminderDaemonRegistry {
  private readonly bySession = new Map<string, RegisteredSession>();
  private readonly sessionByClient = new Map<string, string>();

  register(
    registration: ReminderDaemonSessionRegistration,
    sink: ReminderDaemonSink,
  ): void {
    const previousSessionId = this.sessionByClient.get(registration.clientInstanceId);
    if (previousSessionId && previousSessionId !== registration.sessionId) {
      this.bySession.delete(previousSessionId);
    }

    this.bySession.set(registration.sessionId, {
      registration: { ...registration },
      sink,
    });
    this.sessionByClient.set(registration.clientInstanceId, registration.sessionId);
  }

  unregisterClient(clientInstanceId: string): void {
    const sessionId = this.sessionByClient.get(clientInstanceId);
    if (!sessionId) {
      return;
    }
    this.sessionByClient.delete(clientInstanceId);
    this.bySession.delete(sessionId);
  }

  touchHeartbeat(clientInstanceId: string, heartbeatAt: number): void {
    const sessionId = this.sessionByClient.get(clientInstanceId);
    if (!sessionId) {
      return;
    }
    const current = this.bySession.get(sessionId);
    if (!current) {
      this.sessionByClient.delete(clientInstanceId);
      return;
    }
    this.bySession.set(sessionId, {
      ...current,
      registration: {
        ...current.registration,
        heartbeatAt,
      },
    });
  }

  expireStaleSessions(now: number, staleAfterMs: number): string[] {
    const cutoff = now - staleAfterMs;
    const expired: string[] = [];

    for (const [sessionId, entry] of this.bySession.entries()) {
      if (entry.registration.heartbeatAt > cutoff) {
        continue;
      }
      expired.push(sessionId);
      this.bySession.delete(sessionId);
      this.sessionByClient.delete(entry.registration.clientInstanceId);
    }

    return expired;
  }

  listActiveSessions(): ReminderDaemonSessionRegistration[] {
    return Array.from(this.bySession.values())
      .map((entry) => ({ ...entry.registration }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async deliverToSession(delivery: ReminderDaemonDelivery): Promise<void> {
    const entry = this.bySession.get(delivery.sessionId);
    if (!entry) {
      throw new ReminderDeliveryError('target session offline', {
        retryable: false,
        code: 'target_session_offline',
      });
    }

    await entry.sink({ ...delivery });
  }
}