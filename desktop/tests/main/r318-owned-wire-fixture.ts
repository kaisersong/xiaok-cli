import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod/v4';
import { createKSwarmRuntimeBridgeBrokerClient, type KSwarmRuntimeBridge } from '../../electron/kswarm-runtime-bridge.js';

const CandidateSHA = 'd8e1836b04c32d9189b62c7f221b912ae38fc5d515c9462554362ad084d18a1b';
const Stats = z.object({ requests: z.number(), registrations: z.number(), intents: z.number(), wsOpened: z.number(), wsClosed: z.number(), wireSent: z.number(), activeResponses: z.number(), activeWebSockets: z.number(), heldUpgrades: z.number(), rawSockets: z.number(), protocolIdle: z.number(), pausedReads: z.number() });
const Ready = z.object({ type: z.literal('ready'), pid: z.number().int().positive(), nonce: z.string(), port: z.number().int().positive() });
const Reply = z.object({ type: z.literal('reply'), nonce: z.string(), id: z.string(), data: z.unknown().optional(), error: z.string().optional() });
type ProbeInput = Parameters<NonNullable<KSwarmRuntimeBridge['handleReadinessProbe']>>[0];
type ProbeResult = Awaited<ReturnType<NonNullable<KSwarmRuntimeBridge['handleReadinessProbe']>>>;
export function dataReady(): ProbeResult { return { ok: true, capabilities: [], outputCapabilities: [] }; }
export function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void Promise.allSettled([promise]); return { promise, resolve, reject }; }
export async function resultOf(raw: Promise<unknown>) { const [result] = await Promise.allSettled([raw]); return result; }
export type WireMode = { holdRegistrationBody?: boolean; holdIntentHeaders?: boolean; holdIntentBody?: boolean; holdUpgrade?: boolean; failRegistration?: boolean };

