import {types} from 'node:util';
import {closeSync, fstatSync, lstatSync, unlinkSync, constants} from 'node:fs';
import {retainSourceErrorTails} from './source-error-tails.js';
import {assertStandardIpcPromise} from './native-ipc-promise.js';
import {registerSourceSyncCustodyOwner, createSourceSyncCustodyContext, type SourceSyncSdkKind} from '../task-host/source-sync-custody.js';

const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, keys = Reflect.ownKeys;
const own = Object.hasOwn, isProxy = types.isProxy, isDate = types.isDate;
const integer = Number.isSafeInteger;
const retainedJournals = new Set<object>();
interface Descriptor {fd: number; closing: boolean; path: string; identity?: {dev: bigint; ino: bigint}; temp: boolean; deferred?: boolean}
interface Temp {path: string; identity?: {dev: bigint; ino: bigint}; renamed: boolean}

/** The existing journal's own synchronous IO consumer. It supplies no file,
 * migration or resource authority. SDK children use the original single walker. */
export function createMigrationJournalSyncIo(owner: object, current: () => void, retainDatabase: () => void) {
  const key = Object.freeze({}), pending = new Set<object>(), seen = new WeakSet<object>();
  const then = Promise.prototype.then, NativePromise = Promise;
  const held = new Map<number, Descriptor>(), temps = new Map<string, Temp>();
  const originals: unknown[] = [], waiters = new Set<() => void>();
  let active = 0, sealed = false, unknown = false, ending: Promise<void> | undefined;
  function notify() { if (!active && !pending.size) for (const waiter of waiters) waiter(); }
  function inventory(raw: unknown): void {
    originals.push(raw);
    retainSourceErrorTails(raw, (value, kind) => {
      if (kind === 'unknown') uncertain();
      if (kind !== 'promise' || !value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value); pending.add(value);
      try {
        assertStandardIpcPromise(value, 'migration_journal_promise_unknown');
        apply(then, value, [
          (result: unknown) => settled(value, result),
          (error: unknown) => settled(value, error),
        ]);
      } catch (error) { originals.push(error); uncertain(); pending.delete(value); notify(); }
    });
  }
  function settled(promise: object, value: unknown) {
    try { inventory(promise); inventory(value); } catch (error) { originals.push(error); uncertain(); }
    finally { pending.delete(promise); notify(); }
  }
  function join() {
    if (!active && !pending.size) return NativePromise.resolve();
    return new NativePromise<void>(yes => { const done = () => { waiters.delete(done); yes(); }; waiters.add(done); });
  }
  function uncertain() { unknown = true; retainedJournals.add(owner); retainDatabase(); }
  function known() { if (unknown || pending.size || active > 1 || [...held.values()].some(row => row.deferred)) throw Error('migration_journal_physical_unknown'); }
  function checkCurrent() { try { const result: unknown = current(); if (result !== undefined) { inventory(result); uncertain(); throw Error('migration_journal_current_result'); } } catch (error) { inventory(error); throw error; } }
  function local(cleanup: boolean) {
    if (!cleanup) { if (sealed) throw Error('migration_journal_closed'); known(); checkCurrent(); if (sealed) throw Error('migration_journal_closed'); known(); }
  }
  // Fixed Node stat result data, not a second recursive outcome walker. Every
  // own/symbol child (including Date own data) goes to the original inventory.
  function statData(raw: unknown) {
    if (!raw || typeof raw !== 'object' || isProxy(raw) || types.isPromise(raw)) { inventory(raw); uncertain(); throw Error('migration_journal_stat'); }
    originals.push(raw); const out: Record<string, any> = Object.create(null), names = keys(raw);
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!, row = descriptor(raw, name);
      if (!row || !own(row, 'value')) { inventory(raw); uncertain(); continue; }
      const value = row.value;
      if (isDate(value) && !isProxy(value)) {
        originals.push(value); const childKeys = keys(value);
        for (let j = 0; j < childKeys.length; j++) {
          const child = descriptor(value, childKeys[j]!);
          if (!child || !own(child, 'value')) { inventory(value); uncertain(); } else inventory(child.value);
        }
      } else inventory(value);
      if (typeof name === 'string' && (typeof value === 'number' || typeof value === 'bigint')) out[name] = value;
    }
    for (const name of ['dev', 'ino', 'mode', 'nlink', 'size', 'uid']) {
      const value = out[name];
      if (typeof value !== 'bigint' && (typeof value !== 'number' || !integer(value)) || value < 0) { uncertain(); throw Error('migration_journal_stat'); }
    }
    const mode = Number(out.mode);
    out.isDirectory = () => (mode & 0o170000) === 0o040000;
    out.isFile = () => (mode & 0o170000) === 0o100000;
    out.isSymbolicLink = () => (mode & 0o170000) === 0o120000;
    return Object.freeze(out);
  }
  function same(named: Record<string, any>, identity: {dev: bigint; ino: bigint}) {
    return BigInt(named.dev) === identity.dev && BigInt(named.ino) === identity.ino;
  }
  function invoke(kind: SourceSyncSdkKind, method: Function, args: unknown[], receiver?: unknown): unknown {
    const heldFd = typeof args[0] === 'number' ? held.get(args[0]) : undefined;
    const cleanup = kind === 'fd-close' || kind === 'fd-stat' && !!heldFd || kind === 'unlink-temp';
    active++;
    try {
      local(cleanup);
      if (kind === 'current') return undefined;
      if (kind === 'fd-close') {
        if (method !== closeSync || !heldFd || heldFd.closing) { uncertain(); throw Error('migration_journal_close_unknown'); }
        if (pending.size) { heldFd.deferred = true; return undefined; } // join original SDK tails first.
        if (!heldFd.identity) { uncertain(); throw Error('migration_journal_close_identity'); }
        const before = invoke('fd-stat', fstatSync, [heldFd.fd, {bigint: true}]) as Record<string, any>;
        if (!same(before, heldFd.identity)) { uncertain(); throw Error('migration_journal_close_identity'); }
        if (pending.size) { heldFd.deferred = true; return undefined; }
        heldFd.deferred = false;
        heldFd.closing = true;
      }
      let temp: Temp | undefined;
      if (kind === 'rename-temp' || kind === 'unlink-temp') {
        temp = typeof args[0] === 'string' ? temps.get(args[0]) : undefined;
        if (!temp || temp.renamed || !temp.identity || [...held.values()].some(row => row.path === temp!.path)) {
          if (kind === 'unlink-temp') return undefined;
          uncertain(); throw Error('migration_journal_temp_identity');
        }
        let named: unknown;
        try {named = apply(lstatSync, undefined, [temp.path, {bigint: true}]);}
        catch (error) {inventory(error);uncertain();throw error;}
        const before = statData(named);
        if(pending.size){if(kind==='unlink-temp')return undefined;throw Error('migration_journal_physical_pending');}
        if (!same(before, temp.identity)) { uncertain(); throw Error('migration_journal_temp_identity'); }
      }
      let raw: unknown;
      try { raw = apply(method, receiver, args); }
      catch (error) {
        inventory(error);
        if (kind === 'fd-open' || kind === 'fd-open-read' || kind === 'fd-close' || kind === 'rename-temp') uncertain();
        throw error;
      }
      if (kind === 'stat' || kind === 'fd-stat') {
        const value = statData(raw);
        if (heldFd) {
          const identity = {dev: BigInt(value.dev), ino: BigInt(value.ino)};
          if (heldFd.identity && !same(value, heldFd.identity)) { uncertain(); throw Error('migration_journal_fd_identity'); }
          heldFd.identity = identity;
          if (heldFd.temp) temps.get(heldFd.path)!.identity = identity;
        }
        if (!cleanup) { known(); checkCurrent(); if (sealed) throw Error('migration_journal_closed'); known(); }
        return value;
      }
      inventory(raw);
      if (kind === 'fd-open' || kind === 'fd-open-read') {
        if (typeof raw !== 'number' || !integer(raw) || raw < 0 || held.has(raw) || typeof args[0] !== 'string') { uncertain(); throw Error('migration_journal_fd'); }
        const temp = args[1] === 'wx' || typeof args[1] === 'number' && !!(args[1] & constants.O_EXCL) && !!(args[1] & constants.O_CREAT), row: Descriptor = {fd: raw, path: args[0], temp, closing: false};
        held.set(raw, row); if (temp) temps.set(row.path, {path: row.path, renamed: false});
      } else if (kind === 'fd-close') {
        if (raw !== undefined) { uncertain(); throw Error('migration_journal_close_unknown'); }
        held.delete(heldFd!.fd);
      } else if (kind === 'rename-temp' || kind === 'unlink-temp') {
        if (raw !== undefined) { uncertain(); throw Error('migration_journal_temp_unknown'); }
        temp!.renamed = kind === 'rename-temp'; temps.delete(temp!.path);
      } else if (kind === 'uuid' || kind === 'string') {
        if (typeof raw !== 'string') { uncertain(); throw Error('migration_journal_sdk_result'); }
      } else if (kind === 'mkdir') {
        if (raw !== undefined && typeof raw !== 'string') { uncertain(); throw Error('migration_journal_sdk_result'); }
      } else if (kind === 'void' && raw !== undefined) { uncertain(); throw Error('migration_journal_sdk_result'); }
      if (!cleanup) { known(); checkCurrent(); if (sealed) throw Error('migration_journal_closed'); known(); }
      return raw;
    } finally {
      active--;
      notify();
    }
  }
  registerSourceSyncCustodyOwner(owner, (actual, kind, method, args, receiver) => {
    if (actual !== key) throw Error('migration_journal_context');
    return invoke(kind, method, args, receiver);
  });
  const context = createSourceSyncCustodyContext(owner, key);
  return Object.freeze({
    context, invoke, assertKnown() { known(); if (held.size || temps.size) throw Error('migration_journal_physical_pending'); },
    close() {
      if (ending) return ending;
      sealed = true;
      return ending = (async () => {
        await join();
        let failure: {error: unknown} | undefined;
        // Negative cleanup is independent of currentness and attempts every
        // descriptor whose original close has not already entered/failed.
        for (;;) {
          await join();
          for (const row of [...held.values()]) if (!row.closing) {
            try { invoke('fd-close', closeSync, [row.fd]); } catch (error) { failure ??= {error}; }
          }
          if (!pending.size) break;
        }
        for (;;) {
          await join();
          for (const temp of [...temps.values()]) {
            try {invoke('unlink-temp', unlinkSync, [temp.path]);} catch (error) {failure ??= {error};}
          }
          if(!pending.size)break;
        }
        if (held.size || temps.size || unknown) { uncertain(); throw Error('migration_journal_physical_unknown', failure ? {cause: failure.error} : undefined); }
        await join(); known(); if (failure) throw failure.error;
      })();
    },
  });
}
