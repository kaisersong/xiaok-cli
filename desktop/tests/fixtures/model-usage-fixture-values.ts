import {types as utilTypes} from 'node:util';
// @vitest-environment node
import { expect, it, vi, type TestContext } from 'vitest';
import { mkdtempSync, realpathSync, lstatSync, rmSync, existsSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { mapDesktopModelUsageAdmission, type DesktopModelUsageAdmission } from '../../electron/desktop-model-usage-admission.js';
import { MultiAgentCommandSequencer } from '../../electron/desktop-multi-agent-mailbox.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { assertDesktopModelPhysicalIdle, waitDesktopModelPhysicalIdle, type DesktopModelPhysicalScope } from '../../electron/desktop-task-stream.js';

export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const outcome = <T>(promise: Promise<T>) => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);

export interface Fixture {
  service: DesktopMultiAgentService;
  store: DesktopMultiAgentStore;
  db: DatabaseSync;
  context: DesktopAgentExecutionContext;
  queue: MultiAgentCommandSequencer;
  capture(id: string): DesktopModelUsageAdmission;
  cancel(): Promise<void>;
  finish(): Promise<void>;
  expectIntegrityFailure(error: unknown): void;
  track<T>(name: string, promise: Promise<T>): Promise<T>;
  keep<T>(name: string, value: T): T;
  restores: Array<() => void>;
}
export type Observed<T> = Awaited<ReturnType<typeof outcome<T>>>;
export interface RootIdentity {
  root: string; nonce: string; runToken: string; workerPid: number; workerPpid: number;
  uid: number; dev: number; ino: number; birthtimeMs: number;
}
export interface FixtureOwner {
  nonce: string; runToken: string; workerPid: number; workerPpid: number;
  identity?: RootIdentity;
  references: Map<string, unknown>;
}
// Strong and append-only for this actual worker's lifetime. No WeakRef,
// finalizer, afterAll, clear/delete, or child-side retained-root removal.
export const retainedOwners: FixtureOwner[] = [];

/** Actual service/host/store actor. The literal root body has no SDK/provider,
 * recipe, spawn, fetch/config/registry dependency, or child session. */

export function observeCommands(f: Fixture) {
  const commands: Promise<unknown>[] = [], original = f.queue.run;
  const spy = vi.spyOn(f.queue, 'run').mockImplementation(((action: () => unknown) => {
    const raw = original.call(f.queue, action); commands.push(raw); return raw;
  }) as typeof f.queue.run);
  f.keep('commandPromises', commands); f.keep('commandSpy', spy);
  f.restores.push(() => spy.mockRestore());
  return commands;
}

/** Bounded own-data diagnostics only; never a closure/known-state proof. */
export function fixtureErrorGraph(value:unknown,seen=new Set<object>()):unknown {
 if(value===undefined)return {primitive:'undefined'};
 if(value===null||typeof value!=='object')return typeof value==='string'?value.slice(0,400):{primitive:typeof value};
 if(utilTypes.isProxy(value))return {opaque:'proxy'};
 if(seen.has(value))return {reference:true};seen.add(value);if(seen.size>32)return {bounded:true};
 if(Array.isArray(value)){const out:unknown[]=[];for(let i=0;i<Math.min(value.length,8);i++){const d=Object.getOwnPropertyDescriptor(value,String(i));out.push(d&&Object.hasOwn(d,'value')?fixtureErrorGraph(d.value,seen):{opaque:'accessor'});}return out;}
 const out:Record<string,unknown>={};for(const key of ['message','code','sdkKind','unknownKinds','cause','errors']){const d=Object.getOwnPropertyDescriptor(value,key);if(d)out[key]=Object.hasOwn(d,'value')?fixtureErrorGraph(d.value,seen):{opaque:'accessor'};}return out;
}
