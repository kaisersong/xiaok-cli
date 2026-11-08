import { spawn, type ChildProcess } from 'node:child_process';
import { ManagedEnterpriseCliRuntime, type InstalledEnterpriseCli } from '../../src/runtime/enterprise-cli-runtime.js';
import type { EnterpriseCliAction, EnterpriseCliConnection, EnterpriseCliProvider, EnterpriseCliState } from '../shared/enterprise-cli-ipc-contract.js';
import { YzjCliConnectionHistory } from './yzj-cli-connection-history.js';
import { enterpriseCliArgs, findEnterpriseCliAuthorizationUrl, projectEnterpriseCliStatus } from './enterprise-cli-adapters.js';
interface Operation { controller: AbortController; done: Promise<void>; child?: ChildProcess; reason?: 'cancelled' | 'timedOut' | 'failed'; force?: ReturnType<typeof setTimeout> }
interface Dependencies { runtime?: ManagedEnterpriseCliRuntime; spawn?: typeof spawn; openExternal?: (url: string) => Promise<void>; now?: () => number; historyPath?: string }
export class EnterpriseCliConnectorService {
  private readonly runtime: ManagedEnterpriseCliRuntime;
  private readonly history: YzjCliConnectionHistory;
  private installed: InstalledEnterpriseCli | null;
  private state: EnterpriseCliState;
  private operation?: Operation;
  private disposed = false;
  constructor(private readonly provider: EnterpriseCliProvider, private readonly deps: Dependencies = {}) {
    this.runtime = deps.runtime ?? new ManagedEnterpriseCliRuntime(); this.history = new YzjCliConnectionHistory(deps.historyPath);
    this.installed = this.runtime.find(provider);
    this.state = { provider, phase: this.runtime.supported(provider) ? this.installed ? 'ready' : 'notInstalled' : 'unsupported', revision: 0, installed: Boolean(this.installed), ...(this.installed ? { version: this.installed.version } : {}) };
  }
  getState(): EnterpriseCliState { return { ...this.state, ...(this.state.connection ? { connection: { ...this.state.connection } } : {}) }; }
  private set(phase: EnterpriseCliState['phase'], connection?: EnterpriseCliConnection, progress?: number): void {
    this.state = { provider: this.provider, phase, revision: this.state.revision + 1, installed: Boolean(this.installed), ...(this.installed ? { version: this.installed.version } : {}), ...(connection ? { connection } : {}), ...(progress !== undefined ? { progress } : {}) };
  }
  async control(action: EnterpriseCliAction, requestSource?: 'user' | 'agent' | 'scheduler'): Promise<EnterpriseCliState> {
    if (requestSource !== 'user') throw Error('enterprise_cli_source_forbidden');
    if (this.disposed) throw Error('enterprise_cli_disposed');
    if (action === 'cancel') { await this.stop(); return this.getState(); }
    if (!['install','login','setup','check'].includes(action)) throw Error('enterprise_cli_action_invalid');
    if (this.operation) return this.getState();
    if (this.state.phase === 'unsupported') return this.getState();
    if (action !== 'install' && !this.installed) return this.getState();
    if (action === 'setup' && (this.provider !== 'feishu' || this.state.phase !== 'needsSetup')) throw Error('enterprise_cli_setup_not_required');
    const op: Operation = { controller: new AbortController(), done: Promise.resolve() };
    this.operation = op; this.set(action === 'install' ? 'installing' : action === 'check' ? 'checking' : 'opening');
    op.done = Promise.resolve().then(() => this.execute(action, op)).catch((error: unknown) => {
      if (this.operation === op) this.set(op.reason ?? (error instanceof Error && error.name === 'TimeoutError' ? 'timedOut' : 'failed'));
    }).finally(() => { if (op.force) clearTimeout(op.force); if (this.operation === op) this.operation = undefined; });
    return this.getState();
  }
  private async execute(action: Exclude<EnterpriseCliAction, 'cancel'>, op: Operation): Promise<void> {
    if (action === 'install') {
      this.installed = await this.runtime.install(this.provider, op.controller.signal, progress => { if (!op.controller.signal.aborted) this.set('installing', undefined, progress); });
      op.controller.signal.throwIfAborted(); this.runtime.configurePath();
    } else if (action === 'login' || action === 'setup') {
      const result = await this.run(action, op); if (result.code !== 0) throw Error('enterprise_cli_auth_failed');
    }
    op.controller.signal.throwIfAborted(); this.set('checking');
    const result = await this.run('check', op);
    const status = projectEnterpriseCliStatus(this.provider, result.code, result.stdout, result.stderr, new Date((this.deps.now ?? Date.now)()).toISOString());
    if (status.connection?.openId) {
      const scope = status.connection.orgId ?? this.provider;
      if (action === 'login' && status.phase === 'connected') this.history.recordLogin(scope, status.connection.openId, status.connection.checkedAt);
      const at = this.history.get(scope, status.connection.openId); if (at) status.connection.connectedAt = at;
    }
    op.controller.signal.throwIfAborted(); this.set(status.phase, status.connection);
  }
  private run(kind: 'login' | 'setup' | 'check', op: Operation): Promise<{ code: number | null; stdout: string; stderr: string }> {
    op.controller.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let stdout = ''; let stderr = ''; let failed = false; let browserAttempted = false;
      const child = (this.deps.spawn ?? spawn)(this.installed!.binaryPath, enterpriseCliArgs(this.provider, kind), { shell: false, stdio: ['ignore','pipe','pipe'], windowsHide: true });
      op.child = child;
      const abort = () => {
        try { child.kill('SIGTERM'); } catch {}
        if (op.force) clearTimeout(op.force);
        op.force = setTimeout(() => { if (op.child === child) { try { child.kill('SIGKILL'); } catch {} } }, 1000); op.force.unref?.();
      };
      const stopFailed = () => { if (op.child !== child || op.controller.signal.aborted) return; failed = true; void this.stop('failed').catch(() => {}); };
      const collect = (field: 'stdout' | 'stderr', chunk: Buffer) => {
        if (op.controller.signal.aborted || failed || (kind !== 'check' && browserAttempted)) return;
        if (stdout.length + stderr.length + chunk.length > 65536) { stopFailed(); return; }
        if (field === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
        if (kind === 'check') return;
        const url = findEnterpriseCliAuthorizationUrl(this.provider, stdout) ?? findEnterpriseCliAuthorizationUrl(this.provider, stderr); if (!url) return;
        browserAttempted = true; stdout = ''; stderr = '';
        try {
          if (!this.deps.openExternal) { stopFailed(); return; }
          void this.deps.openExternal(url).then(() => { if (op.child === child && !op.controller.signal.aborted && !failed) this.set('waiting'); }, stopFailed);
        } catch { stopFailed(); }
      };
      child.stdout?.on('data', chunk => collect('stdout', chunk)); child.stderr?.on('data', chunk => collect('stderr', chunk));
      child.once('error', () => { failed = true; });
      const timer = setTimeout(() => { void this.stop('timedOut').catch(() => {}); }, kind === 'check' ? 20000 : 300000); timer.unref?.();
      op.controller.signal.addEventListener('abort', abort, { once: true });
      child.once('close', code => {
        clearTimeout(timer); if (op.force) clearTimeout(op.force); op.controller.signal.removeEventListener('abort', abort);
        if (op.child === child) op.child = undefined;
        if (failed || op.controller.signal.aborted) reject(Error('enterprise_cli_operation_failed'));
        else resolve({ code, stdout, stderr });
      });
      if (op.controller.signal.aborted) abort();
    });
  }
  private async stop(reason: NonNullable<Operation['reason']> = 'cancelled'): Promise<void> {
    const op = this.operation; if (!op) return;
    op.reason ??= reason; this.set('cancelling'); op.controller.abort();
    // A retry must still signal an unconfirmed child after the first abort event.
    if (op.child) { try { op.child.kill('SIGTERM'); } catch {} }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([op.done, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('enterprise_cli_stop_pending')), 5000); })]); }
    catch (error) { if (this.operation === op) this.set('stopPending'); throw error; }
    finally { if (timer) clearTimeout(timer); }
  }
  async dispose(): Promise<void> { this.disposed = true; await this.stop(); }
}
