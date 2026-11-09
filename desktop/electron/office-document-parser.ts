import { assertBeforeEffects } from '../../src/runtime/verification/before-effects.js';
import { spawn } from 'node:child_process';
import { createHash, Hash } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath, URL as NativeURL } from 'node:url';
import { types } from 'node:util';
import type { SpawnOptions } from 'node:child_process';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import {
  captureOriginalMaterialExecutionParent,
  readOptionalOriginalMaterialExecutionSignal,
  readOptionalOriginalMaterialExecutionLifetime,
} from './main-material-source.js';
import { canonicalVerificationJson } from '../../src/runtime/verification/protocol.js';
import { loadOriginalProcessSdk } from '../../src/runtime/verification/original-process-sdk-loader.js';
import { officeFormatForPath } from '../../src/runtime/materials/document-formats.js';
import {
  OFFICE_PARSER_PROTOCOL_VERSION,
  parseOfficeParserResponse,
  type OfficeParseResult,
  type OfficeParserErrorCode,
  type OfficeParserRequestV1,
} from './office-parser-protocol.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 2;
const originalExecPath = process.execPath,
  originalWorkerPath = fileURLToPath(
    new NativeURL('./office-parser-worker.mjs', import.meta.url),
  );
const sourceBufferFrom = Buffer.from,
  sourceBufferText = Buffer.prototype.toString;
const sourceGet = WeakMap.prototype.get,
  sourceSet = WeakMap.prototype.set,
  sourceApply = Reflect.apply,
  sourceFreeze = Object.freeze,
  sourceCreate = Object.create;
const sourceHash = createHash,
  sourceUpdate = Hash.prototype.update,
  sourceDigest = Hash.prototype.digest;
const sourceRequests = new WeakMap<
  object,
  OriginalOfficeProcessSourceRequest
>();
let nextSourceInvocation = 0;
const nativeJsonParse = JSON.parse,
  nativeDescriptor = Object.getOwnPropertyDescriptor,
  nativeOwn = Object.hasOwn,
  nativeIsProxy = types.isProxy;
export interface OriginalOfficeProcessSourceRequest {
  readonly kind: 'original_process_source_request_v1';
  readonly sourceKind: 'office_document_process';
  readonly context: object;
  readonly invocationId: string;
  readonly specHash: string;
  readonly operation: 'spawn';
  readonly command: string;
  readonly argv: readonly string[];
  readonly options: Readonly<SpawnOptions>;
  readonly domain: 'component_only';
  readonly initialFrameBase64: string;
  readonly signal?: AbortSignal;
  assertCurrent(): void;
  assertLocal(): void;
}
/** Only a ticket born by this original parse queue is recognized. */
export function readOptionalOriginalOfficeProcessSourceRequest(
  ticket: unknown,
): OriginalOfficeProcessSourceRequest | null {
  return (
    (sourceApply(sourceGet, sourceRequests, [ticket]) as
      | OriginalOfficeProcessSourceRequest
      | undefined) ?? null
  );
}
function sourceRequest(
  context: object,
  entry: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  beforeEffects: (() => void) | undefined,
  request: OfficeParserRequestV1,
): object {
  const options: Readonly<SpawnOptions> = sourceFreeze({
    shell: false,
    env: sourceFreeze({ ...env }),
    stdio: 'pipe',
  });
  const argv = sourceFreeze([entry]),
    command = originalExecPath;
  const frame = canonicalVerificationJson(request);
  const frameState = sourceHash('sha256');
  sourceApply(sourceUpdate, frameState, [frame]);
  const frameHash = sourceApply(sourceDigest, frameState, ['hex']) as string;
  const initialFrameBase64 = sourceApply(
    sourceBufferText,
    sourceApply(sourceBufferFrom, Buffer, [frame, 'utf8']),
    ['base64'],
  ) as string;
  const hash = sourceHash('sha256');
  sourceApply(sourceUpdate, hash, [
    canonicalVerificationJson({
      kind: 'office_document_process',
      command,
      argv,
      options,
      frameHash,
    }),
  ]);
  const specHash = sourceApply(sourceDigest, hash, ['hex']) as string;
  const assertLocal = () => {
    lifetime?.assertLocal();
    if (signal?.aborted) throw Error('MATERIAL_PROCESS_SOURCE_WITHDRAWN');
  };
  const lifetime = readOptionalOriginalMaterialExecutionLifetime(context);
  const ticket = sourceFreeze(sourceCreate(null));
  const row: OriginalOfficeProcessSourceRequest = sourceFreeze({
    kind: 'original_process_source_request_v1',
    sourceKind: 'office_document_process',
    context,
    invocationId: 'office:' + ++nextSourceInvocation,
    specHash,
    operation: 'spawn',
    command,
    argv,
    options,
    domain: 'component_only',
    initialFrameBase64,
    ...(signal ? { signal } : {}),
    assertCurrent: () => {
      assertLocal();
      lifetime?.assertCurrent();
      if (beforeEffects) {
        const raw: unknown = sourceApply(beforeEffects, undefined, []);
        if (raw !== undefined) return raw;
      }
      assertLocal();
    },
    assertLocal,
  });
  sourceApply(sourceSet, sourceRequests, [ticket, row]);
  return ticket;
}

