import { createHash } from 'node:crypto';
import { applicationBindingReviewBytes, parseApplicationBindingReview } from './application-binding-review.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Fixed native application data framing, never approval or an authority ticket. */
export function encodeApplicationBindingReviewStream(raw) {
    const review = parseApplicationBindingReview(raw), bytes = applicationBindingReviewBytes(review);
    if (bytes.length <= 65536)
        return bytes;
    if (review.binding.kind !== 'intent' || bytes.length > 1048576)
        throw Error('application_review_stream_limit');
    const chunkSize = 65532, chunkCount = Math.ceil(bytes.length / chunkSize);
    const metadata = Buffer.from(json({ version: 1, purpose: 'completion-application-binding', encoding: 'canonical-ascii-chunks', totalBytes: bytes.length, reviewHash: createHash('sha256').update(bytes).digest('hex'), chunkCount }));
    const frame = (value) => { if (value.length > chunkSize)
        throw Error('application_review_stream_limit'); const length = Buffer.alloc(4); length.writeUInt32BE(value.length); return [length, value]; };
    const frames = [Buffer.from('XIAKAP1\n'), ...frame(metadata)];
    for (let at = 0; at < bytes.length; at += chunkSize)
        frames.push(...frame(bytes.subarray(at, at + chunkSize)));
    return Buffer.concat(frames);
}
