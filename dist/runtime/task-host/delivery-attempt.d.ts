import type { GuardFailure, HostDeliveryRecord, HostDeliveryReport, HostDeliverySource } from './delivery-types.js';
/** One live post-seal owner. A rejected waiter is never a physical drain receipt. */
export declare class HostDeliveryAttempt {
    readonly source: HostDeliverySource;
    readonly deadline: number;
    private readonly now;
    private readonly report?;
    readonly controller: AbortController;
    readonly pending: Set<Promise<unknown>>;
    private readonly seen;
    acknowledged: boolean;
    readerStarted: boolean;
    record: HostDeliveryRecord;
    constructor(source: HostDeliverySource, deadline: number, startedAt: number, deadlineAt: number, now: () => number, report?: ((report: HostDeliveryReport) => Promise<HostDeliveryReport>) | undefined);
    track: <T>(raw: Promise<T>) => Promise<T>;
    begin(): Promise<void>;
    assertActive(): void;
    abort(code: 'delivery_timeout' | 'app_shutdown'): void;
    fail(code: GuardFailure['code']): void;
    pass(): void;
    unknown(): void;
    publish(advance?: boolean): void;
    capture(): HostDeliveryReport;
    wait<T>(raw: Promise<T>): Promise<T>;
    drain(): Promise<void>;
}
