import * as fs from 'node:fs';
import { types } from 'node:util';
import {
  validateArtifactBytes,
  type StructuralValidationResult,
} from '../../quality/artifact-structure.js';
import {
  createRoomTurnCustody,
  type RoomTurnCustody,
} from '../verification/original-sdk-custody.js';
import {
  createIntrinsicSet,
  appendIntrinsic,
  aggregateIntrinsicErrors,
} from '../verification/intrinsic-async-collection.js';
import type { EvidenceEffect } from './completion-evidence.js';

const NativePromise = Promise,
  apply = Reflect.apply,
  then = Promise.prototype.then;
const freeze = Object.freeze,
  create = Object.create,
  descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty,
  nativeNumber = Number,
  minimum = Math.min;
const keys = Reflect.ownKeys,
  prototype = Object.getPrototypeOf,
  own = Object.hasOwn;
const isProxy = types.isProxy,
  isPromise = types.isPromise,
  isDate = types.isDate;
const weakGet = WeakMap.prototype.get,
  weakSet = WeakMap.prototype.set;
const access = fs.access,
  realpath = fs.realpath,
  lstat = fs.lstat;
const open = fs.open,
  read = fs.read,
  fstat = fs.fstat,
  close = fs.close;
const statsPrototype = fs.Stats.prototype,
  datePrototype = Date.prototype;
const NativeBuffer = Buffer,
  bufferAlloc = Buffer.alloc,
  bufferIsBuffer = Buffer.isBuffer;
const regexpTest = RegExp.prototype.test,
  indexPattern = /^(0|[1-9][0-9]*)$/;
const typedLength = descriptor(prototype(Uint8Array.prototype), 'length')!.get!;
const finite = Number.isFinite,
  integer = Number.isSafeInteger;
const includes = Array.prototype.includes;
const rows = new WeakMap<object, FileOperation>();
const functionPrototype = Function.prototype;
interface CallbackScan {
  scan(): void;
}
type FileEffect = Exclude<EvidenceEffect, { kind: 'current-completion' }>;
type FileResult = boolean | string | StructuralValidationResult;
export interface OriginalCompletionFileOptions {
  signal: AbortSignal;
  assertActive?(): void;
  trackPending(raw: Promise<unknown>, originalFileOperation?: object): void;
}
interface FileOperation {
  raws: ReturnType<typeof createIntrinsicSet<unknown>>;
  stocks: ReturnType<typeof createIntrinsicSet<RoomTurnCustody>>;
  completed: boolean;
  completion: Promise<void>;
  finish(): void;
  unclosed: boolean;
  unknown: boolean;
  failures: unknown[];
  callbacks: ReturnType<typeof createIntrinsicSet<CallbackScan>>;
}
function scanCallbacks(row: FileOperation): void {
  const callbacks = row.callbacks.snapshot();
  for (let i = 0; i < callbacks.length; i++) callbacks[i]!.scan();
}
function physicalFailure(row: FileOperation, fallback: unknown): unknown {
  if (row.failures.length === 1) return row.failures[0];
  if (row.failures.length > 1)
    return aggregateIntrinsicErrors(
      row.failures,
      'completion_file_cleanup_failed',
    );
  return fallback;
}
function active(options: OriginalCompletionFileOptions): void {
  if (options.signal.aborted)
    throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
  options.assertActive?.();
  if (options.signal.aborted)
    throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
}
function stock(row: FileOperation): RoomTurnCustody {
  const value = createRoomTurnCustody();
  row.stocks.add(value);
  return value;
}
function internal<T>(promise: Promise<T>): Promise<T> {
  define(promise, 'constructor', {
    __proto__: null,
    value: NativePromise,
  } as PropertyDescriptor);
  return promise;
}
/** Physical fate only. No file path, DTO or caller verifier can mint membership. */
export function readOriginalCompletionFileOperation(
  raw: unknown,
  proof: unknown,
): Readonly<{ waitKnown(): Promise<void>; assertKnown(): void }> {
  const row = apply(weakGet, rows, [proof]) as FileOperation | undefined;
  if (!row || !row.raws.has(raw))
    throw Error('COMPLETION_FILE_ORIGINAL_OPERATION_REQUIRED');
  const assertKnown = () => {
    scanCallbacks(row);
    if (!row.completed || row.unclosed || row.unknown)
      throw physicalFailure(row, Error('COMPLETION_FILE_PHYSICAL_UNCONFIRMED'));
    const stocks = row.stocks.snapshot();
    for (let i = 0; i < stocks.length; i++) stocks[i]!.assertPhysicalKnown();
  };
  return freeze({
    assertKnown,
    async waitKnown() {
      await row.completion;
      scanCallbacks(row);
      let primary: { error: unknown } | undefined;
      const stocks = row.stocks.snapshot();
      // Join every known child before reporting an unknown sibling.
      const waiting: Promise<void>[] = [];
      for (let i = 0; i < stocks.length; i++)
        appendIntrinsic(
          waiting,
          internal(
            apply(then, stocks[i]!.waitPhysicalKnown(), [
              () => undefined,
              (error: unknown) => {
                primary ??= { error };
              },
            ]) as Promise<void>,
          ),
        );
      for (let i = 0; i < waiting.length; i++) await waiting[i];
      if (primary) throw physicalFailure(row, primary.error);
      assertKnown();
    },
  });
}
function retainedRaw(
  row: FileOperation,
  custody: RoomTurnCustody,
  raw: unknown,
  proof: object,
  options: OriginalCompletionFileOptions,
): void {
  row.raws.add(raw);
  custody.inventory(raw);
  if (isPromise(raw) && !isProxy(raw))
    options.trackPending(raw as Promise<unknown>, proof);
}
type CallbackResult =
  | { ok: true; values: unknown[]; sdkFailure?: { error: unknown } }
  | { ok: false; error: unknown };
