/** Exact signed controller namespace; public values never carry native authority. */
export const APPLICATION_METHODS=['application.prepareRequest','application.lookupRequest','application.recoverRequest','application.prepare','application.authorize','application.inspect','application.reconcile'] as const;
export type ApplicationMethod=typeof APPLICATION_METHODS[number];
export interface AuthenticatedApplicationTransport {call(method:ApplicationMethod,payload:unknown,signal?:AbortSignal):Promise<unknown>}
