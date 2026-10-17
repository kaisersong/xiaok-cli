/** Fixed independent receiver owner. Listener is last, and unknown construction
 * or drain never authorizes releasing this service's original lifetime lock. */
export declare function startInstalledVerificationReceiver(): Promise<Readonly<{
    close: () => Promise<void>;
}>>;
