import type { MultiAgentContentPage, MultiAgentDesktopAPI } from '../../../shared/multi-agent-types';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
// Decoded-page defense, independent of the main process's serialized wire cap.
const MAX_PAGE_BYTES = 64 * 1024;
const MAX_PAGES = 64; // The current 44KiB service pages need at most 47 requests.
export interface MultiAgentReadContent { text: string; byteLength: number; sha256: string; truncated: boolean }

/** Abandon a local read, without claiming that the underlying IPC was cancelled. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Read and verify saved bytes. Main still owns authorization and durable data. */
export async function readMultiAgentContent(api: Pick<MultiAgentDesktopAPI, 'getAgentContent'>,
  request: { threadId: string; groupId: string; contentId: string },
  options: { signal: AbortSignal; assertCurrent(): void }): Promise<MultiAgentReadContent> {
  const assertCurrent = () => { options.signal.throwIfAborted(); options.assertCurrent(); };
  let offset = 0;
  let metadata: Pick<MultiAgentContentPage, 'contentId' | 'byteLength' | 'sha256' | 'truncated'> | undefined;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  for (let pageNumber = 0; ; pageNumber++) {
    assertCurrent();
    if (pageNumber >= MAX_PAGES) throw new Error('invalid_content_page_count');
    const page = await untilAborted(api.getAgentContent({ ...request, offset }), options.signal);
    assertCurrent();
    if (!page || page.contentId !== request.contentId || !Number.isSafeInteger(page.byteLength) || page.byteLength < 0
      || page.byteLength > MAX_CONTENT_BYTES || typeof page.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(page.sha256)
      || typeof page.truncated !== 'boolean' || !Number.isSafeInteger(page.nextOffset)
      || typeof page.base64 !== 'string' || page.base64.length > Math.ceil(MAX_PAGE_BYTES / 3) * 4) throw new Error('invalid_content_page');
    if (metadata && (page.byteLength !== metadata.byteLength || page.sha256 !== metadata.sha256
      || page.truncated !== metadata.truncated)) throw new Error('content_metadata_changed');
    const binary = atob(page.base64);
    if (binary.length > MAX_PAGE_BYTES || btoa(binary) !== page.base64) throw new Error('invalid_content_base64');
    if (page.nextOffset !== offset + binary.length || page.nextOffset > page.byteLength
      || !binary.length && (offset !== 0 || page.byteLength !== 0)) throw new Error('invalid_content_offset');
    if (!metadata) {
      metadata = { contentId: page.contentId, byteLength: page.byteLength, sha256: page.sha256, truncated: page.truncated };
      bytes = new Uint8Array(page.byteLength);
    }
    for (let index = 0; index < binary.length; index++) bytes![offset + index] = binary.charCodeAt(index);
    offset = page.nextOffset;
    if (offset === metadata.byteLength) break;
  }
  assertCurrent();
  if (!globalThis.crypto?.subtle) throw new Error('content_digest_unavailable');
  const digest = await untilAborted(globalThis.crypto.subtle.digest('SHA-256', bytes!), options.signal);
  assertCurrent();
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (sha256 !== metadata.sha256) throw new Error('content_digest_mismatch');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assertCurrent();
  return { text, byteLength: metadata.byteLength, sha256, truncated: metadata.truncated };
}