export interface OfficeDocumentParser {
  parse(input: {
    absolutePath: string;
    maxOutputChars: number;
    signal?: AbortSignal;
    beforeEffects?: () => void;
  }): Promise<OfficeParseResult>;
}

export interface OfficeDocumentParserOptions {
  workerPath?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxConcurrency?: number;
  env?: NodeJS.ProcessEnv;
  onDiagnostic?: (diagnostic: OfficeParserDiagnostic) => void;
}

export interface OfficeParserDiagnostic {
  format: string;
  pathHash: string;
  inputBytes: number | null;
  outputChars: number;
  queueMs: number;
  spawnMs: number;
  parseMs: number;
  totalMs: number;
  success: boolean;
  code?: OfficeParserErrorCode;
}

interface QueuedJob {
  run: () => Promise<OfficeParseResult>;
  resolve: (result: OfficeParseResult) => void;
  reject: (error: unknown) => void;
  cancelQueued?: () => void;
}

export function createOfficeDocumentParser(
  options: OfficeDocumentParserOptions = {},
): OfficeDocumentParser {
  const configuredWorkerPath = options.workerPath;
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxStdoutBytes = positiveInteger(
    options.maxStdoutBytes,
    DEFAULT_MAX_STDOUT_BYTES,
  );
  const maxConcurrency = positiveInteger(
    options.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
  );
  const env = buildOfficeWorkerEnv(options.env ?? process.env);
  const queue: QueuedJob[] = [];
  let active = 0;

  const drain = () => {
    while (active < maxConcurrency && queue.length > 0) {
      const job = queue.shift()!;
      job.cancelQueued?.();
      active += 1;
      void job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  return {
    async parse(input) {
      assertBeforeEffects(input.beforeEffects);
      const installed = hasOriginalMainSdkBridgeInstallation();
      const parent = installed
        ? captureOriginalMaterialExecutionParent()
        : null;
      if (
        installed &&
        (!parent ||
          configuredWorkerPath !== undefined ||
          options.env !== undefined)
      )
        throw Error('OFFICE_ORIGINAL_PROCESS_SOURCE_REQUIRED');
      const validation = validateInput(
        input.absolutePath,
        input.maxOutputChars,
        input.signal,
      );
      if (validation) return Promise.resolve(validation);
      const format = officeFormatForPath(input.absolutePath)!;
      const request: OfficeParserRequestV1 = {
        protocolVersion: OFFICE_PARSER_PROTOCOL_VERSION,
        absolutePath: input.absolutePath,
        format,
        maxOutputChars: input.maxOutputChars,
      };
      const workerPath = configuredWorkerPath ?? originalWorkerPath;
      const signal = parent
        ? (readOptionalOriginalMaterialExecutionSignal(parent) ?? input.signal)
        : input.signal;
      const ticket = parent
        ? sourceRequest(
            parent,
            workerPath,
            env,
            signal,
            input.beforeEffects,
            request,
          )
        : undefined;
      return new Promise<OfficeParseResult>((resolve, reject) => {
        const enqueuedAt = Date.now();
        const job: QueuedJob = {
          resolve,
          reject,
          run: () =>
            runWorker({
              workerPath,
              timeoutMs,
              maxStdoutBytes,
              env,
              request,
              signal,
              sourceTicket: ticket,
              beforeEffects: input.beforeEffects,
              enqueuedAt,
              onDiagnostic: options.onDiagnostic,
            }),
        };
        if (signal) {
          const abortQueued = () => {
            const index = queue.indexOf(job);
            if (index < 0) return;
            queue.splice(index, 1);
            const result = failure(
              'aborted',
              'Office parsing was aborted.',
              false,
            );
            emitDiagnostic(
              { request, enqueuedAt, onDiagnostic: options.onDiagnostic },
              result,
              enqueuedAt,
              enqueuedAt,
              Date.now(),
            );
            resolve(result);
          };
          signal.addEventListener('abort', abortQueued, { once: true });
          job.cancelQueued = () =>
            signal.removeEventListener('abort', abortQueued);
        }
        queue.push(job);
        drain();
      });
    },
  };
}

export function buildOfficeWorkerEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'windir',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
  ];
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
  for (const key of allowed) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

async function runWorker(input: {
  workerPath: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  env: NodeJS.ProcessEnv;
  request: OfficeParserRequestV1;
  signal?: AbortSignal;
  sourceTicket?: object;
  beforeEffects?: () => void;
  enqueuedAt: number;
  onDiagnostic?: (diagnostic: OfficeParserDiagnostic) => void;
}): Promise<OfficeParseResult> {
  assertBeforeEffects(input.beforeEffects);
  if (input.signal?.aborted) {
    const result = failure('aborted', 'Office parsing was aborted.', false);
    emitDiagnostic(input, result, input.enqueuedAt, input.enqueuedAt, 0);
    return result;
  }
  const sdk = input.sourceTicket ? await loadOriginalProcessSdk() : undefined;
  const owned = input.sourceTicket
    ? await sdk!.createOriginalSourceProcess(input.sourceTicket)
    : undefined;
  return new Promise<OfficeParseResult>((resolve, reject) => {
    const startedAt = Date.now();
    let spawnedAt = startedAt;
    let settled = false;
    let stdoutBytes = 0;
    const stdout: Buffer[] = [];
    let forcedResult: OfficeParseResult | undefined;
    let postFailure: { error: unknown } | undefined;
    const child =
      owned?.handle ??
      spawn(process.execPath, [input.workerPath], {
        shell: false,
        env: input.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    const listen = (
      endpoint: 'child' | 'stdin' | 'stdout' | 'stderr',
      event: string,
      callback: Function,
    ) => {
      if (owned) {
        sdk!.listenOriginalToolProcess(
          owned.attempt,
          endpoint,
          event,
          callback,
        );
        return;
      }
      const target = endpoint === 'child' ? child : child[endpoint];
      if (endpoint === 'stdout' && event === 'data')
        target!.on(event, callback as (...args: any[]) => void);
      else target!.once(event, callback as (...args: any[]) => void);
    };

    const finish = (result: OfficeParseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      if (postFailure) {
        reject(postFailure.error);
        return;
      }
      emitDiagnostic(
        input,
        result,
        startedAt,
        spawnedAt,
        Date.now(),
        owned
          ? (raw) => sdk!.retainOriginalToolProcessValue(owned.attempt, raw)
          : undefined,
      );
      resolve(result);
    };
    const terminate = (result: OfficeParseResult) => {
      forcedResult = result;
      if (owned) {
        void sdk!
          .terminateOriginalToolProcess(owned.attempt, 'SIGTERM')
          .catch(() => {});
      } else child.kill();
    };
    const abort = () =>
      terminate(failure('aborted', 'Office parsing was aborted.', false));
    const timer = setTimeout(() => {
      terminate(
        failure(
          'timeout',
          `Office parsing exceeded ${input.timeoutMs}ms.`,
          true,
        ),
      );
    }, input.timeoutMs);

    input.signal?.addEventListener('abort', abort, { once: true });
    listen('child', 'spawn', () => {
      spawnedAt = Date.now();
    });
    listen('child', 'error', (error: unknown) => {
      finish(
        failure('worker_start_failed', sanitizeError(error, !!owned), true),
      );
    });
    listen('stdout', 'data', (chunk: Buffer) => {
      if (forcedResult) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > input.maxStdoutBytes) {
        terminate(
          failure(
            'resource_limit',
            `Office parser stdout exceeded ${input.maxStdoutBytes} bytes.`,
            false,
          ),
        );
        return;
      }
      stdout.push(chunk);
    });
    listen(
      'child',
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (forcedResult) {
          finish(forcedResult);
          return;
        }
        if (code !== 0) {
          finish(
            failure(
              'worker_crashed',
              `Office parser exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`,
              true,
            ),
          );
          return;
        }
        const raw = Buffer.concat(stdout).toString('utf8');
        let decoded: unknown;
        try {
          decoded = owned ? nativeJsonParse(raw) : JSON.parse(raw);
        } catch {
          finish(
            failure(
              'protocol_error',
              'Office parser returned invalid JSON.',
              false,
            ),
          );
          return;
        }
        const response = parseOfficeParserResponse(decoded);
        if (!response) {
          finish(
            failure(
              'protocol_error',
              'Office parser returned an invalid response.',
              false,
            ),
          );
          return;
        }
        const { protocolVersion: _protocolVersion, ...result } = response;
        finish(result);
      },
    );

    listen('stdin', 'error', () => undefined);
    if (owned) sdk!.sealOriginalToolProcessListeners(owned.attempt);
    assertBeforeEffects(input.beforeEffects);
    if (input.sourceTicket)
      readOptionalOriginalOfficeProcessSourceRequest(
        input.sourceTicket,
      )!.assertLocal();
    if (owned) {
      const failPost = (error: unknown) => {
        postFailure ??= { error };
        sdk!.retainOriginalToolProcessValue(owned.attempt, error);
        const killed = sdk!.terminateOriginalToolProcess(
          owned.attempt,
          'SIGTERM',
        );
        sdk!.retainOriginalToolProcessValue(owned.attempt, killed);
        void killed.catch(() => {});
      };
      try {
        const posted = sdk!.postOriginalHostWorkerRequest(owned.attempt);
        sdk!.retainOriginalToolProcessValue(owned.attempt, posted);
        void posted.catch(failPost);
      } catch (error) {
        failPost(error);
      }
    } else child.stdin!.end(JSON.stringify(input.request));
  });
}

function emitDiagnostic(
  input: {
    request: OfficeParserRequestV1;
    enqueuedAt: number;
    onDiagnostic?: (diagnostic: OfficeParserDiagnostic) => void;
  },
  result: OfficeParseResult,
  startedAt: number,
  spawnedAt: number,
  finishedAt: number,
  retain?: (raw: unknown) => void,
): void {
  if (!input.onDiagnostic) return;
  let inputBytes: number | null = null;
  if (!retain)
    try {
      inputBytes = statSync(input.request.absolutePath).size;
    } catch {
      // The stable result code already captures an unreadable source.
    }
  const pathState = sourceHash('sha256');
  sourceApply(sourceUpdate, pathState, [input.request.absolutePath]);
  const diagnostic: OfficeParserDiagnostic = {
    format: input.request.format,
    pathHash: sourceApply(sourceDigest, pathState, ['hex']) as string,
    inputBytes,
    outputChars: result.ok ? result.chars : 0,
    queueMs: Math.max(0, startedAt - input.enqueuedAt),
    spawnMs: Math.max(0, spawnedAt - startedAt),
    parseMs: Math.max(0, finishedAt - spawnedAt),
    totalMs: Math.max(0, finishedAt - input.enqueuedAt),
    success: result.ok,
    ...(!result.ok ? { code: result.code } : {}),
  };
  try {
    retain?.(input.onDiagnostic);
    const raw: unknown = input.onDiagnostic(diagnostic);
    retain?.(raw);
    retain?.(input.onDiagnostic);
  } catch (error) {
    retain?.(error);
    // Diagnostics must never change parse behavior.
  }
}

function validateInput(
  absolutePath: string,
  maxOutputChars: number,
  signal?: AbortSignal,
): OfficeParseResult | undefined {
  if (signal?.aborted)
    return failure('aborted', 'Office parsing was aborted.', false);
  if (!isAbsolute(absolutePath))
    return failure(
      'io_error',
      'Office parser requires an absolute path.',
      false,
    );
  if (!officeFormatForPath(absolutePath))
    return failure(
      'unsupported_format',
      'Unsupported Office document format.',
      false,
    );
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    return failure(
      'resource_limit',
      'maxOutputChars must be a positive integer.',
      false,
    );
  }
  return undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function failure(
  code: OfficeParserErrorCode,
  message: string,
  retryable: boolean,
): OfficeParseResult {
  return { ok: false, code, message, retryable };
}

function sanitizeError(error: unknown, safe = false): string {
  if (safe) {
    if (typeof error === 'string') return error.slice(0, 500);
    const slot =
      error && typeof error === 'object' && !nativeIsProxy(error)
        ? nativeDescriptor(error, 'message')
        : undefined;
    return slot && nativeOwn(slot, 'value') && typeof slot.value === 'string'
      ? slot.value.slice(0, 500)
      : 'Office parser worker failed.';
  }
  return error instanceof Error
    ? error.message.slice(0, 500)
    : String(error).slice(0, 500);
}
