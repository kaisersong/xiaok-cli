import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import { ensureBundledYzjCli } from '../../src/runtime/bundled-yzj-cli.js';
import { YzjCliConnectionHistory } from './yzj-cli-connection-history.js';
import type { YzjCliConnection, YzjCliAuthAction, YzjCliAuthState } from '../shared/yzj-cli-auth-ipc-contract.js';

const expiresAtSchema = z.string().max(64).datetime({ offset: true });

type Phase = YzjCliAuthState['phase'];
type JobKind = 'login' | 'check' | 'verify';
interface Job {
  child: ChildProcess; kind: JobKind; closed: Promise<void>; resolveClosed(): void;
  reason?: 'cancelled' | 'timedOut' | 'failed' | 'verificationFailed'; timer?: ReturnType<typeof setTimeout>; force?: ReturnType<typeof setTimeout>;
  stdout: string; stderr: string; overflow: boolean; error: boolean;
  browserAttempted?: boolean;
}
interface Dependencies { spawn?: typeof spawn; resolveBinary?: () => string; openExternal?: (url: string) => Promise<void>; now?: () => number; connectionHistoryPath?: string }

/** Main owns execution and timeouts. Credentials remain exclusively CLI-owned. */
export class YzjCliAuthService {
  private state: YzjCliAuthState = { phase: 'idle', revision: 0 };
  private job: Job | null = null;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly history: YzjCliConnectionHistory;
  constructor(private readonly deps: Dependencies = {}) { this.history = new YzjCliConnectionHistory(deps.connectionHistoryPath); }
  getState(): YzjCliAuthState { return { ...this.state, ...(this.state.connection ? { connection: { ...this.state.connection } } : {}) }; }
  private set(phase: Phase, connection?: YzjCliConnection): void {
    this.state = { phase, revision: this.state.revision + 1, ...(connection ? { connection } : {}) };
  }

