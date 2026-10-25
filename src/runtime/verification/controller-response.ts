import { sign, type KeyObject } from 'node:crypto';
import { canonicalVerificationJson, VERIFICATION_BUDGET } from './protocol.js';

/** The signed wire envelope, not raw tool bytes, is the resource boundary.
 * Only untrusted execution output may be shortened; terminal/receipt metadata is immutable. */
export function encodeControllerResponse(input: unknown, privateKey: KeyObject): Buffer {
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw Error('controller_response_key');
  const payload = JSON.parse(canonicalVerificationJson(input));
  const limit = VERIFICATION_BUDGET.rpcBytes;
  const placeholder = 'A'.repeat(86) + '==';
  const measure = () => Buffer.byteLength(canonicalVerificationJson({ payload, signature: placeholder }));
  if (measure() > limit) {
    const result = payload?.result;
    if (payload?.method !== 'execution.dispatch' || !result || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || typeof result.outputTruncated !== 'boolean') throw Error('controller_response_essential_limit');
    const stdout = result.stdout, stderr = result.stderr;
    result.stdout = ''; result.stderr = ''; result.outputTruncated = true;
    if (measure() > limit) throw Error('controller_response_essential_limit');
    const prefix = (value: string, count: number): string => {
      // Do not split a valid UTF-16 pair and emit a new lone surrogate.
      if (count > 0 && count < value.length && /[\uD800-\uDBFF]/.test(value[count - 1]) && /[\uDC00-\uDFFF]/.test(value[count])) count--;
      return value.slice(0, count);
    };
    let low = 0, high = stdout.length + stderr.length;
    const set = (count: number) => {
      const left = Math.floor(count * stdout.length / (stdout.length + stderr.length || 1));
      result.stdout = prefix(stdout, left); result.stderr = prefix(stderr, count - left);
    };
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); set(middle);
      if (measure() <= limit) low = middle; else high = middle - 1;
    }
    set(low);
  }
  const signature = sign(null, Buffer.from(canonicalVerificationJson(payload)), privateKey).toString('base64');
  const bytes = Buffer.from(canonicalVerificationJson({ payload, signature }));
  if (bytes.length > limit) throw Error('controller_response_essential_limit');
  return bytes;
}
