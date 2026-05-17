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
export type ReminderDaemonSink = (delivery: ReminderDaemonDelivery) => Promise<void> | void;
export declare class ReminderDaemonRegistry {
    private readonly bySession;
    private readonly sessionByClient;
    register(registration: ReminderDaemonSessionRegistration, sink: ReminderDaemonSink): void;
    unregisterClient(clientInstanceId: string): void;
    touchHeartbeat(clientInstanceId: string, heartbeatAt: number): void;
    expireStaleSessions(now: number, staleAfterMs: number): string[];
    listActiveSessions(): ReminderDaemonSessionRegistration[];
    deliverToSession(delivery: ReminderDaemonDelivery): Promise<void>;
}