  control(action: YzjCliAuthAction, requestSource?: 'user' | 'agent' | 'scheduler'): Promise<YzjCliAuthState> {
    if (requestSource !== 'user') return Promise.reject(Error('yzj_cli_auth_source_forbidden'));
    const result = this.queue.then(async () => {
      if (this.disposed) throw Error('yzj_cli_auth_disposed');
      if (action === 'cancel') { await this.stop('cancelled'); return this.getState(); }
      if (action === 'check') { if (!this.job) this.start('check'); return this.getState(); }
      if (action !== 'login') throw Error('yzj_cli_auth_action_invalid');
      if (this.job?.reason) throw Error('yzj_cli_auth_stop_pending');
      if (this.job?.kind === 'login') return this.getState();
      if (this.job) await this.stop('cancelled');
      if (this.disposed) throw Error('yzj_cli_auth_disposed');
      this.start('login');
      return this.getState();
    });
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  private start(kind: JobKind): void {
    if (this.disposed || this.job) return;
    let binary: string;
    try { binary = (this.deps.resolveBinary ?? (() => ensureBundledYzjCli().binaryPath))(); }
    catch { this.set('unavailable'); return; }
    let child: ChildProcess;
    try {
      // Main is the sole browser opener. Default CLI login also opens a browser
      // through native OS APIs; --device prevents duplicate authorization tabs.
      child = (this.deps.spawn ?? spawn)(binary, kind === 'login' ? ['auth', 'login', '--device'] : ['whoami'], {
        shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch { this.set('failed'); return; }
    let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const job: Job = { child, kind, closed, resolveClosed, stdout: '', stderr: '', overflow: false, error: false };
    this.job = job;
    this.set(kind === 'login' ? 'opening' : 'checking');
    const collect = (field: 'stdout' | 'stderr', data: Buffer) => {
      if (this.job !== job || job.reason || (kind === 'login' && job.browserAttempted)) return;
      if (job[field].length + data.length > 64 * 1024) {
        job.overflow = true;
        if (kind === 'login') void this.stop('failed').catch(() => {});
        return;
      }
      job[field] += data.toString('utf8');
      if (kind === 'login') this.openBrowserFromCli(job);
    };
    // Login output remains Main-private and bounded; never log it or return it over IPC.
    child.stdout?.on('data', data => collect('stdout', data));
    child.stderr?.on('data', data => collect('stderr', data));
    child.once('error', () => { job.error = true; });
    child.once('close', code => {
      if (job.timer) clearTimeout(job.timer);
      if (job.force) clearTimeout(job.force);
      if (this.job === job) {
        this.job = null;
        if (job.reason) this.set(job.reason);
        else if (!this.disposed) {
          if (kind === 'login') { if (code === 0 && !job.error) this.start('verify'); else this.set('failed'); }
          else { const result = this.identityResult(job, code); this.set(result.phase, result.connection); }
        }
      }
      // Close, not kill()'s return value, releases exclusive child ownership.
      job.resolveClosed();
    });
    job.timer = setTimeout(() => { void this.stop(kind === 'verify' ? 'verificationFailed' : 'timedOut').catch(() => {}); }, kind === 'login' ? 300000 : 15000);
    job.timer.unref?.();
  }

  private openBrowserFromCli(job: Job): void {
    if (job.browserAttempted || job.reason || this.job !== job || this.disposed) return;
    // Require a real delimiter: a partial stream chunk must never open a truncated code.
    for (const text of [job.stdout, job.stderr]) for (const match of text.matchAll(/https:\/\/[^\s<>"'\u001b]+(?=[\s<>"'\u001b])/g)) {
      let url: URL;
      try { url = new URL(match[0]); } catch { continue; }
      if (url.origin !== 'https://www.yunzhijia.com' || url.username || url.password || url.hash
        || url.pathname !== '/developers/cli/device-auth.html'
        || [...url.searchParams.keys()].some(key => key !== 'code') || url.searchParams.getAll('code').length !== 1
        || !/^[A-Z0-9]{6,64}$/.test(url.searchParams.get('code') ?? '')) continue;
      job.browserAttempted = true; job.stdout = ''; job.stderr = '';
      const failed = () => { if (this.job === job && !job.reason && !this.disposed) void this.stop('failed').catch(() => {}); };
      try {
        if (!this.deps.openExternal) { failed(); return; }
        void this.deps.openExternal(url.href).then(() => {
          if (this.job === job && !job.reason && !this.disposed) this.set('waiting');
        }, failed);
      } catch { failed(); }
      return;
    }
  }

  private identityResult(job: Job, code: number | null): { phase: Phase; connection?: YzjCliConnection } {
    const failure: Phase = job.kind === 'verify' ? 'verificationFailed' : 'failed';
    if (job.error || job.overflow) return { phase: failure };
    let output: { success?: unknown; data?: unknown } | undefined;
    let errorCode: unknown;
    try { output = JSON.parse(job.stdout); } catch { /* Not a successful envelope. */ }
    try { errorCode = JSON.parse(job.stderr)?.error?.code; } catch { /* Unknown failures stay failed. */ }
    if (code === 0 && output?.success === true) return { phase: 'authenticated', connection: this.projectConnection(output.data, job.kind === 'verify') };
    // Official references/global.md documents exit 3 and these expired-auth codes.
    if (code === 3 || errorCode === 10000400 || errorCode === '10000400' || errorCode === 93001 || errorCode === '93001') return { phase: 'signedOut' };
    return { phase: failure };
  }

  private projectConnection(value: unknown, verifiedLogin: boolean): YzjCliConnection {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const connection: YzjCliConnection = { checkedAt: new Date((this.deps.now ?? Date.now)()).toISOString() };
    for (const [key, limit] of [['name', 200], ['department', 300], ['openId', 256], ['orgId', 256]] as const) {
      const text = data[key];
      if (typeof text === 'string' && text.trim() && text.length <= limit && !/[\u0000-\u001f\u007f]/.test(text)) connection[key] = text.trim();
    }
    const expiresAt = expiresAtSchema.safeParse(data.expiresAt);
    if (expiresAt.success && Number.isFinite(Date.parse(expiresAt.data))) connection.expiresAt = new Date(expiresAt.data).toISOString();
    if (data.tokenStatus === 'valid' || data.tokenStatus === 'needs_refresh' || data.tokenStatus === 'expired') connection.tokenStatus = data.tokenStatus;
    if (connection.orgId && connection.openId) {
      if (verifiedLogin) this.history.recordLogin(connection.orgId, connection.openId, connection.checkedAt);
      const connectedAt = this.history.get(connection.orgId, connection.openId);
      if (connectedAt) connection.connectedAt = connectedAt;
    }
    return connection;
  }

  private async stop(reason: NonNullable<Job['reason']>): Promise<void> {
    const job = this.job;
    if (!job) return;
    job.reason ??= reason;
    this.set('cancelling');
    try { job.child.kill('SIGTERM'); } catch { /* Escalation still targets this same child. */ }
    if (job.force) clearTimeout(job.force);
    job.force = setTimeout(() => { if (this.job === job) { try { job.child.kill('SIGKILL'); } catch {} } }, 1000);
    job.force.unref?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([job.closed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('yzj_cli_auth_stop_pending')), 5000);
      })]);
    } catch (error) { if (this.job === job) this.set('stopPending'); throw error; }
    finally { if (timer) clearTimeout(timer); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop('cancelled');
    await this.queue;
  }
}
