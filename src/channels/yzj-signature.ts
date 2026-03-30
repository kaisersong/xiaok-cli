import { createHmac } from 'node:crypto';

import type { SignatureVerificationResult, YZJIncomingMessage } from './yzj-types.js';

export function computeHmacSha1(data: string, secret: string): string {
  const hmac = createHmac('sha1', secret);
  hmac.update(data, 'utf8');
  return hmac.digest('base64');
}

export function buildSignatureString(msg: YZJIncomingMessage): string {
  return [
    msg.robotId,
    msg.robotName,
    msg.operatorOpenid,
    msg.operatorName,
    String(msg.time),
    msg.msgId,
    msg.content,
  ].join(',');
}

export function verifySignature(
  msg: YZJIncomingMessage,
  signature: string,
  secret: string
): SignatureVerificationResult {
  try {
    const signatureString = buildSignatureString(msg);
    const expectedSignature = computeHmacSha1(signatureString, secret);
    if (signature === expectedSignature) {
      return { valid: true };
    }
    return {
      valid: false,
      error: `signature mismatch: expected=${expectedSignature} actual=${signature}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: `签名验证过程出错：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
