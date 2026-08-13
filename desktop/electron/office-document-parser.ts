import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export interface OfficeDocumentParser {
  parse(input: {
    absolutePath: string;
    maxOutputChars: number;
    signal?: AbortSignal;
  }): Promise<OfficeParseResult>;
}

export interface OfficeDocumentParserOptions {
  workerPath?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxConcurrency?: number;
  env?: NodeJS.ProcessEnv;
}

interface QueuedJob {
  run: () => Promise<OfficeParseResult>;
  resolve: (result: OfficeParseResult) => void;
}

export function createOfficeDocumentParser(options: OfficeDocumentParserOptions = {}): OfficeDocumentParser {
  const workerPath = options.workerPath ?? fileURLToPath(new URL('./office-parser-worker.mjs', import.meta.url));
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxStdoutBytes = positiveInteger(options.maxStdoutBytes, DEFAULT_MAX_STDOUT_BYTES);
  const maxConcurrency = positiveInteger(options.maxConcurrency, DEFAULT_MAX_CONCURRENCY);
  const env = buildOfficeWorkerEnv(options.env ?? process.env);
  const queue: QueuedJob[] = [];
  let active = 0;

  const drain = () => {
    while (active < maxConcurrency && queue.length > 0) {
      const job = queue.shift()!;
      active += 1;
      void job.run().then(job.resolve).finally(() => {
        active -= 1;
        drain();
      });
    }
  };

  return {
    parse(input) {
      const validation = validateInput(input.absolutePath, input.maxOutputChars, input.signal);
      if (validation) return Promise.resolve(validation);
      const format = officeFormatForPath(input.absolutePath)!;
      const request: OfficeParserRequestV1 = {
        protocolVersion: OFFICE_PARSER_PROTOCOL_VERSION,
        absolutePath: input.absolutePath,
        format,
        maxOutputChars: input.maxOutputChars,
      };
      return new Promise<OfficeParseResult>((resolve) => {
        queue.push({
          resolve,
          run: () => runWorker({ workerPath, timeoutMs, maxStdoutBytes, env, request, signal: input.signal }),
        });
        drain();
      });
    },
  };
}

export function buildOfficeWorkerEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
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
}): Promise<OfficeParseResult> {
  if (input.signal?.aborted) return failure('aborted', 'Office parsing was aborted.', false);
  return new Promise<OfficeParseResult>((resolve) => {
    let settled = false;
    let stdoutBytes = 0;
    const stdout: Buffer[] = [];
    let forcedResult: OfficeParseResult | undefined;
    const child = spawn(process.execPath, [input.workerPath], {
      shell: false,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (result: OfficeParseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const terminate = (result: OfficeParseResult) => {
      forcedResult = result;
      child.kill();
    };
    const abort = () => terminate(failure('aborted', 'Office parsing was aborted.', false));
    const timer = setTimeout(() => {
      terminate(failure('timeout', `Office parsing exceeded ${input.timeoutMs}ms.`, true));
    }, input.timeoutMs);

    input.signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      finish(failure('worker_start_failed', sanitizeError(error), true));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (forcedResult) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > input.maxStdoutBytes) {
        terminate(failure('resource_limit', `Office parser stdout exceeded ${input.maxStdoutBytes} bytes.`, false));
        return;
      }
      stdout.push(chunk);
    });
    child.once('close', (code, signal) => {
      if (forcedResult) {
        finish(forcedResult);
        return;
      }
      if (code !== 0) {
        finish(failure('worker_crashed', `Office parser exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`, true));
        return;
      }
      const raw = Buffer.concat(stdout).toString('utf8');
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        finish(failure('protocol_error', 'Office parser returned invalid JSON.', false));
        return;
      }
      const response = parseOfficeParserResponse(decoded);
      if (!response) {
        finish(failure('protocol_error', 'Office parser returned an invalid response.', false));
        return;
      }
      const { protocolVersion: _protocolVersion, ...result } = response;
      finish(result);
    });

    child.stdin.once('error', () => undefined);
    child.stdin.end(JSON.stringify(input.request));
  });
}

function validateInput(
  absolutePath: string,
  maxOutputChars: number,
  signal?: AbortSignal,
): OfficeParseResult | undefined {
  if (signal?.aborted) return failure('aborted', 'Office parsing was aborted.', false);
  if (!isAbsolute(absolutePath)) return failure('io_error', 'Office parser requires an absolute path.', false);
  if (!officeFormatForPath(absolutePath)) return failure('unsupported_format', 'Unsupported Office document format.', false);
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    return failure('resource_limit', 'maxOutputChars must be a positive integer.', false);
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

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
