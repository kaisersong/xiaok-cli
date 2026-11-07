import { parentPort } from 'node:worker_threads';
import { extractOriginalPdfTextBody } from './pdf-text-body.js';
import { types } from 'node:util';

if (!parentPort) throw Error('PDF_FIXED_WORKER_PORT_REQUIRED');
const port = parentPort;
let accepted = false;
port.on('message', async (raw: unknown) => {
  if (accepted) throw Error('PDF_FIXED_WORKER_ALREADY_USED');
  accepted = true;
  try {
    if (
      typeof raw !== 'string' ||
      Buffer.byteLength(raw, 'utf8') > 140 * 1024 * 1024
    )
      throw Error('PDF_FIXED_WORKER_INPUT_INVALID');
    const request: unknown = JSON.parse(raw);
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw Error('PDF_FIXED_WORKER_INPUT_INVALID');
    const rows = Object.getOwnPropertyDescriptors(request),
      names = Reflect.ownKeys(rows);
    if (
      names.length !== 2 ||
      !rows.kind ||
      !Object.hasOwn(rows.kind, 'value') ||
      rows.kind.value !== 'original_pdf_request_v1' ||
      !rows.bytesBase64 ||
      !Object.hasOwn(rows.bytesBase64, 'value') ||
      typeof rows.bytesBase64.value !== 'string'
    )
      throw Error('PDF_FIXED_WORKER_INPUT_INVALID');
    const bytes = Buffer.from(rows.bytesBase64.value, 'base64');
    if (
      bytes.length > 100 * 1024 * 1024 ||
      bytes.toString('base64') !== rows.bytesBase64.value
    )
      throw Error('PDF_FIXED_WORKER_INPUT_INVALID');
    const text = await extractOriginalPdfTextBody(new Uint8Array(bytes));
    port.postMessage({ kind: 'original_pdf_text_v1', text });
  } catch (error) {
    // No raw SDK error is converted into a healthy fate. Parent P remains the
    // component-only original attempt even after this bounded Worker exits.
    const slot =
      error && typeof error === 'object' && !types.isProxy(error)
        ? Object.getOwnPropertyDescriptor(error, 'message')
        : undefined;
    port.postMessage({
      kind: 'original_pdf_error_v1',
      error:
        slot && Object.hasOwn(slot, 'value') && typeof slot.value === 'string'
          ? slot.value
          : 'PDF extraction failed.',
      errorUndefined: error === undefined,
    });
  } finally {
    port.close();
  }
});
