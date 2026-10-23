import { type KeyObject } from 'node:crypto';
/** The signed wire envelope, not raw tool bytes, is the resource boundary.
 * Only untrusted execution output may be shortened; terminal/receipt metadata is immutable. */
export declare function encodeControllerResponse(input: unknown, privateKey: KeyObject): Buffer;
