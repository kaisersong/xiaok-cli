import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export function resolveLaunch(entry: string, args: string[] = [], platform: string = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(entry)) throw new Error('Use a real JS/executable entry, not a Windows shim');
  return /\.[cm]?js$/i.test(entry) ? { command: process.execPath, args: [entry, ...args] } : { command: entry, args };
}

export interface NativeEvent { method: string; params: any; seq?: number }
export interface NativeOptions {
  executable: string; prefixArgs?: string[]; cwd: string; timeoutMs?: number;
  sandbox?: 'read-only' | 'workspace-write';
  onEvent?: (event: NativeEvent) => void;
  onApproval?: (request: any) => Promise<any>;
  onFailure?: (error: Error) => void;
}
// Internal transport. Approval policy belongs to the main-process service.
export class SessionProbe {
  threadId: string | null = null; activeTurnId: string | null = null; exited = false; events: NativeEvent[] = []; cursor = 0;
  options: NativeOptions & { timeoutMs: number };
  #child?: ChildProcessWithoutNullStreams; #pending = new Map<number, any>(); #waiters = new Set<any>(); #next = 0; #failure?: Error; #closing?: Promise<void>; #exitPromise?: Promise<void>; #starting = false; #binding = false;
  constructor(options: NativeOptions) { this.options = { timeoutMs: 30000, ...options }; }
  get pid() { return this.#child?.pid; }
  #assert() { if (this.#failure) throw this.#failure; if (!this.#child) throw new Error('connection closed'); }
  #fail(error: Error) {
    if (this.#failure) return;
    this.#failure = error;
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.#pending.clear();
    this.options.onFailure?.(error);
    for (const w of [...this.#waiters]) w.finish(error);
  }
  #send(message: any) { this.#assert(); this.#child!.stdin.write(JSON.stringify(message) + '\n'); }
  #request(method: string, params: any): Promise<any> {
    this.#assert(); const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(new Error(`RPC timeout: ${method}`)); void this.close().catch(() => {});
      }, this.options.timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#send({ id, method, params }); } catch (e) { this.#fail(e as Error); }
    });
  }
  #event(message: NativeEvent) {
    const event = { ...message, seq: ++this.cursor }; this.events.push(event);
    if (this.events.length > 1024) this.events.shift();
    if (event.params?.threadId === this.threadId) {
      if (event.method === 'turn/started') this.activeTurnId = event.params.turn.id;
      if (event.method === 'turn/completed' && event.params.turn.id === this.activeTurnId) this.activeTurnId = null;
    }
    this.options.onEvent?.(event);
    for (const w of [...this.#waiters]) if (event.seq! > w.after && event.method === w.method && w.predicate(event)) w.finish(null, event);
  }
  #receive(message: any) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('invalid protocol message');
    if (message.method && message.id !== undefined) {
      const method = message.method;
      const result = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method) ? { decision: 'decline' }
        : method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' }
        : method === 'mcpServer/elicitation/request' ? { action: 'decline', content: null } : null;
      void (async () => {
        let decision = result;
        try { if (this.options.onApproval) decision = await this.options.onApproval(message); } catch { /* default deny */ }
        if (this.#failure) return;
        this.#send(decision ? { id: message.id, result: decision } : { id: message.id, error: { code: -32601, message: 'Unsupported server request' } });
        this.#event({ method: 'probe/approval', params: { method, threadId: message.params?.threadId, turnId: message.params?.turnId, decision: decision?.decision === 'accept' ? 'accept' : result ? 'decline' : 'unsupported' } });
      })().catch(error => this.#fail(error));
    } else if (message.method) this.#event(message);
    else {
      const pending = this.#pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`RPC error ${message.error.code}: ${message.error.message}`)); else pending.resolve(message.result);
    }
  }
  async connect() {
    if (this.#child || this.#failure) throw new Error('connection already used');
    const launch = resolveLaunch(this.options.executable, this.options.prefixArgs);
    this.#child = spawn(launch.command, launch.args, { cwd: this.options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    this.#exitPromise = new Promise(resolve => this.#child!.once('close', () => { this.exited = true; this.#fail(new Error('connection closed: process exited')); resolve(); }));
    this.#child.on('error', error => this.#fail(error));
    this.#child.stdin.on('error', error => this.#fail(error));
    this.#child.stderr.resume();
    let buffer = Buffer.alloc(0);
    this.#child.stdout.on('data', chunk => {
      if (this.#failure) return;
      try {
        buffer = Buffer.concat([buffer, chunk]);
        let end;
        while ((end = buffer.indexOf(10)) !== -1) {
          if (end > 1024 * 1024) throw new Error('protocol frame exceeds limit');
          const line = buffer.subarray(0, end).toString('utf8'); buffer = buffer.subarray(end + 1);
          if (line.trim()) this.#receive(JSON.parse(line));
        }
        if (buffer.length > 1024 * 1024) throw new Error('protocol frame exceeds limit');
      } catch { this.#fail(new Error('invalid or oversized protocol frame')); void this.close().catch(() => {}); }
    });
    const initialized = await this.#request('initialize', { clientInfo: { name: 'xiaok_native_validation', version: '1' }, capabilities: { experimentalApi: true } });
    this.#send({ method: 'initialized' }); return initialized;
  }
  async #bind(method: string, extra: Record<string, unknown> = {}) {
    this.#assert(); if (this.threadId || this.#binding) throw new Error('thread already bound or binding');
    this.#binding = true;
    try {
      const r = await this.#request(method, { cwd: this.options.cwd, sandbox: this.options.sandbox ?? 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', ...extra });
      this.threadId = r.thread.id; return r;
    } finally { this.#binding = false; }
  }
  create() { return this.#bind('thread/start', { ephemeral: false }); }
  resume(threadId: string) { return this.#bind('thread/resume', { threadId }); }
  async start(text: string) {
    this.#assert(); if (!this.threadId) throw new Error('no bound thread');
    if (this.#starting || this.activeTurnId) throw new Error('active turn already exists');
    this.#starting = true; const after = this.cursor;
    try {
      const r = await this.#request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text, text_elements: [] }] });
      if (!this.events.some(e => e.seq! > after && e.method === 'turn/completed' && e.params.threadId === this.threadId && e.params.turn.id === r.turn.id)) this.activeTurnId = r.turn.id;
      return { turnId: r.turn.id };
    } finally { this.#starting = false; }
  }
  async steer(text: string) {
    this.#assert(); if (!this.activeTurnId) throw new Error('no active turn');
    return this.#request('turn/steer', { threadId: this.threadId, expectedTurnId: this.activeTurnId, input: [{ type: 'text', text, text_elements: [] }] });
  }
  async interrupt() {
    this.#assert(); if (!this.activeTurnId) throw new Error('no active turn');
    const turnId = this.activeTurnId, after = this.cursor;
    const terminal = (e: NativeEvent) => e.params.threadId === this.threadId && e.params.turn.id === turnId;
    const deadline = Date.now() + 3000;
    for (;;) {
      const completed = this.events.find(e => e.seq! > after && e.method === 'turn/completed' && terminal(e));
      if (completed) return completed;
      try { await this.#request('turn/interrupt', { threadId: this.threadId, turnId }); break; }
      catch (error) {
        // A rejected interrupt had no effect. Retry only this explicit startup
        // precondition, never timeouts, transport errors or arbitrary mutations.
        if ((error as Error).message !== 'RPC error -32600: no active turn to interrupt' || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return this.waitFor('turn/completed', terminal, { after });
  }
  async waitFor(method: string, predicate: (event: NativeEvent) => boolean = () => true, { timeoutMs = this.options.timeoutMs, after = 0 } = {}): Promise<NativeEvent> {
    this.#assert();
    const found = this.events.find(e => e.seq! > after && e.method === method && predicate(e)); if (found) return found;
    return new Promise((resolve, reject) => {
      const w = { method, predicate, after, finish: (error: Error | null, result?: NativeEvent) => { clearTimeout(timer); this.#waiters.delete(w); error ? reject(error) : resolve(result!); } };
      const timer = setTimeout(() => w.finish(new Error(`event timeout: ${method}`)), timeoutMs); this.#waiters.add(w);
    });
  }
  async close() {
    if (this.#closing) return this.#closing;
    this.#fail(new Error('connection closed'));
    this.#closing = (async () => {
      if (!this.#child) return;
      if (!this.pid) { await this.#exitPromise; return; }
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32') process.kill(-this.pid!, signal);
          else spawn('taskkill', ['/pid', String(this.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      };
      kill('SIGTERM');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => { try { kill('SIGKILL'); } catch {} }, 1000);
      try {
        await Promise.race([this.#exitPromise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('process cleanup timeout; exit not confirmed')), 5000); })]);
      } finally { clearTimeout(timer); clearTimeout(deadline); }
      // The wrapper may exit before descendants; target only this probe's group.
      if (process.platform !== 'win32') kill('SIGKILL');
    })();
    return this.#closing;
  }
}
