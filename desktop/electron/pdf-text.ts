import { extractOriginalPdfTextBody } from './pdf-text-body.js';
import type { WorkerOptions } from 'node:worker_threads';
import { types } from 'node:util';
import { createHash, Hash } from 'node:crypto';
import { fileURLToPath, URL as NativeURL } from 'node:url';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { loadOriginalProcessSdk } from '../../src/runtime/verification/original-process-sdk-loader.js';
import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import {
  captureOriginalMaterialExecutionParent,
  readOptionalOriginalMaterialExecutionSignal,
  readOptionalOriginalMaterialExecutionLifetime,
} from './main-material-source.js';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import type { OriginalProcessSourceRequest } from '../../src/runtime/verification/original-process-source-types.js';

const get = WeakMap.prototype.get,
  set = WeakMap.prototype.set,
  apply = Reflect.apply,
  freeze = Object.freeze,
  create = Object.create;
const isProxy = types.isProxy,
  isUint8Array = types.isUint8Array,
  from = Buffer.from,
  toString = Buffer.prototype.toString;
const hashFactory = createHash,
  hashUpdate = Hash.prototype.update,
  hashDigest = Hash.prototype.digest;
const descriptors = Object.getOwnPropertyDescriptors,
  ownKeys = Reflect.ownKeys,
  own = Object.hasOwn;
const requests = new WeakMap<
  object,
  OriginalProcessSourceRequest & { readonly initialFrameBase64: string }
>();
let invocation = 0;
const originalWorkerEntry = fileURLToPath(
  new NativeURL('./pdf-text-worker.js', import.meta.url),
);
export function readOptionalOriginalPdfWorkerSourceRequest(
  ticket: unknown,
):
  | (OriginalProcessSourceRequest & { readonly initialFrameBase64: string })
  | null {
  return (
    (apply(get, requests, [ticket]) as
      | (OriginalProcessSourceRequest & { readonly initialFrameBase64: string })
      | undefined) ?? null
  );
}
function hash(value: string | Uint8Array): string {
  const state = hashFactory('sha256');
  apply(hashUpdate, state, [value]);
  return apply(hashDigest, state, ['hex']) as string;
}

/** Shared original PDFJS implementation; Native source Worker selection is
 * added here without copying the decoder body. */
export async function extractPdfText(
  bytes: Uint8Array,
  beforeEffects?: () => void,
): Promise<string> {
  if (!hasOriginalMainSdkBridgeInstallation())
    return extractOriginalPdfTextBody(bytes, beforeEffects);
  assertBeforeEffects(beforeEffects);
  const context = captureOriginalMaterialExecutionParent();
  if (
    !context ||
    !bytes ||
    isProxy(bytes) ||
    !isUint8Array(bytes) ||
    bytes.byteLength > 100 * 1024 * 1024
  )
    throw Error('PDF_ORIGINAL_PROCESS_SOURCE_REQUIRED');
  const copied = apply(from, Buffer, [bytes]) as Buffer;
  const bytesBase64 = apply(toString, copied, ['base64']) as string;
  const frame = canonicalVerificationJson({
    kind: 'original_pdf_request_v1',
    bytesBase64,
  });
  const initialFrameBase64 = apply(
    toString,
    apply(from, Buffer, [frame, 'utf8']),
    ['base64'],
  ) as string;
  const entry = originalWorkerEntry;
  const execArgv: string[] = [];
  freeze(execArgv);
  const options: Readonly<WorkerOptions> = freeze({
    execArgv,
    resourceLimits: freeze({
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 64,
      stackSizeMb: 8,
    }),
  });
  const signal = readOptionalOriginalMaterialExecutionSignal(context);
  const lifetime = readOptionalOriginalMaterialExecutionLifetime(context);
  const assertLocal = () => {
    lifetime?.assertLocal();
    if (signal?.aborted) throw Error('PDF_SOURCE_WITHDRAWN');
  };
  const ticket = freeze(create(null));
  const request = freeze({
    kind: 'original_process_source_request_v1' as const,
    sourceKind: 'pdf_text_worker' as const,
    context,
    invocationId: 'pdf:' + ++invocation,
    specHash: hash(
      canonicalVerificationJson({
        kind: 'pdf_text_worker',
        entry,
        options,
        bytesHash: hash(copied),
      }),
    ),
    operation: 'worker' as const,
    entry,
    options,
    domain: 'component_only' as const,
    initialFrameBase64,
    ...(signal ? { signal } : {}),
    assertCurrent: () => {
      assertLocal();
      lifetime?.assertCurrent();
      if (beforeEffects) {
        const raw: unknown = apply(beforeEffects, undefined, []);
        if (raw !== undefined) return raw;
      }
      assertLocal();
    },
    assertLocal,
  });
  apply(set, requests, [ticket, request]);
  const sdk = await loadOriginalProcessSdk();
  const owned = await sdk.createOriginalSourceWorker(ticket);
  return new Promise<string>((yes, no) => {
    let terminal = false;
    const finish = (value: { text: string } | { error: unknown }) => {
      if (terminal) return;
      terminal = true;
      if ('error' in value) no(value.error);
      else yes(value.text);
    };
    sdk.listenOriginalToolProcess(
      owned.attempt,
      'child',
      'error',
      (error: unknown) => finish({ error }),
    );
    sdk.listenOriginalToolProcess(owned.attempt, 'child', 'exit', () =>
      finish({ error: Error('PDF_WORKER_RESULT_UNCONFIRMED') }),
    );
    sdk.listenOriginalToolProcess(
      owned.attempt,
      'child',
      'message',
      (raw: unknown) => {
        // This is text data from the owned component, never a permission/fate DTO.
        if (!raw || typeof raw !== 'object' || isProxy(raw)) {
          finish({ error: Error('PDF_WORKER_RESULT_UNCONFIRMED') });
          return;
        }
        const body = descriptors(raw),
          names = ownKeys(body);
        if (
          names.length === 3 &&
          body.kind &&
          own(body.kind, 'value') &&
          body.kind.value === 'original_pdf_error_v1' &&
          body.error &&
          own(body.error, 'value') &&
          typeof body.error.value === 'string' &&
          body.errorUndefined &&
          own(body.errorUndefined, 'value') &&
          typeof body.errorUndefined.value === 'boolean'
        ) {
          finish({
            error: body.errorUndefined.value
              ? undefined
              : Error(body.error.value),
          });
          return;
        }
        if (
          names.length !== 2 ||
          !body.kind ||
          !own(body.kind, 'value') ||
          !body.text ||
          !own(body.text, 'value') ||
          body.kind.value !== 'original_pdf_text_v1' ||
          typeof body.text.value !== 'string'
        ) {
          finish({ error: Error('PDF_WORKER_RESULT_UNCONFIRMED') });
          return;
        }
        finish({ text: body.text.value });
      },
    );
    sdk.sealOriginalToolProcessListeners(owned.attempt);
    const posted = sdk.postOriginalHostWorkerRequest(owned.attempt);
    sdk.retainOriginalToolProcessValue(owned.attempt, posted);
    void posted.catch((error: unknown) => finish({ error }));
  });
}
