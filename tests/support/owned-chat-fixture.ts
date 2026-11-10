import type { Command } from 'commander';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname, basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as nativeSetTimeout, clearTimeout as nativeClearTimeout } from 'node:timers';
import type { TtyHarness } from './tty.js';

type OwnedChild = { child: ChildProcess; closed: boolean; completion: Promise<void> };
export type OwnedChatScope = {
  harness: TtyHarness; configRoot: string; controller: AbortController;
  pending: Promise<Command>; pendingSettled: boolean; pendingRejected: boolean; pendingError?: unknown;
  primaryError?: unknown; primaryErrorPresent: boolean; children: OwnedChild[]; ownerStarts: Promise<unknown>[]; ownerReadyCount: number;
  closed: boolean; poisoned: boolean; closePromise?: Promise<void>;
  readGate?: () => Promise<void>; readGateUsed: boolean;
};
function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function canonical(path: string): string {
  const value=resolve(path);try{return realpathSync(value);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||dirname(value)===value)throw error;return join(canonical(dirname(value)),basename(value));}
}
async function bounded<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  let timer: ReturnType<typeof nativeSetTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = nativeSetTimeout(() => reject(new Error(`fixture_close_timeout:${label}`)), Math.max(0, deadline - performance.now()));
    })]);
  } finally { if (timer) nativeClearTimeout(timer); }
}

