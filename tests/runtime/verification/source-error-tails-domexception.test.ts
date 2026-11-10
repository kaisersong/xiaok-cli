import {transferableAbortController} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {retainSourceErrorTails} from '../../../src/runtime/verification/source-error-tails.js';
import {createRoomTurnCustody} from '../../../src/runtime/verification/original-sdk-custody.js';

type Row = {raw: unknown; kind: 'promise' | 'unknown'};
function inventory(raw: unknown): Row[] {
  const rows: Row[] = [];
  retainSourceErrorTails(raw, (value, kind) => rows.push({raw: value, kind}));
  return rows;
}
function originalAbort(): Error {
  const controller = transferableAbortController();
  controller.abort();
  return controller.signal.reason;
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(yes => { release = yes; });
  return {promise, release};
}
afterEach(() => { vi.unstubAllGlobals(); });

it('accepts the real Node DOMException stock stack without reading its formatted value', () => {
  expect(inventory(originalAbort())).toEqual([]);
});

it('keeps deep cause, array, symbol and data-stack tails on the real DOM brand', () => {
  const error = originalAbort(), first = deferred(), second = deferred();
  const key = Symbol('sdk-tail');
  Object.defineProperty(error, 'cause', {value: [{[key]: first.promise}]});
  Object.defineProperty(error, 'stack', {value: {nested: [second.promise]}});
  try {
    const rows = inventory(error);
    expect(rows.filter(row => row.kind === 'unknown')).toEqual([]);
    expect(rows.filter(row => row.kind === 'promise').map(row => row.raw))
      .toEqual(expect.arrayContaining([first.promise, second.promise]));
  } finally {
    first.release(); second.release();
  }
});

it('does not accept a forged DOM prototype, constructor or copied stock stack', () => {
  const original = originalAbort(), proto = Object.getPrototypeOf(original);
  const forged = Object.create(proto);
  Object.defineProperty(forged, 'constructor', {value: DOMException});
  Object.defineProperty(forged, 'stack', Object.getOwnPropertyDescriptor(original, 'stack')!);
  expect(inventory(forged)).toContainEqual({raw: forged, kind: 'unknown'});
});

it('rejects a Proxy without invoking its traps', () => {
  let calls = 0;
  const proxy = new Proxy(originalAbort(), {
    get() { calls++; throw Error('forbidden get'); },
    ownKeys() { calls++; throw Error('forbidden keys'); },
    getPrototypeOf() { calls++; throw Error('forbidden prototype'); },
    getOwnPropertyDescriptor() { calls++; throw Error('forbidden descriptor'); },
  });
  const rows = inventory(proxy);
  expect(rows.length).toBe(1);
  expect(rows[0]!.raw === proxy).toBe(true);
  expect(rows[0]!.kind).toBe('unknown');
  expect(calls).toBe(0);
});

it('retains custom own getters as unknown and does not format a genuine stack', () => {
  let calls = 0;
  const error = originalAbort(), tail = deferred();
  Object.defineProperty(error, 'name', {get() { calls++; throw Error('forbidden name'); }});
  Object.defineProperty(error, 'message', {get() { calls++; throw Error('forbidden message'); }});
  Object.defineProperty(error, Symbol('sibling'), {value: tail.promise});
  try {
    const rows = inventory(error);
    expect(rows).toContainEqual({raw: error, kind: 'unknown'});
    expect(rows).toContainEqual({raw: tail.promise, kind: 'promise'});
    expect(calls).toBe(0);
  } finally { tail.release(); }
});

it('uses the captured original brand getter after its mutable public slot changes', () => {
  const error = originalAbort(), proto = Object.getPrototypeOf(error);
  const original = Object.getOwnPropertyDescriptor(proto, 'name')!;
  let calls = 0, rows: Row[];
  try {
    Object.defineProperty(proto, 'name', {...original, get() { calls++; throw Error('late hook'); }});
    rows = inventory(error);
  } finally { Object.defineProperty(proto, 'name', original); }
  expect(rows!).toEqual([]);
  expect(calls).toBe(0);
});

it('captures the real Node brand even if the global DOMException has already been replaced', async () => {
  const error = originalAbort();
  let calls = 0;
  class FakeDOMException { get name() { calls++; return 'AbortError'; } }
  vi.stubGlobal('DOMException', FakeDOMException);
  vi.resetModules();
  const fresh = await import('../../../src/runtime/verification/source-error-tails.js');
  const rows: Row[] = [];
  fresh.retainSourceErrorTails(error, (raw, kind) => rows.push({raw, kind}));
  expect(rows).toEqual([]);
  const forged = new FakeDOMException();
  fresh.retainSourceErrorTails(forged, (raw, kind) => rows.push({raw, kind}));
  expect(rows).toContainEqual({raw: forged, kind: 'unknown'});
  expect(calls).toBe(0);
});

it('keeps the original rejected DOMException identity and joins a known own-symbol tail', async () => {
  const custody = createRoomTurnCustody(), error = originalAbort(), tail = deferred();
  Object.defineProperty(error, Symbol('original-sdk-tail'), {value: tail.promise});
  await expect(custody.sdk(() => Promise.reject(error), undefined, [])).rejects.toBe(error);
  expect(() => custody.accepted()).toThrow(error);
  let ended = false;
  const ending = custody.waitPhysicalKnown().then(() => { ended = true; });
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(ended).toBe(false);
  } finally { tail.release(); }
  await ending;
  custody.assertPhysicalKnown();
});

it('joins a known sibling before reporting a custom-stack accessor as unknown', async () => {
  const custody = createRoomTurnCustody(), error = originalAbort(), tail = deferred();
  let calls = 0;
  Object.defineProperty(error, 'stack', {get() { calls++; throw Error('forbidden stack'); }});
  Object.defineProperty(error, Symbol('sibling'), {value: tail.promise});
  await expect(custody.sdk(() => Promise.reject(error), undefined, [])).rejects.toBe(error);
  let ended = false;
  const ending = custody.waitPhysicalKnown().then(
    () => ({ok: true}),
    failure => ({ok: false, failure}),
  ).then(result => { ended = true; return result; });
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(ended).toBe(false);
    expect(calls).toBe(0);
  } finally { tail.release(); }
  const result = await ending;
  expect(result.ok).toBe(false);
  expect(calls).toBe(0);
  expect(() => custody.assertPhysicalKnown()).toThrow('ROOM_TURN_SOURCE_SDK_UNCONFIRMED');
});

it('does not change a thrown undefined first cause into a fabricated error', async () => {
  const custody = createRoomTurnCustody();
  await expect(custody.sdk(() => { throw undefined; }, undefined, [])).rejects.toBeUndefined();
  let present = false, failure: unknown = 'not thrown';
  try { custody.accepted(); } catch (error) { present = true; failure = error; }
  expect(present).toBe(true);
  expect(failure).toBeUndefined();
  await custody.waitPhysicalKnown();
});
