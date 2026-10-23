import { type InstalledReceiverLifetime } from './installed-receiver-lifetime.js';
/** Synchronous samples from the original root broker's continuous clock domain.
 * No alternate endpoint, identity, clock or lifetime can be provided. */
export declare function createInstalledReceiverClock(lifetime: InstalledReceiverLifetime): Readonly<{
    sample(): Readonly<import("./receiver-store.js").ReceiverClockEvidence>;
    close(): void;
}>;
