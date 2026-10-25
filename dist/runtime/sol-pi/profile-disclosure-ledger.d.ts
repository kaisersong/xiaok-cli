import type { createObservationService, ObservationCaller, ObservationDestination } from './observation-service.js';
import type { createFullSendCounter } from './full-send-counter.js';
type Service = ReturnType<typeof createObservationService>;
type Counter = ReturnType<typeof createFullSendCounter>;
interface AccountBinding {
    service: Service;
    sessionId: string;
    sourceCounter: Counter;
    validate(): void;
}
/** No callback or serializable descriptor can turn a counter into a shared account. */
export declare function getProfileDisclosureAccountBinding(account: object, service: Service, sessionId: string): Readonly<AccountBinding> | undefined;
/** One authority's existing counter is the sole durable writer. Accounts never
 * create files, reset observations, duplicate reservations, or close that writer.
 * Cross-authority egress must use participant receipts, not this in-process port. */
export declare function createProfileDisclosureLedger(options: {
    service: Service;
    counter: Counter;
}): Readonly<{
    createAccount(input: {
        requestSource: "user" | "agent" | "scheduler";
        caller: ObservationCaller;
        sessionId: string;
        destination: ObservationDestination;
    }): Counter;
    dispose(): void;
}>;
export {};
