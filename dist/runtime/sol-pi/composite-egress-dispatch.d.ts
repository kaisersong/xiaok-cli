import type { createCompositeEgressService } from './composite-egress-service.js';
/** Bounded request and response transfer for the original one-attempt owner. */
export declare function createCompositeEgressDispatch(actual: ReturnType<typeof createCompositeEgressService>): (request: any) => Promise<import("./composite-egress-journal.js").CompositeEgressRecord | {
    offset: number;
    discarded?: undefined;
    attemptId?: undefined;
    status?: undefined;
    totalBytes?: undefined;
    bytesBase64?: undefined;
    released?: undefined;
    record?: undefined;
    responseAvailable?: undefined;
} | {
    discarded: boolean;
    offset?: undefined;
    attemptId?: undefined;
    status?: undefined;
    totalBytes?: undefined;
    bytesBase64?: undefined;
    released?: undefined;
    record?: undefined;
    responseAvailable?: undefined;
} | {
    attemptId: any;
    status: number;
    totalBytes: number;
    offset?: undefined;
    discarded?: undefined;
    bytesBase64?: undefined;
    released?: undefined;
    record?: undefined;
    responseAvailable?: undefined;
} | {
    status: number;
    totalBytes: number;
    offset: any;
    bytesBase64: string;
    discarded?: undefined;
    attemptId?: undefined;
    released?: undefined;
    record?: undefined;
    responseAvailable?: undefined;
} | {
    released: boolean;
    offset?: undefined;
    discarded?: undefined;
    attemptId?: undefined;
    status?: undefined;
    totalBytes?: undefined;
    bytesBase64?: undefined;
    record?: undefined;
    responseAvailable?: undefined;
} | {
    record: import("./composite-egress-journal.js").CompositeEgressRecord | undefined;
    responseAvailable: boolean;
    offset?: undefined;
    discarded?: undefined;
    attemptId?: undefined;
    status?: undefined;
    totalBytes?: undefined;
    bytesBase64?: undefined;
    released?: undefined;
} | undefined>;