/** Test-only ownership. Uses real parse/read/spawn operations and never hides exits. */
export class OwnedChatFixtures {
  private scopes = new Map<TtyHarness, OwnedChatScope>();
  private context = new AsyncLocalStorage<OwnedChatScope>();
  private nextReadGate?: () => Promise<void>;
  constructor(private roots: () => readonly string[], private options: {cleanupTimeoutMs?: number} = {}) {}
  beforeCase(): void {
    this.assertCanRestoreAndDelete();
    this.scopes.clear(); this.nextReadGate = undefined;
  }
  setNextReadGate(gate: () => Promise<void>): void { this.nextReadGate = gate; }
  start(program: Command, argv: string[], harness: TtyHarness): Promise<Command> {
    if ([...this.scopes.values()].some(scope => !scope.closed || scope.poisoned)) throw new Error('fixture_previous_chat_not_closed');
    const configured = process.env.XIAOK_CONFIG_DIR;
    if (!configured) throw new Error('fixture_config_root_required');
    const configRoot = canonical(configured);
    if (!this.roots().some(root => inside(canonical(root), configRoot))) throw new Error('fixture_config_root_not_owned');
    const scope: OwnedChatScope = {harness, configRoot, controller:new AbortController(), pending:undefined as unknown as Promise<Command>, pendingSettled:false,pendingRejected:false,primaryErrorPresent:false,
      children:[],ownerStarts:[],ownerReadyCount:0,closed:false,poisoned:false,readGate:this.nextReadGate,readGateUsed:false};
    this.nextReadGate=undefined;this.scopes.set(harness,scope);
    try {scope.pending=this.context.run(scope,()=>program.parseAsync(argv));}catch(error){scope.pendingSettled=true;scope.pendingRejected=true;scope.pendingError=error;throw error;}
    void scope.pending.then(()=>{scope.pendingSettled=true;},error=>{scope.pendingSettled=true;scope.pendingRejected=true;scope.pendingError=error;});
    return scope.pending;
  }
  readerScope(): OwnedChatScope | undefined { return this.context.getStore(); }
  scopeFor(harness: TtyHarness): OwnedChatScope { const scope=this.scopes.get(harness);if(!scope)throw new Error('fixture_scope_missing');return scope; }
  readOptions<T extends {signal?: AbortSignal}>(scope: OwnedChatScope | undefined, options: T | undefined): T | (T & {signal:AbortSignal}) | undefined {
    if(!scope)return options;
    return {...options,signal:options?.signal?AbortSignal.any([options.signal,scope.controller.signal]):scope.controller.signal} as T & {signal:AbortSignal};
  }
  readWithGate<T>(scope: OwnedChatScope | undefined, prompt: string, read: () => Promise<T>): Promise<T> {
    if(scope?.readGate && !scope.readGateUsed && prompt==='> '){scope.readGateUsed=true;return scope.readGate().then(read);}
    return read();
  }
  ownerScope(dataRoot: string): OwnedChatScope {
    const scope=this.context.getStore();
    if(!scope || scope.closePromise || scope.closed || scope.poisoned || !inside(scope.configRoot,canonical(dataRoot))) throw new Error('fixture_owner_root_not_owned');
    return scope;
  }
  validateSpawn(scope: OwnedChatScope, argv: readonly string[], expected: {entryPath: string; configFile: string}): void {
    if(scope.closePromise||scope.closed||scope.poisoned){scope.poisoned=true;throw new Error('fixture_late_owner_spawn');}
    if(argv.length!==2||typeof argv[0]!=='string'||canonical(argv[0])!==canonical(expected.entryPath)
      ||typeof argv[1]!=='string'||canonical(argv[1])!==canonical(expected.configFile)||!inside(scope.configRoot,canonical(argv[1])))throw new Error('fixture_owner_spawn_identity_mismatch');
  }
  recordChild(scope: OwnedChatScope, child: ChildProcess): void {
    let finish!:()=>void;
    const item:OwnedChild={child,closed:false,completion:new Promise(resolve=>{finish=resolve;})};
    child.once('close',()=>{item.closed=true;finish();});
    // spawn errors still flow to the real launcher's listener; close is the resource boundary.
    scope.children.push(item);
  }
  observeReady(scope: OwnedChatScope, promise: Promise<unknown>): void { scope.ownerStarts.push(promise);void promise.then(()=>{scope.ownerReadyCount++;},()=>{}); }
  noteFailure(harness: TtyHarness, error: unknown): void { const scope=this.scopes.get(harness);if(scope){scope.primaryErrorPresent=true;scope.primaryError=error;} }
  close(harness: TtyHarness): Promise<void> {
    const scope=this.scopes.get(harness);if(!scope)return Promise.resolve();
    if(scope.closePromise)return scope.closePromise;
    let resolve!:()=>void, reject!:(error:unknown)=>void;
    const closing=new Promise<void>((done,fail)=>{resolve=done;reject=fail;});
    scope.closePromise=closing;
    const deadline=performance.now()+(this.options.cleanupTimeoutMs??10_000);
    const errors:unknown[]=[];
    const attempt=async(operation:()=>unknown)=>{try{await operation();}catch(error){errors.push(error);}};
    void (async()=>{
      await attempt(()=>scope.controller.abort());
      if(scope.pending)await attempt(()=>bounded(scope.pending.then(()=>{},()=>{}),deadline,'chat'));
      // Hold every observed start before negative child cleanup; a failure cannot skip siblings.
      for(let index=0;index<scope.ownerStarts.length;index++)await attempt(()=>bounded(scope.ownerStarts[index].then(()=>{},()=>{}),deadline,'owner-start'));
      for(let index=0;index<scope.children.length;index++)await attempt(async()=>{
        const child=scope.children[index];
        if(!child.closed){child.child.kill('SIGTERM');await bounded(child.completion,deadline,'activity-owner');}
      });
      if(errors.length){
        scope.poisoned=true;
        const all=[...new Set([...(scope.primaryErrorPresent?[scope.primaryError]:[]),...(scope.pendingRejected?[scope.pendingError]:[]),...errors])];
        throw all.length===1?all[0]:new AggregateError(all,'fixture_assertion_and_cleanup_failed');
      }
      scope.closed=true;
    })().then(resolve,reject);
    return closing;
  }
  async closeAll(): Promise<void> {
    const outcomes=await Promise.allSettled([...this.scopes.values()].map(scope=>this.close(scope.harness)));
    const errors=outcomes.flatMap(row=>row.status==='rejected'?[row.reason]:[]);
    try{this.assertCanRestoreAndDelete();}catch(error){errors.push(error);}
    if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'fixture_all_cleanup_failed');
  }
  assertCanRestoreAndDelete(): void {
    if([...this.scopes.values()].some(scope=>!scope.closed||scope.poisoned||!scope.pendingSettled||scope.children.some(child=>!child.closed)))throw new Error('fixture_owned_work_still_active');
  }
  assertNoUnobservedErrors(): void {
    const errors=[...this.scopes.values()].filter(scope=>scope.pendingRejected&&(!scope.primaryErrorPresent||scope.pendingError!==scope.primaryError)).flatMap(scope=>scope.primaryErrorPresent?[scope.primaryError,scope.pendingError]:[scope.pendingError]);
    if(errors.length)throw new AggregateError(errors,'fixture_unobserved_chat_rejection');
  }
  snapshot(harness: TtyHarness) {
    const s=this.scopes.get(harness);if(!s)throw new Error('fixture_scope_missing');
    return {pendingSettled:s.pendingSettled,closed:s.closed,poisoned:s.poisoned,spawnedOwners:s.children.length,
      closedOwners:s.children.filter(child=>child.closed).length,liveOwners:s.children.filter(child=>!child.closed).length,ownerReadyCount:s.ownerReadyCount};
  }
}
