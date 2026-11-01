import { execFile } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';

/** Transport only: a complete CLI enumeration is not yet a normalized calendar
 * snapshot. Main must verify event schema/identity before publishing facts. */
export interface YzjCalendarGrant {
  profile: string;
  epoch: number;
  accountId: string;
  enabled: boolean;
  consent: boolean;
}
interface RunOptions { timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }
interface RunResult { exitCode: number; stdout: string; stderr: string }
export type YzjCalendarCliRun = (binary: string, args: readonly string[], options: RunOptions) => Promise<RunResult>;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** No shell or npm shim: cancellation/timeout belongs to this one native child.
 * Never log stderr; upstream messages can contain personal data or credentials. */
const runNative: YzjCalendarCliRun = (binary, args, options) => new Promise((resolve, reject) => {
  execFile(binary, [...args], {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: options.timeoutMs, maxBuffer: options.maxOutputBytes,
    killSignal: 'SIGKILL', signal: options.signal,
  }, (error, stdout, stderr) => {
    if (options.signal?.aborted) return reject(Error('yzj_calendar_cancelled'));
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(Error('yzj_calendar_output_limit'));
    if (error?.killed) return reject(Error('yzj_calendar_timeout'));
    if (error && typeof error.code !== 'number') return reject(Error('yzj_calendar_unavailable'));
    resolve({ exitCode: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
  });
});

export function createYzjCalendarCliReader(options: {
  nativeBinary: string;
  profile: string;
  /** Main-issued consent, account binding and revision. Never take from IPC. */
  currentGrant(): Readonly<YzjCalendarGrant> | undefined;
  run?: YzjCalendarCliRun;
}) {
  if (!isAbsolute(options.nativeBinary) || !['yzj-cli', 'yzj-cli.exe'].includes(basename(options.nativeBinary))) {
    throw Error('yzj_calendar_native_binary_required');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.profile)) throw Error('yzj_calendar_profile_invalid');
  const binary = options.nativeBinary, profile = options.profile, run = options.run ?? runNative;

  function current(): Readonly<YzjCalendarGrant> {
    const grant = options.currentGrant();
    if (!grant || grant.enabled !== true || grant.consent !== true || grant.profile !== profile
      || !Number.isSafeInteger(grant.epoch) || grant.epoch < 1 || typeof grant.accountId !== 'string'
      || !grant.accountId.trim() || grant.accountId.length > 256) throw Error('yzj_calendar_consent_required');
    return Object.freeze({ ...grant });
  }
  async function read(args: readonly string[], signal?: AbortSignal) {
    if (signal?.aborted) throw Error('yzj_calendar_cancelled');
    const before = current();
    let result: RunResult;
    try {
      result = await run(binary, ['--profile', profile, 'calendar', 'event', ...args], {
        timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, signal,
      });
    } catch (error) {
      if (error instanceof Error && ['yzj_calendar_cancelled','yzj_calendar_output_limit','yzj_calendar_timeout'].includes(error.message)) throw error;
      throw Error('yzj_calendar_unavailable');
    }
    if (signal?.aborted) throw Error('yzj_calendar_cancelled');
    let after: Readonly<YzjCalendarGrant>;
    try { after = current(); } catch { throw Error('yzj_calendar_grant_changed'); }
    if (before.epoch !== after.epoch || before.accountId !== after.accountId) throw Error('yzj_calendar_grant_changed');
    if (result.exitCode !== 0) throw Error(result.exitCode === 3 ? 'yzj_calendar_authentication_required'
      : result.exitCode === 4 ? 'yzj_calendar_network_unavailable' : 'yzj_calendar_provider_failed');
    if (Buffer.byteLength(result.stdout, 'utf8') > MAX_OUTPUT_BYTES) throw Error('yzj_calendar_output_limit');
    let envelope: Record<string, unknown>;
    try { envelope = record(JSON.parse(result.stdout)); } catch { throw Error('yzj_calendar_receipt_invalid'); }
    if (envelope.success !== true || envelope.identity !== 'user') throw Error('yzj_calendar_user_identity_required');
    return { data: record(envelope.data), grantEpoch: before.epoch, accountId: before.accountId };
  }

  return Object.freeze({
    async listEvents(input: { from: number; to: number; signal?: AbortSignal }) {
      const { from, to, signal } = input;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1_000_000_000_000 || to <= from || to - from > 8 * 86400_000
        || !Number.isFinite(new Date(from).getTime()) || !Number.isFinite(new Date(to).getTime())) throw Error('yzj_calendar_window_invalid');
      // Real 0.1.8 rejects fractional ISO Z timestamps. Its documented Unix
      // millisecond form preserves the half-open boundary without local/DST drift.
      const result = await read(['list', '--start', String(from), '--end', String(to - 1)], signal);
      const data = result.data;
      if (!Array.isArray(data.list)) throw Error('yzj_calendar_receipt_invalid');
      if (data.list.length > 200) throw Error('yzj_calendar_event_limit');
      const records = data.list.map(record);
      if (data.count !== undefined && (!Number.isSafeInteger(data.count) || data.count !== records.length)) throw Error('yzj_calendar_receipt_invalid');
      if (data.total !== undefined && (!Number.isSafeInteger(data.total) || (data.total as number) < records.length)) throw Error('yzj_calendar_receipt_invalid');
      if (data.more !== undefined && typeof data.more !== 'boolean') throw Error('yzj_calendar_receipt_invalid');
      if (data.pageToken !== undefined && typeof data.pageToken !== 'string') throw Error('yzj_calendar_receipt_invalid');
      // Help exposes no page-token flag. Preserve partial, never loop the same
      // request or infer a complete business window from a truncated response.
      const partial = data.more === true || !!data.pageToken || typeof data.total === 'number' && data.total > records.length;
      const completeness = partial ? 'partial' as const : data.more === false ? 'complete' as const : 'unknown' as const;
      return { records, completeness, grantEpoch: result.grantEpoch, accountId: result.accountId, window: { from, to } };
    },
    async getEvent(input: { id: string; signal?: AbortSignal }) {
      if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,511}$/.test(input.id)) throw Error('yzj_calendar_event_id_invalid');
      const result = await read(['get', '--id', input.id], input.signal);
      return { record: result.data, grantEpoch: result.grantEpoch, accountId: result.accountId };
    },
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('yzj_calendar_receipt_invalid');
  return value as Record<string, unknown>;
}