export async function wireFixture(mode: WireMode = {}) {
  // NOT_READY is source availability/binding, never an observed business RED.
  const source = readFileSync(new URL('../../electron/kswarm-runtime-bridge.ts', import.meta.url));
  if (createHash('sha256').update(source).digest('hex') !== CandidateSHA) throw Error('R318_NOT_READY_CANDIDATE_SOURCE_BINDING');
  const NativeWebSocket = globalThis.WebSocket;
  if (typeof NativeWebSocket !== 'function' || process.versions.electron) throw Error('R318_NOT_AVAILABLE_ORDINARY_NODE_WEBSOCKET');
  const root = mkdtempSync(join(tmpdir(), 'r318-real-wire-')), nonce = randomUUID();
  writeFileSync(join(root, 'fixture-owner.json'), JSON.stringify({ root, nonce, sourceSHA256: CandidateSHA, stage: 'constructing' }), { mode: 0o600 });
  console.log('R318_OWNED_WIRE_ROOT', root);
  const releases: Array<() => void> = [], pending: Promise<unknown>[] = [], expectedStopErrors = new Set<unknown>();
  const hooks: { construct?: () => void; probe?: (input: ProbeInput) => Promise<ProbeResult> } = {};
  const counts = { fetch: 0, probes: 0, forbidden: 0, close: 0 }, fetchFailures: unknown[] = [];
  const closeReceivers: object[] = [], closeArguments: unknown[][] = [];
  type SocketRecord = { native: WebSocket; closed: Promise<void>; closedSeen: boolean; owner: WireSocket };
  const sockets: SocketRecord[] = [];
  // The production constructor option has a structural zero-argument callback
  // shape. This typed adapter forwards ONLY actual native events and close(),
  // never fabricates a WebSocket/SDK state/event/brand. Same existing port.
  class WireSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private readonly native: WebSocket;
    constructor(url: string) {
      this.native = new NativeWebSocket(url);
      let seenClose!: () => void;
      const closed = new Promise<void>(resolve => { seenClose = resolve; });
      const record: SocketRecord = { native: this.native, closed, closedSeen: false, owner: this };
      sockets.push(record);
      this.native.addEventListener('open', () => { this.onopen?.(); });
      this.native.addEventListener('message', event => { this.onmessage?.({ data: event.data }); });
      this.native.addEventListener('error', () => { this.onerror?.(); });
      this.native.addEventListener('close', () => { record.closedSeen = true; seenClose(); this.onclose?.(); });
      hooks.construct?.();
    }
    close(): void { counts.close++; closeReceivers.push(this); closeArguments.push(Array.from(arguments)); this.native.close(); }
  }
  let child: ChildProcess | undefined, childClosed: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let client: ReturnType<typeof createKSwarmRuntimeBridgeBrokerClient> | undefined, cleanupRaw: Promise<void> | undefined, keepEvidence = false;
  const calls = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const ready = deferred<z.infer<typeof Ready>>();
  async function rpc(command: string, data?: unknown): Promise<unknown> {
    const target = child; if (!target?.connected) throw Error('own_wire_ipc_disconnected');
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { calls.delete(id); reject(Error('own_wire_observation_deadline')); }, 10000);
      calls.set(id, { resolve, reject, timer });
      target.send({ nonce, id, command, data }, error => { if (!error) return; const call = calls.get(id); if (call) { clearTimeout(call.timer); calls.delete(id); call.reject(error); } });
    });
  }
  async function attempt(steps: Array<() => unknown | Promise<unknown>>) { return (await Promise.allSettled(steps.map(step => { try { return Promise.resolve(step()); } catch (error) { return Promise.reject(error); } }))).flatMap(value => value.status === 'rejected' ? [value.reason] : []); }
  function cleanup(): Promise<void> {
    return cleanupRaw ??= (async () => {
      const failures: unknown[] = [];
      for (const release of releases) { try { release(); } catch (error) { failures.push(error); } }
      if (child?.connected) failures.push(...await attempt([() => rpc('releaseAll')]));
      await Promise.allSettled(pending);
      failures.push(...(await attempt([() => client?.stop()])).filter(error => !expectedStopErrors.has(error)));
      // Every sibling cleanup gets an attempt; no first-failure skip or kill.
      if (child?.connected) failures.push(...await attempt([() => rpc('wait', { key: 'protocolIdle', minimum: 1 })]));
      if (child?.connected) failures.push(...await attempt([() => rpc('shutdown')]));
      if (childClosed) {
        const result = await resultOf(childClosed);
        if (result.status !== 'fulfilled') failures.push(result.reason);
        else if (!z.object({ code: z.literal(0), signal: z.null() }).safeParse(result.value).success) failures.push(Error('own_wire_child_not_natural_exit0'));
      }
      for (const record of sockets) if (!record.closedSeen) failures.push(Error('actual_native_WebSocket_close_unconfirmed'));
      if (!child?.pid || !client) failures.push(Error('own_wire_setup_or_pid_missing'));
      else {
        try {
          const exited = z.object({ pid: z.number(), nonce: z.string(), code: z.literal(0) }).parse(JSON.parse(readFileSync(join(root, 'exited.json'), 'utf8')));
          const closed = z.object({ pid: z.number(), nonce: z.string(), stats: Stats }).parse(JSON.parse(readFileSync(join(root, 'wire-closed.json'), 'utf8')));
          if (exited.pid !== child.pid || closed.pid !== child.pid || exited.nonce !== nonce || closed.nonce !== nonce) throw Error('own_wire_receipt_identity_mismatch');
          if (closed.stats.rawSockets || closed.stats.activeResponses || closed.stats.activeWebSockets || closed.stats.heldUpgrades) throw Error('own_wire_server_resources_unclosed');
          let absent: unknown; try { process.kill(child.pid, 0); } catch (error) { absent = error; }
          if (!absent || typeof absent !== 'object' || !('code' in absent) || absent.code !== 'ESRCH') throw Error('own_wire_child_not_gone');
          if (process.platform !== 'win32') {
            let group: unknown; try { process.kill(-child.pid, 0); } catch (error) { group = error; }
            if (!group || typeof group !== 'object' || !('code' in group) || group.code !== 'ESRCH') throw Error('own_wire_group_not_gone');
          }
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, `own_wire_cleanup_unconfirmed_root_retained:${root}`);
      if (keepEvidence || expectedStopErrors.size) writeFileSync(join(root, 'retained-evidence.json'), JSON.stringify({ expectedStopError: expectedStopErrors.size > 0, rootReleaseClaimed: false }), { mode: 0o600 });
      else rmSync(root, { recursive: true });
    })();
  }
  try {
    child = spawn(process.execPath, [resolve('tests/support/r318-owned-wire-server.mjs')], { cwd: process.cwd(), env: { ...process.env, R318_ROOT: root, R318_NONCE: nonce }, detached: process.platform !== 'win32', stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
    writeFileSync(join(root, 'fixture-owner.json'), JSON.stringify({ root, nonce, pid: child.pid, sourceSHA256: CandidateSHA, stage: 'spawned' }), { mode: 0o600 });
    childClosed = new Promise((resolve, reject) => { child!.once('error', reject); child!.once('close', (code, signal) => resolve({ code, signal })); }); void Promise.allSettled([childClosed]);
    child.on('message', raw => {
      const initial = Ready.safeParse(raw); if (initial.success && initial.data.nonce === nonce) { ready.resolve(initial.data); return; }
      const value = Reply.safeParse(raw); if (!value.success || value.data.nonce !== nonce) return;
      const call = calls.get(value.data.id); if (!call) return; calls.delete(value.data.id); clearTimeout(call.timer);
      if (value.data.error) call.reject(Error(value.data.error)); else call.resolve(value.data.data);
    });
    child.once('error', error => ready.reject(error));
    const timer = setTimeout(() => ready.reject(Error('own_wire_start_observation_deadline')), 10000);
    let actual: z.infer<typeof Ready>; try { actual = await ready.promise; } finally { clearTimeout(timer); }
    if (actual.pid !== child.pid) throw Error('own_wire_pid_mismatch'); await rpc('configure', mode);
    const bridge: KSwarmRuntimeBridge = {
      async handleTaskHandoff() { counts.forbidden++; throw Error('out_of_scope_task_action'); },
      cancelTask() { counts.forbidden++; throw Error('out_of_scope_cancel_action'); },
      async handleWorkflowNodeHandoff() { counts.forbidden++; throw Error('out_of_scope_workflow_action'); },
      async handleAssignPo() { counts.forbidden++; throw Error('out_of_scope_assign_action'); },
      async handleReviewSubmission() { counts.forbidden++; throw Error('out_of_scope_review_action'); },
      async handlePlanApproved() { counts.forbidden++; throw Error('out_of_scope_approval_action'); },
      async handleReadinessProbe(input) { counts.probes++; return hooks.probe ? await hooks.probe(input) : dataReady(); },
    };
    const actualClient = client = createKSwarmRuntimeBridgeBrokerClient({ brokerUrl: `http://127.0.0.1:${actual.port}`, participantId: 'r318-owned-logical-wire', participantKind: 'service', roles: [], capabilities: [], bridge, WebSocketImpl: WireSocket,
      fetchImpl(url, init) { counts.fetch++; const raw = fetch(url, init); void (async () => { try { await raw; } catch (error) { fetchFailures.push(error); } })(); return raw; } });
    function own<T>(raw: Promise<T>): Promise<T> { pending.push(raw); void Promise.allSettled([raw]); return raw; }
    return { root, nonce, client: actualClient, hooks, counts, sockets, fetchFailures, closeReceivers, closeArguments,
      start() { return own(actualClient.start()); }, stop() { return own(actualClient.stop()); },
      async stats() { return Stats.parse(await rpc('stats')); }, async wait(key: keyof z.infer<typeof Stats>, minimum: number) { return Stats.parse(await rpc('wait', { key, minimum })); },
      async configure(value: WireMode) { return Stats.parse(await rpc('configure', value)); },
      async wire() { return z.string().parse(await rpc('eventData')); }, async send() { return Stats.parse(await rpc('send')); },
      async pauseReads() { return Stats.parse(await rpc('pauseReads')); }, async resumeReads() { return Stats.parse(await rpc('resumeReads')); },
      async releaseHttp(path?: string) { return Stats.parse(await rpc('releaseHttp', { path })); }, async dropHttp(path?: string) { return Stats.parse(await rpc('dropHttp', { path })); },
      own, release(action: () => void) { releases.push(action); }, allowStopError(error: unknown) { expectedStopErrors.add(error); }, retain() { keepEvidence = true; }, cleanup };
  } catch (error) { try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'own_wire_setup_and_cleanup'); } throw error; }
}
export async function withWire(body: (fixture: Awaited<ReturnType<typeof wireFixture>>) => Promise<void>, mode: WireMode = {}) {
  const f = await wireFixture(mode); let failed = false, primary: unknown;
  try { await body(f); } catch (error) { failed = true; primary = error; f.retain(); throw error; }
  finally { try { await f.cleanup(); } catch (error) { throw new AggregateError([...(failed ? [primary] : []), error], 'own_wire_body_and_cleanup'); } }
}
