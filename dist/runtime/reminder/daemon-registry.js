import { ReminderDeliveryError } from './errors.js';
export class ReminderDaemonRegistry {
    bySession = new Map();
    sessionByClient = new Map();
    register(registration, sink) {
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
    unregisterClient(clientInstanceId) {
        const sessionId = this.sessionByClient.get(clientInstanceId);
        if (!sessionId) {
            return;
        }
        this.sessionByClient.delete(clientInstanceId);
        this.bySession.delete(sessionId);
    }
    touchHeartbeat(clientInstanceId, heartbeatAt) {
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
    expireStaleSessions(now, staleAfterMs) {
        const cutoff = now - staleAfterMs;
        const expired = [];
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
    listActiveSessions() {
        return Array.from(this.bySession.values())
            .map((entry) => ({ ...entry.registration }))
            .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    }
    async deliverToSession(delivery) {
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