async function callbackCall(
  row: FileOperation,
  proof: object,
  options: OriginalCompletionFileOptions,
  fn: Function,
  args: unknown[],
  cleanup = false,
): Promise<CallbackResult> {
  const custody = stock(row);
  let accept!: (value: CallbackResult) => void;
  const callback = internal(
    new NativePromise<CallbackResult>((yes) => {
      accept = yes;
    }),
  );
  let called = false;
  const cb = (error: unknown, ...values: unknown[]) => {
    if (called) {
      row.unknown = true;
      // A second callback is an unknown producer disposition, not a fresh result.
      custody.inventory(create({ duplicateCallback: true }));
      for (let i = 0; i < values.length; i++) custody.inventory(values[i]);
      custody.inventory(error);
      return;
    }
    called = true;
    if (error !== null && error !== undefined) {
      row.raws.add(error);
      custody.inventory(error);
      for (let i = 0; i < values.length; i++) {
        row.raws.add(values[i]);
        if (fn === read && i === 1 && values[i] === args[1]) {
          try {
            readBuffer(row, args[1] as Buffer, values[i]);
          } catch (childError) {
            row.raws.add(childError);
            custody.inventory(childError);
          }
        } else custody.inventory(values[i]);
      }
      accept({ ok: false, error });
    } else {
      // Only the first result slot (or read's two original slots) has a fixed
      // Native resource consumer below. Extra callback data is ordinary stock.
      const count =
        fn === read
          ? 2
          : fn === open || fn === realpath || fn === lstat || fn === fstat
            ? 1
            : 0;
      for (let i = 0; i < values.length; i++) {
        row.raws.add(values[i]);
        if (i >= count) custody.inventory(values[i]);
      }
      accept({ ok: true, values });
    }
  };
  // Only this private callback's pristine own slots are a baseline. The SDK
  // receives it afterwards, so every added own/symbol slot remains inventory.
  const callbackNames = keys(cb),
    callbackBaseline: Array<{ key: PropertyKey; value: PropertyDescriptor }> =
      [];
  for (let i = 0; i < callbackNames.length; i++)
    appendIntrinsic(callbackBaseline, {
      key: callbackNames[i]!,
      value: descriptor(cb, callbackNames[i]!)!,
    });
  const callbackScan: CallbackScan = {
    scan() {
      if (prototype(cb) !== functionPrototype) row.unknown = true;
      const names = keys(cb);
      for (let i = 0; i < names.length; i++) {
        const key = names[i]!,
          entry = descriptor(cb, key);
        let prior: PropertyDescriptor | undefined;
        for (let j = 0; j < callbackBaseline.length; j++)
          if (callbackBaseline[j]!.key === key)
            prior = callbackBaseline[j]!.value;
        if (!entry || !own(entry, 'value')) {
          row.unknown = true;
          continue;
        }
        if (
          prior &&
          own(prior, 'value') &&
          entry.value === prior.value &&
          entry.configurable === prior.configurable &&
          entry.enumerable === prior.enumerable &&
          entry.writable === prior.writable
        )
          continue;
        if (prior) row.unknown = true;
        row.raws.add(entry.value);
        custody.inventory(entry.value);
      }
      for (let i = 0; i < callbackBaseline.length; i++)
        if (!descriptor(cb, callbackBaseline[i]!.key)) row.unknown = true;
    },
  };
  row.callbacks.add(callbackScan);
  let sdkFailure: { error: unknown } | undefined;
  let entered = false;
  const sdk = custody.sdk(
    () => {
      if (!cleanup) active(options); // observer above may have synchronously withdrawn
      entered = true;
      const callArgs: unknown[] = [];
      for (let i = 0; i < args.length; i++) appendIntrinsic(callArgs, args[i]);
      appendIntrinsic(callArgs, cb);
      const raw = apply(fn, fs, callArgs);
      callbackScan.scan();
      retainedRaw(row, custody, raw, proof, options);
      return raw;
    },
    undefined,
    [],
  );
  const sdkDone = internal(
    apply(then, sdk, [
      () => undefined,
      (error: unknown) => {
        row.raws.add(error);
        sdkFailure = { error };
      },
    ]) as Promise<void>,
  );
  if (!entered) {
    await sdkDone;
    if (sdkFailure) throw sdkFailure.error;
    throw Error('COMPLETION_FILE_NOT_ENTERED');
  }
  // Even a throwing wrapper may already have entered Native. Keep its actual
  // callback and any late descriptor in inventory; no timeout declares it gone.
  const value = await callback;
  callbackScan.scan(); // after the actual SDK wrapper has returned from cb
  await sdkDone;
  if (sdkFailure) {
    if (value.ok) return { ...value, sdkFailure };
    throw aggregateIntrinsicErrors(
      [sdkFailure.error, value.error],
      'completion_file_sdk_callback_failed',
    );
  }
  return value;
}
function outcomeFailure(value: CallbackResult): void {
  if (value.ok && value.sdkFailure) throw value.sdkFailure.error;
  if (!value.ok) throw value.error;
}
function statsValue(
  row: FileOperation,
  value: unknown,
  field: 'mode' | 'size',
): number {
  const custody = stock(row);
  row.raws.add(value);
  if (
    !value ||
    typeof value !== 'object' ||
    isProxy(value) ||
    prototype(value) !== statsPrototype
  ) {
    row.unknown = true;
    custody.inventory(value);
    throw Error('COMPLETION_FILE_STATS_UNCONFIRMED');
  }
  const names = keys(value);
  let selected: number | undefined;
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!,
      d = descriptor(value, name);
    if (!d || !own(d, 'value')) {
      row.unknown = true;
      custody.inventory(value);
      continue;
    }
    const child = d.value;
    if (
      typeof name === 'string' &&
      apply(
        includes,
        [
          'dev',
          'mode',
          'nlink',
          'uid',
          'gid',
          'rdev',
          'blksize',
          'ino',
          'size',
          'blocks',
          'atimeMs',
          'mtimeMs',
          'ctimeMs',
          'birthtimeMs',
        ],
        [name],
      )
    ) {
      if (typeof child !== 'number' || !finite(child)) {
        row.unknown = true;
        custody.inventory(value);
      }
      if (name === field && typeof child === 'number' && finite(child))
        selected = child;
    } else if (
      typeof name === 'string' &&
      apply(includes, ['atime', 'mtime', 'ctime', 'birthtime'], [name]) &&
      child &&
      typeof child === 'object' &&
      !isProxy(child) &&
      isDate(child) &&
      prototype(child) === datePrototype
    ) {
      const childNames = keys(child);
      for (let j = 0; j < childNames.length; j++) {
        const entry = descriptor(child, childNames[j]!);
        if (!entry || !own(entry, 'value')) custody.inventory(child);
        else custody.inventory(entry.value);
      }
    } else custody.inventory(child); // own and symbol sidecars are never a baseline
  }
  custody.assertPhysicalKnown();
  if (selected === undefined || selected < 0 || !integer(selected)) {
    row.unknown = true;
    throw Error('COMPLETION_FILE_STATS_UNCONFIRMED');
  }
  return selected;
}
function readBuffer(
  row: FileOperation,
  buffer: Buffer,
  callbackBuffer: unknown,
): void {
  const custody = stock(row);
  row.raws.add(callbackBuffer);
  if (
    callbackBuffer !== buffer ||
    isProxy(callbackBuffer) ||
    !bufferIsBuffer(callbackBuffer)
  ) {
    row.unknown = true;
    custody.inventory(callbackBuffer);
    throw Error('COMPLETION_FILE_BUFFER_UNCONFIRMED');
  }
  const length = apply(typedLength, buffer, []) as number,
    names = keys(buffer);
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!,
      d = descriptor(buffer, name);
    if (!d || !own(d, 'value')) {
      row.unknown = true;
      custody.inventory(buffer);
      continue;
    }
    if (
      typeof name === 'string' &&
      apply(regexpTest, indexPattern, [name]) &&
      nativeNumber(name) < length &&
      typeof d.value === 'number'
    )
      continue;
    custody.inventory(d.value);
  }
  custody.assertPhysicalKnown();
}
async function perform(
  row: FileOperation,
  proof: object,
  effect: FileEffect,
  options: OriginalCompletionFileOptions,
): Promise<FileResult> {
  if (effect.kind === 'exists') {
    const result = await callbackCall(row, proof, options, access, [
      effect.path,
    ]);
    if (!result.ok) {
      active(options);
      return false;
    }
    outcomeFailure(result);
    active(options);
    return true;
  }
  if (effect.kind === 'realpath' || effect.kind === 'lstat') {
    const result = await callbackCall(
      row,
      proof,
      options,
      effect.kind === 'realpath' ? realpath : lstat,
      [effect.path],
    );
    outcomeFailure(result);
    if (!result.ok) throw result.error;
    active(options);
    if (effect.kind === 'lstat')
      return (
        (statsValue(row, result.values[0], 'mode') & 0o170000) === 0o120000
      );
    stock(row).inventory(result.values);
    if (typeof result.values[0] !== 'string')
      throw Error('COMPLETION_FILE_REALPATH_UNCONFIRMED');
    return result.values[0];
  }
  if (effect.kind !== 'structure')
    throw Error('COMPLETION_FILE_EFFECT_REQUIRED');
  let fd: number | undefined;
  const failures: unknown[] = [];
  let result: StructuralValidationResult | undefined;
  try {
    const opened = await callbackCall(row, proof, options, open, [
      effect.path,
      'r',
    ]);
    if (
      opened.ok &&
      typeof opened.values[0] === 'number' &&
      integer(opened.values[0]) &&
      opened.values[0] >= 0
    ) {
      fd = opened.values[0];
      row.unclosed = true;
    }
    outcomeFailure(opened);
    if (fd === undefined) {
      row.unknown = true;
      throw Error('COMPLETION_FILE_DESCRIPTOR_UNCONFIRMED');
    }
    active(options);
    let length = 5;
    if (effect.structuralKind === 'pptx') {
      const info = await callbackCall(row, proof, options, fstat, [fd]);
      outcomeFailure(info);
      if (!info.ok) throw info.error;
      length = minimum(65536, statsValue(row, info.values[0], 'size'));
      active(options);
    }
    const buffer = apply(bufferAlloc, NativeBuffer, [length]) as Buffer;
    const readResult = await callbackCall(row, proof, options, read, [
      fd,
      buffer,
      0,
      length,
      0,
    ]);
    outcomeFailure(readResult);
    if (!readResult.ok) throw readResult.error;
    readBuffer(row, buffer, readResult.values[1]);
    const bytesRead = readResult.values[0];
    if (
      typeof bytesRead !== 'number' ||
      !integer(bytesRead) ||
      bytesRead < 0 ||
      bytesRead > length
    ) {
      row.unknown = true;
      throw Error('COMPLETION_FILE_READ_UNCONFIRMED');
    }
    active(options);
    result = validateArtifactBytes(effect.structuralKind, buffer, bytesRead);
  } catch (error) {
    row.raws.add(error);
    appendIntrinsic(row.failures, error);
    appendIntrinsic(failures, error);
  }
  if (fd !== undefined) {
    try {
      const closed = await callbackCall(row, proof, options, close, [fd], true);
      outcomeFailure(closed);
      row.unclosed = false;
    } catch (error) {
      row.raws.add(error);
      appendIntrinsic(row.failures, error);
      appendIntrinsic(failures, error);
    }
  }
  if (failures.length) {
    // Preserve the old structural check's fail-open rule, while the independent
    // physical receipt still rejects an unclosed fd or unknown SDK inventory.
    active(options);
    return { ok: true };
  }
  active(options);
  return result!;
}
/** Fixed original FS producer. No generic operation/callback registration. */
export function executeOriginalCompletionFileEffect(
  effect: FileEffect,
  options: OriginalCompletionFileOptions,
): Promise<FileResult> {
  const proof = freeze(create(null));
  let finish!: () => void;
  const completion = internal(
    new NativePromise<void>((yes) => {
      finish = yes;
    }),
  );
  const row: FileOperation = {
    raws: createIntrinsicSet(),
    stocks: createIntrinsicSet(),
    completion,
    finish,
    completed: false,
    unclosed: false,
    unknown: false,
    failures: [],
    callbacks: createIntrinsicSet(),
  };
  apply(weakSet, rows, [proof, row]);
  let resolve!: (value: FileResult) => void, reject!: (error: unknown) => void;
  const result = internal(
    new NativePromise<FileResult>((yes, no) => {
      resolve = yes;
      reject = no;
    }),
  );
  row.raws.add(result);
  try {
    options.trackPending(result, proof);
    active(options);
  } catch (error) {
    row.raws.add(error);
    appendIntrinsic(row.failures, error);
    stock(row).inventory(error);
    row.completed = true;
    row.finish();
    reject(error);
    return result;
  }
  void apply(then, perform(row, proof, effect, options), [
    (value: FileResult) => {
      row.completed = true;
      row.finish();
      resolve(value);
    },
    (error: unknown) => {
      row.raws.add(error);
      appendIntrinsic(row.failures, error);
      stock(row).inventory(error);
      row.completed = true;
      row.finish();
      reject(error);
    },
  ]);
  return result;
}
