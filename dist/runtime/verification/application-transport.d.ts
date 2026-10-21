/** Exact signed controller namespace; public values never carry native authority. */
export declare const APPLICATION_METHODS: readonly ["application.prepareRequest", "application.lookupRequest", "application.recoverRequest", "application.prepare", "application.authorize", "application.inspect", "application.reconcile"];
export type ApplicationMethod = typeof APPLICATION_METHODS[number];
export interface AuthenticatedApplicationTransport {
    call(method: ApplicationMethod, payload: unknown, signal?: AbortSignal): Promise<unknown>;
}
