import type { SessionStore } from '../../ai/runtime/session-store/store.js';
/** Fixed issuer helper. The returned closure can only reject changed local
 * facts; it never issues a provider/native/business capability. */
export declare function prepareIntentProviderCurrent(input: {
    store: SessionStore;
    sessionId: string;
    instanceId: string | undefined;
    signal: AbortSignal;
}): Promise<() => void>;
