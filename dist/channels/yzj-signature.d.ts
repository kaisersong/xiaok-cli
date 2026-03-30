import type { SignatureVerificationResult, YZJIncomingMessage } from './yzj-types.js';
export declare function computeHmacSha1(data: string, secret: string): string;
export declare function buildSignatureString(msg: YZJIncomingMessage): string;
export declare function verifySignature(msg: YZJIncomingMessage, signature: string, secret: string): SignatureVerificationResult;
