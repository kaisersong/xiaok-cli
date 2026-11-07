import {createIntrinsicSet} from '../verification/intrinsic-async-collection.js';
import {createRoomTurnCustody} from '../verification/original-sdk-custody.js';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { ClientRequest, IncomingMessage, request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { types } from 'node:util';
import type { ConnectionOptions } from 'node:tls';

export interface SingleRequestSourceHooks {
  beforeTransport(this: SingleRequestSourceHooks, phase: 'connect' | 'send'): void;
  observeRawFailure(this: SingleRequestSourceHooks, raw: unknown): void;
}
export interface SingleRequestHttpsOptions {
  destination: string; expectedBody: string; method?: 'POST' | 'GET'; transportProfile?:'model_stream_v1'; timeoutMs: number; maxResponseBytes: number; signal?: AbortSignal;
  /** Internal test TLS trust only. Never populated by a product policy. */
  certificateAuthority?: RequestOptions['ca'];
  trackPhysicalDrain?: (drain: Promise<void>) => void;
  /** Fixed package lifecycle hooks, never policy/renderer/tool fields or provider authorization. */
  sourceHooks?: SingleRequestSourceHooks;
}
const NativePromise = Promise, then = Promise.prototype.then, resolvePromise = Promise.resolve;
const apply = Reflect.apply, own = Object.hasOwn, descriptor = Object.getOwnPropertyDescriptor;
const freezePhysical=Object.freeze,createPhysical=Object.create;
const mapEntries=Map.prototype.entries,mapNext=Object.getPrototypeOf(new Map().entries()).next;
const setValues=Set.prototype.values,setNext=Object.getPrototypeOf(new Set().values()).next;
const mapSize=Object.getOwnPropertyDescriptor(Map.prototype,'size')!.get!;
const keys = Reflect.ownKeys, proto = Object.getPrototypeOf, define = Object.defineProperty;
const objectPrototype = Object.prototype, functionPrototype = Function.prototype, isProxy = types.isProxy;
const isPromise = types.isPromise, isNativeMap = types.isMap, isNativeSet = types.isSet, isNativeError = types.isNativeError;
const nativeString = String;
const NativeError = Error, NativeDOMException = DOMException, NativeURL = URL, NativeRequest = Request;
const nativeDomPrototype = NativeDOMException.prototype;
const NativeResponse = Response, NativeHeaders = Headers, NativeStream = ReadableStream, NativeBytes = Uint8Array;
const requestNative = httpsRequest, requestHttpNative=httpRequest, nativeEnd = ClientRequest.prototype.end;
const destroyRequest = ClientRequest.prototype.destroy, destroyResponse = IncomingMessage.prototype.destroy;
const incomingOn = IncomingMessage.prototype.on;
const on = EventEmitter.prototype.on, remove = EventEmitter.prototype.removeListener;
const signalThrow = AbortSignal.prototype.throwIfAborted, signalAny = AbortSignal.any;
const addAbort = EventTarget.prototype.addEventListener, removeAbort = EventTarget.prototype.removeEventListener;
const deleteHeader = Headers.prototype.delete, setHeader = Headers.prototype.set, appendHeader = Headers.prototype.append;
const streamEnqueue = ReadableStreamDefaultController.prototype.enqueue, streamError = ReadableStreamDefaultController.prototype.error, streamClose = ReadableStreamDefaultController.prototype.close;
const setTimer = setTimeout, clearTimer = clearTimeout;
const NativeWeakMap = WeakMap, weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
const ownedFetches = new NativeWeakMap<object, object>();
interface OriginalResponseRecord {owner:object;slots:Map<PropertyKey,PropertyDescriptor>;drain:()=>Promise<void>;known:()=>boolean;diagnostic:()=>object}
const ownedResponses = new NativeWeakMap<object, OriginalResponseRecord>();
interface OriginalPhysicalReply {fetch:object;destination:string;method:string;requestBody:string;status:number;known():boolean}
const physicalReplies=new NativeWeakMap<object,OriginalPhysicalReply>();
const fetchRequests=new NativeWeakMap<object,{destination:string;method:string;requestBody:string}>();
/** Actual original response/body/close receipt. No copied status/closed DTO can
 * establish this membership or turn an unknown visible tail into completion. */
export function readOriginalSingleRequestPhysicalReceipt(receipt:unknown):Readonly<{kind:'single_request_physical_receipt_v1';destination:string;method:string;requestBody:string;status:number;assertKnown():void}> {
 const row=apply(weakGet,physicalReplies,[receipt]) as OriginalPhysicalReply|undefined;
 if(!row)throw new NativeError('SINGLE_REQUEST_ORIGINAL_PHYSICAL_RECEIPT_REQUIRED');
 const assertKnown=()=>{if(!row.known())throw new NativeError('SINGLE_REQUEST_PHYSICAL_UNCONFIRMED');};assertKnown();
 return freezePhysical({kind:'single_request_physical_receipt_v1',destination:row.destination,method:row.method,requestBody:row.requestBody,status:row.status,assertKnown});
}
const sourceFailures = new NativeWeakMap<object, { unknown: boolean }>();
const responseStatus = descriptor(Response.prototype, 'status')!.get!, responseHeaders = descriptor(Response.prototype, 'headers')!.get!;
const responseBytes = Response.prototype.arrayBuffer, headerGet = Headers.prototype.get;
const NativeMap = Map, mapGet = Map.prototype.get, mapSet = Map.prototype.set;
const rejected = () => new NativeError('SEMANTIC_SINGLE_REQUEST_REJECTED');
const resolved = () => apply(resolvePromise, NativePromise, [undefined]) as Promise<void>;
const follow = <T, R>(value: Promise<T>, yes: (value: T) => R | PromiseLike<R>, no?: (error: unknown) => R | PromiseLike<R>): Promise<R> => apply(then, value, [yes, no]) as Promise<R>;
function data(target: object, key: PropertyKey, value: unknown): void { define(target, key, { __proto__: null, value, enumerable: true, configurable: true, writable: true } as PropertyDescriptor); }
function hooksAtBirth(options: SingleRequestHttpsOptions): { receiver: SingleRequestSourceHooks; before: Function; observe: Function } | undefined {
  if (isProxy(options)) throw rejected();
  const option = descriptor(options, 'sourceHooks');
  if (!option) return;
  if (!own(option, 'value')) throw rejected();
  if (option.value === undefined) return;
  const value = option.value;
  if (!value || typeof value !== 'object' || isProxy(value) || proto(value) !== objectPrototype && proto(value) !== null) throw rejected();
  const names = keys(value); if (names.length !== 2) throw rejected();
  let before: Function | undefined, observe: Function | undefined;
  for (let i = 0; i < names.length; i++) {
    const key = names[i]!; if (key !== 'beforeTransport' && key !== 'observeRawFailure') throw rejected();
    const row = descriptor(value, key);
    if (!row || !own(row, 'value') || !row.enumerable || typeof row.value !== 'function' || isProxy(row.value)
      || types.isAsyncFunction(row.value) || proto(row.value) !== functionPrototype) throw rejected();
    if (key === 'beforeTransport') before = row.value; else observe = row.value;
  }
  if (!before || !observe) throw rejected();
  return { receiver: value, before, observe };
}
interface ResourceGate {receiver:object;before:Function;after:Function;observe:Function}
const resourceGateSetters=new NativeWeakMap<object,(gate:unknown)=>void>();
/** Narrowing lifecycle hooks only. Presence is never a capacity or Source grant. */
export function attachOriginalSingleRequestResourceGate(fetch:unknown,gate:unknown):void {
 const install=apply(weakGet,resourceGateSetters,[fetch]) as ((gate:unknown)=>void)|undefined;
 if(!install)throw rejected();install(gate);
}
function captureResourceGate(value:unknown):ResourceGate {
 if(!value||typeof value!=='object'||isProxy(value)||proto(value)!==objectPrototype&&proto(value)!==null)throw rejected();
 const names=keys(value);if(names.length!==3)throw rejected();let before:Function|undefined,after:Function|undefined,observe:Function|undefined;
 for(let i=0;i<names.length;i++){
  const name=names[i]!,row=descriptor(value,name);
  if(!row||!own(row,'value')||!row.enumerable||typeof row.value!=='function'||isProxy(row.value)||types.isAsyncFunction(row.value)||proto(row.value)!==functionPrototype)throw rejected();
  if(name==='beforeSource')before=row.value;else if(name==='afterSourceLocal')after=row.value;else if(name==='observeRawFailure')observe=row.value;else throw rejected();
 }
 if(!before||!after||!observe)throw rejected();return{receiver:value,before,after,observe};
}
export interface BrokerAdmissionLoopbackOptions {
  action: 'baseline' | 'apply' | 'read';
  expectedBody: string;
  signal: AbortSignal;
}
const signalAborted = descriptor(AbortSignal.prototype, 'aborted')!.get!;
const brokerOrigin = 'http://127.0.0.1:4318/rooms/admission-control/';
const brokerTokenHeader = 'x-intent-broker-room-token';

/** Fixed local control transport only. This factory does not authenticate a
 * Broker command or confer Main/Source authority. No URL/profile override. */
export function createBrokerAdmissionLoopbackFetch(options: BrokerAdmissionLoopbackOptions): typeof globalThis.fetch {
  if (!options || typeof options !== 'object' || isProxy(options)
    || proto(options) !== objectPrototype && proto(options) !== null) throw rejected();
  const names = keys(options);
  if (names.length !== 3) throw rejected();
  const values = createPhysical(null) as Record<string, unknown>;
  for (const name of names) {
    if (name !== 'action' && name !== 'expectedBody' && name !== 'signal') throw rejected();
    const row = descriptor(options, name);
    if (!row || !own(row, 'value') || !row.enumerable) throw rejected();
    data(values, name, row.value);
  }
  if (values.action !== 'baseline' && values.action !== 'apply' && values.action !== 'read'
    || typeof values.expectedBody !== 'string' || Buffer.byteLength(values.expectedBody) > 16 * 1024
    || !values.signal || typeof values.signal !== 'object' || isProxy(values.signal)) throw rejected();
  // Native brand check only, without invoking caller properties.
  apply(signalAborted, values.signal, []);
  const fixed: SingleRequestHttpsOptions = createPhysical(null);
  data(fixed, 'destination', brokerOrigin + values.action);
  data(fixed, 'expectedBody', values.expectedBody);
  data(fixed, 'method', 'POST');
  data(fixed, 'signal', values.signal);
  data(fixed, 'timeoutMs', 30000);
  data(fixed, 'maxResponseBytes', 32 * 1024);
  return createSingleRequestFetch(fixed, true);
}

function captureBrokerInit(input: unknown, init: RequestInit | undefined, destination: string, body: string, signal: AbortSignal | undefined): RequestInit {
  if (typeof input !== 'string' || input !== destination || !init || typeof init !== 'object' || isProxy(init)
    || proto(init) !== objectPrototype && proto(init) !== null) throw rejected();
  const captured = createPhysical(null) as Record<string, unknown>;
  for (const name of keys(init)) {
    if (name !== 'method' && name !== 'body' && name !== 'headers' && name !== 'signal' && name !== 'redirect' && name !== 'cache') throw rejected();
    const row = descriptor(init, name);
    if (!row || !own(row, 'value') || !row.enumerable) throw rejected();
    data(captured, name, row.value);
  }
  if (captured.method !== 'POST' || captured.body !== body
    || own(captured, 'signal') && captured.signal !== signal
    || own(captured, 'redirect') && captured.redirect !== 'error'
    || own(captured, 'cache') && captured.cache !== 'no-store') throw rejected();
  const headers = captured.headers;
  if (!headers || typeof headers !== 'object' || isProxy(headers)
    || proto(headers) !== objectPrototype && proto(headers) !== null || keys(headers).length !== 2) throw rejected();
  const copiedHeaders = createPhysical(null) as Record<string, string>;
  for (const name of keys(headers)) {
    if (name !== brokerTokenHeader && name !== 'content-type') throw rejected();
    const row = descriptor(headers, name);
    if (!row || !own(row, 'value') || !row.enumerable || typeof row.value !== 'string') throw rejected();
    data(copiedHeaders, name, row.value);
  }
  if (!copiedHeaders[brokerTokenHeader] || copiedHeaders['content-type'] !== 'application/json') throw rejected();
  return {method: 'POST', body, signal, redirect: 'error', cache: 'no-store', headers: copiedHeaders};
}

/** One physical native HTTPS request. No redirects/retries; not an authorization issuer. */
export function createSingleRequestHttpsFetch(options: SingleRequestHttpsOptions): typeof globalThis.fetch {
  return createSingleRequestFetch(options, false);
}

/** Shared physical engine. The local-control selector is never a public option. */
function createSingleRequestFetch(options: SingleRequestHttpsOptions, brokerControl: boolean): typeof globalThis.fetch {
  const hooks = hooksAtBirth(options);
  const { destination: destinationInput, expectedBody, method: configuredMethod, signal, timeoutMs, maxResponseBytes, certificateAuthority: ca, trackPhysicalDrain,transportProfile } = options;
  const destination = new NativeURL(destinationInput);
  const modelStream=transportProfile==='model_stream_v1';
  if(transportProfile!==undefined&&!modelStream)throw rejected();
  if (destination.protocol !== 'https:' && (!(modelStream || brokerControl)||destination.protocol!=='http:') || destination.username || destination.password || destination.hash || destination.href !== destinationInput
    || typeof expectedBody !== 'string' || Buffer.byteLength(expectedBody) > (modelStream?64:16) * 1024 * 1024 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > (modelStream?2147483647:120000)
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > (modelStream?256:16) * 1024 * 1024) throw rejected();
  const expectedMethod = configuredMethod ?? 'POST';
  if (expectedMethod !== 'POST' && expectedMethod !== 'GET' || expectedMethod === 'GET' && expectedBody !== '') throw rejected();
  let claimed = false,resourceGate:ResourceGate|undefined;
  const owner = {};
  const execute: typeof globalThis.fetch = async (input, init) => {
    if (claimed) throw rejected(); claimed = true;
    if (brokerControl) init = captureBrokerInit(input, init, destination.href, expectedBody, signal);
    const tracked = brokerControl || !!hooks || !!resourceGate;
    if (input instanceof NativeRequest) throw rejected();
    const url = String(input), method = init?.method ?? 'GET';
    if (url !== destination.href || method !== expectedMethod) throw rejected();
    const signals: AbortSignal[] = []; if (signal) signals[signals.length] = signal; if (init?.signal) signals[signals.length] = init.signal;
    const combined = apply(signalAny, AbortSignal, [signals]) as AbortSignal;
    apply(signalThrow, combined, []);
    const body = expectedMethod === 'GET' && init?.body === undefined ? '' : init?.body;
    apply(signalThrow, combined, []); if (typeof body !== 'string' || body !== expectedBody) throw rejected();
    const headers = new NativeHeaders(init?.headers), protectedNames = ['host', 'content-length', 'transfer-encoding', 'connection', 'expect', 'upgrade'];
    for (let i = 0; i < protectedNames.length; i++) apply(deleteHeader, headers, [protectedNames[i]!]);
    apply(setHeader, headers, ['content-length', String(Buffer.byteLength(body))]);
    apply(setHeader, headers, ['accept-encoding', 'identity']); apply(setHeader, headers, ['connection', 'close']);
    return new NativePromise<Response>((resolve, reject) => {
      let request: ClientRequest | undefined, response: IncomingMessage | undefined, controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let done = false, bodyCancelled=false, received = 0, cleanupStarted = false, completion: Promise<void> | undefined, generation = 0, requestEntered = false;
      let requestClosed = resolved(), socketClosed = resolved(), responseClosed = resolved();
      const sdk = tracked ? createRoomTurnCustody() : undefined;
      const sdkResources: object[] = [], publicResources = createIntrinsicSet<object>();
      const nodeBirths = new NativeWeakMap<object, Map<PropertyKey, PropertyDescriptor>>();
      const accessorCandidates: { node: object; key: PropertyKey; row: PropertyDescriptor }[] = [];
      const sdkCalls: object[] = [];
      const observedSdkPromises = createIntrinsicSet<object>();
      const opaqueMarker = () => {};
      const localAbortErrors = new NativeWeakMap<object, PropertyDescriptor | undefined>();
      const scanningLocalErrors = createIntrinsicSet<object>();
      function transportAbort(message: string): DOMException {
        const error = new NativeDOMException(message, 'AbortError');
        apply(weakSet, localAbortErrors, [error, descriptor(error, 'stack')]);
        return error;
      }
      function inventoryFailure(raw: unknown): void {
        if (raw !== null && (typeof raw === 'object' || typeof raw === 'function')) {
          let held = false; for (let i = 0; i < sdkResources.length; i++) if (sdkResources[i] === raw) held = true;
          if (!held) data(sdkResources, nativeString(sdkResources.length), raw);
        }
        const birth = apply(weakGet, localAbortErrors, [raw]) as PropertyDescriptor | undefined;
        if (!birth || !raw || typeof raw !== 'object') {
          if (raw && typeof raw === 'object' && !isProxy(raw) && proto(raw) === nativeDomPrototype) opaqueSdk(raw);
          else sdk?.inventory(raw);
          return;
        }
        if (scanningLocalErrors.has(raw)) return;
        scanningLocalErrors.add(raw);
        try {
          const names = keys(raw);
          for (let i = 0; i < names.length; i++) {
            const key = names[i]!, row = descriptor(raw, key);
            if (key === 'stack' && row && !own(row, 'value') && !own(birth, 'value') && sameAccessor(birth, row)) {
              if (row.get) scanResources([row.get]);
              if (row.set) scanResources([row.set]);
            } else if (row && own(row, 'value')) sdk?.inventory(row.value);
            else { opaqueSdk(raw); if (row?.get) scanResources([row.get]); if (row?.set) scanResources([row.set]); }
          }
          const current = descriptor(raw, 'stack');
          if (!current || !own(birth, 'value') && !sameAccessor(birth, current)) opaqueSdk(raw);
        } finally { scanningLocalErrors.delete(raw); }
      }
      let graphDrain: Promise<void> | undefined;
      function opaqueSdk(raw: unknown): void {
        sdk?.inventory(raw);
        sdk?.inventory(opaqueMarker);
      }
      function sameAccessor(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
        return !own(b, 'value') && a.get === b.get && a.set === b.set
          && a.enumerable === b.enumerable && a.configurable === b.configurable;
      }
      // Fixed Node transport resources are not DTOs. Keep their original graph
      // and inventory data tails immediately, without reading any accessor.
      // An internal Native accessor is pending until the actual closed-resource
      // consumer proves that its node is no longer reachable from any of the
      // three original public transport roots. Public-root accessors never get
      // this treatment, even if the SDK later removes them.
      function scanResources(start: object[], final = false): void {
        const seen = createIntrinsicSet<object>(), work: { value: unknown; depth: number }[] = [];
        for (let i = 0; i < start.length; i++) data(work, nativeString(work.length), { value: start[i], depth: 0 });
        for (let i = 0; i < work.length; i++) {
          const { value, depth } = work[i]!;
          if (value === null || typeof value !== 'object' && typeof value !== 'function') continue;
          if (seen.has(value)) continue;
          seen.add(value);
          if (seen.size > 100000 || depth > 128 || isProxy(value)) { opaqueSdk(value); continue; }
          if (isPromise(value)) { observedSdkPromises.add(value); sdk?.inventory(value); continue; }
          if (isNativeError(value) || apply(weakGet, localAbortErrors, [value])) { inventoryFailure(value); continue; }
          let names: PropertyKey[];
          try { names = keys(value); } catch (error) { opaqueSdk(error); continue; }
          let birth = apply(weakGet, nodeBirths, [value]) as Map<PropertyKey, PropertyDescriptor> | undefined;
          const first = !birth;
          if (!birth) { birth = new NativeMap(); apply(weakSet, nodeBirths, [value, birth]); }
          if (isNativeMap(value) || isNativeSet(value)) {
            const iterator = apply(isNativeMap(value) ? mapEntries : setValues, value, []);
            for (;;) {
              const next = apply(isNativeMap(value) ? mapNext : setNext, iterator, []) as IteratorResult<unknown>;
              if (next.done) break;
              if (isNativeMap(value)) {
                const pair = next.value as [unknown, unknown];
                data(work, nativeString(work.length), { value: pair[0], depth: depth + 1 }); data(work, nativeString(work.length), { value: pair[1], depth: depth + 1 });
              } else data(work, nativeString(work.length), { value: next.value, depth: depth + 1 });
            }
          }
          for (let j = 0; j < names.length; j++) {
            const key = names[j]!;
            let row: PropertyDescriptor | undefined;
            try { row = descriptor(value, key); } catch (error) { opaqueSdk(error); continue; }
            if (!row) { opaqueSdk(value); continue; }
            const old = apply(mapGet, birth, [key]) as PropertyDescriptor | undefined;
            if (first) apply(mapSet, birth, [key, row]);
            if (own(row, 'value')) {
              if (old && !own(old, 'value')) opaqueSdk(value);
              data(work, nativeString(work.length), { value: row.value, depth: depth + 1 });
            } else {
              if (publicResources.has(value) || !first && (!old || !sameAccessor(old, row))) opaqueSdk(value);
              if (first) data(accessorCandidates, nativeString(accessorCandidates.length), { node: value, key, row });
              data(work, nativeString(work.length), { value: row.get, depth: depth + 1 }); data(work, nativeString(work.length), { value: row.set, depth: depth + 1 });
            }
          }
          // Removed/replaced accessor facts stay retained. Only a detached
          // original internal node can be consumed after all three real closes.
          const birthIterator = apply(mapEntries, birth, []);
          for (;;) {
            const next = apply(mapNext, birthIterator, []) as IteratorResult<[PropertyKey, PropertyDescriptor]>;
            if (next.done) break;
            const key = next.value[0], old = next.value[1];
            if (!own(old, 'value')) {
              const current = descriptor(value, key);
              if (!current || !sameAccessor(old, current)) opaqueSdk(value);
            }
          }
        }
        if (final) for (let i = 0; i < accessorCandidates.length; i++) {
          const candidate = accessorCandidates[i]!;
          if (seen.has(candidate.node)) opaqueSdk(candidate.node);
        }
      }
      function holdResource(value: unknown, publicRoot = false): void {
        if (!sdk || value === null || typeof value !== 'object' && typeof value !== 'function') return;
        let held = false; for (let i = 0; i < sdkResources.length; i++) if (sdkResources[i] === value) held = true;
        if (!held) data(sdkResources, nativeString(sdkResources.length), value);
        if (publicRoot) publicResources.add(value);
        scanResources([value]);
      }
      function resourceCall<T extends object>(fn: Function, receiver: unknown, args: unknown[], publicRoot = false): T {
        const call = createPhysical(null); data(sdkCalls, nativeString(sdkCalls.length), call);
        data(call, 'receiver', receiver); data(call, 'method', fn); data(call, 'args', args); holdResource(args); holdResource(fn);
        try {
          const raw = apply(fn, receiver, args) as T;
          data(call, 'raw', raw); holdResource(raw, publicRoot);
          if (publicRoot && (!raw || typeof raw !== 'object' || isProxy(raw))) throw rejected();
          return raw;
        } catch (error) { data(call, 'error', error); inventoryFailure(error); throw error; }
      }
      function callback(fn: Function): Function {
        if (!sdk) return fn;
        const wrapped = function(this: unknown, ...args: unknown[]): void {
          const call = createPhysical(null); data(sdkCalls, nativeString(sdkCalls.length), call);
          data(call, 'receiver', this); data(call, 'args', args); holdResource(args);
          try {
            holdResource(fn); holdResource(wrapped);
            const raw = apply(fn, this, args); data(call, 'raw', raw);
            if (raw !== undefined) { sdk.inventory(raw); secondary('sdk_callback_nonvoid', raw); }
          } catch (error) {
            data(call, 'error', error); inventoryFailure(error); secondary('sdk_callback', error);
            if (!done) void fail(rejected(), error);
          } finally { holdResource(fn); holdResource(wrapped); }
        };
        holdResource(fn); holdResource(wrapped); return wrapped;
      }
      function listen(fn: Function, receiver: object, name: string, listener: Function): void {
        resourceCall(fn, receiver, [name, callback(listener)]);
      }
      const failure: { primaryPresent: boolean; primary: unknown; secondary: { kind: string; raw: unknown }[]; unknown: boolean } = { primaryPresent: false, primary: undefined, secondary: [], unknown: false };
      const secondary = (kind: string, raw: unknown) => {
        inventoryFailure(raw);
        failure.unknown = true; data(failure.secondary, String(failure.secondary.length), { kind, raw });
        if (kind !== 'observer_throw' && kind !== 'observer_nonvoid') {
          if (!failure.primaryPresent) { failure.primaryPresent = true; failure.primary = raw; }
          if (kind !== 'sdk_inventory') observe(raw);
        }
      };
      const remember = (raw: unknown) => { inventoryFailure(raw); if (!failure.primaryPresent) { failure.primaryPresent = true; failure.primary = raw; } else data(failure.secondary, String(failure.secondary.length), { kind: 'transport_failure', raw }); };
      const observedFailures = createIntrinsicSet<unknown>();
      const observe = (raw: unknown) => {
        if (observedFailures.has(raw)) return; observedFailures.add(raw);
        if (hooks) try { const result = apply(hooks.observe, hooks.receiver, [raw]); if (result !== undefined) secondary('observer_nonvoid', result); }
        catch (error) { secondary('observer_throw', error); }
        if(resourceGate)try{const result=apply(resourceGate.observe,resourceGate.receiver,[raw]);if(result!==undefined)secondary('observer_nonvoid',result);}catch(error){secondary('observer_throw',error);}
      };
      const asSourceError = (ordinary: Error): Error => {
        if (!tracked) return ordinary;
        const error = new NativeError('SEMANTIC_SINGLE_REQUEST_SOURCE_FAILED');
        define(error, 'cause', { __proto__: null, value: failure, enumerable: false, configurable: true } as PropertyDescriptor);
        apply(weakSet, sourceFailures, [error, failure]);
        // This function runs only after the real drain. Its private receipt is
        // transport fate, independent of permission or monetary settlement.
        apply(weakSet,physicalReplies,[error,{fetch:execute,destination:destinationInput,method:expectedMethod,requestBody:expectedBody,status:0,known:()=>!failure.unknown}]);
        return error;
      };
      const drain = async () => {
        let before:number;
        do{before=generation;await requestClosed;await socketClosed;await responseClosed;}while(before!==generation);
        if(sdk){
          if (!graphDrain) graphDrain = (async () => {
            for (;;) {
              scanResources(sdkResources);
              scanResources(publicResources.snapshot(), true);
              for (let i = 0; i < accessorCandidates.length; i++) {
                const candidate = accessorCandidates[i]!, current = descriptor(candidate.node, candidate.key);
                if (!current || !sameAccessor(candidate.row, current)) opaqueSdk(candidate.node);
                if (candidate.row.get) scanResources([candidate.row.get]);
                if (candidate.row.set) scanResources([candidate.row.set]);
              }
              const before = observedSdkPromises.size + sdkCalls.length;
              await sdk.waitPhysicalKnown();
              scanResources(sdkResources);
              scanResources(publicResources.snapshot(), true);
              for (let i = 0; i < accessorCandidates.length; i++) {
                const candidate = accessorCandidates[i]!;
                if (candidate.row.get) scanResources([candidate.row.get]);
                if (candidate.row.set) scanResources([candidate.row.set]);
              }
              await sdk.waitKnown();
              if (before === observedSdkPromises.size + sdkCalls.length) break;
            }
          })();
          try{await graphDrain;}catch(raw){secondary('sdk_inventory',raw);}
        }
      };
      const closed = (handle: ClientRequest | IncomingMessage | import('node:net').Socket) => new NativePromise<void>(yes => {
        const listener = () => { try { apply(remove, handle, ['close', listener]); } catch (error) { secondary('cleanup_failure', error); } finally { yes(); } };
        listen(on,handle,'close',listener);
      });
      const clear = () => { try { clearTimer(timer); } catch (error) { secondary('cleanup_failure', error); }
        try { apply(removeAbort, combined, ['abort', abort]); } catch (error) { secondary('cleanup_failure', error); } };
      const destroy = () => {
        if (request) try { if (tracked) resourceCall(destroyRequest,request,[]); else request.destroy(); } catch (error) { secondary('request_destroy', error); }
        if (response) try { if (tracked) resourceCall(destroyResponse,response,[]); else response.destroy(); } catch (error) { secondary('response_destroy', error); }
      };
      const fail = (ordinary: Error, raw: unknown): Promise<void> | undefined => {
        remember(raw); observe(raw);
        if (cleanupStarted) return completion;
        cleanupStarted = true; done = true;
        // Observer failure is contained above. Every cleanup component still runs.
        let finish!: () => void; completion = new NativePromise<void>(yes => { finish = yes; });
        try { clear(); } finally {
          try { destroy(); } finally {
            const physical = drain();
            void follow(physical, () => {
              const error = asSourceError(ordinary);
              try { if (controller&&!bodyCancelled) apply(streamError, controller, [error]); } catch (caught) { secondary('cleanup_failure', caught); }
              reject(error); finish();
            }, error => { secondary('drain_failure', error); reject(asSourceError(ordinary)); finish(); });
          }
        }
        return completion;
      };
      const gate = (phase: 'connect' | 'send') => {
        if(resourceGate){const result=apply(resourceGate.before,resourceGate.receiver,[phase]);if(result!==undefined){failure.unknown=true;throw result;}}
        if (hooks) {
          const result = apply(hooks.before, hooks.receiver, [phase]);
          if (result !== undefined) { failure.unknown = true; throw result; }
        }
        if(resourceGate){const result=apply(resourceGate.after,resourceGate.receiver,[phase]);if(result!==undefined){failure.unknown=true;throw result;}}
        apply(signalThrow, combined, []);
        if (done) throw rejected();
      };
      const abort = () => { const error=transportAbort('Summary request aborted');void fail(error,error); };
      const timer = setTimer(() => { const error = new NativeError('SEMANTIC_SINGLE_REQUEST_TIMEOUT'); fail(error, error); }, timeoutMs);
      apply(addAbort, combined, ['abort', abort, { once: true }]);
      if (combined.aborted) { abort(); return; }
      try {
        const requestOptions: RequestOptions & Pick<ConnectionOptions, 'ALPNProtocols'> = {
          method: expectedMethod, headers: Object.fromEntries(headers), agent: false, ALPNProtocols: ['http/1.1'], rejectUnauthorized: true, ...(ca === undefined ? {} : { ca }),
        };
        gate('connect');
        requestEntered = true;
        request = resourceCall<ClientRequest>(destination.protocol==='https:'?requestNative:requestHttpNative,undefined,[destination, requestOptions, callback((incoming:IncomingMessage) => {
          response = incoming;resourceCall<IncomingMessage>(()=>incoming,undefined,[],true);responseClosed = closed(incoming); generation++;
          if (done) { try { apply(destroyResponse, incoming, []); } catch (error) { secondary('response_destroy', error); } return; }
          if (sdk) sdk.local();
          const status = incoming.statusCode ?? 0;
          if (status < 200 || status > 599 || incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') { const error = rejected(); fail(error, error); return; }
          const responseHeaders = new NativeHeaders();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) apply(appendHeader, responseHeaders, [incoming.rawHeaders[i], incoming.rawHeaders[i + 1]]);
          const stream = new NativeStream<Uint8Array>({ start(c) { controller = c; }, cancel() { bodyCancelled=true;const error = transportAbort('Summary response cancelled'); return fail(error, error); } });
          listen(incomingOn,incoming,'data',(chunk:Buffer)=>{
            if (done) return; received += chunk.byteLength;
            if (received > maxResponseBytes) { const error = new NativeError('SEMANTIC_SINGLE_RESPONSE_TOO_LARGE'); fail(error, error); return; }
            try { apply(streamEnqueue, controller, [new NativeBytes(chunk)]); } catch (error) { fail(rejected(), error); }
          });
          listen(incomingOn,incoming,'end',()=>{
            if (done) return; done = true; clear(); destroy();
            completion = follow(drain(), () => {
              try { if(!bodyCancelled){if (tracked && failure.unknown) apply(streamError, controller, [asSourceError(rejected())]); else apply(streamClose, controller, []);} }
              catch (error) { secondary('cleanup_failure', error); }
            });
          });
          listen(incomingOn,incoming,'error',(raw:unknown)=>{void fail(new NativeError('SEMANTIC_SINGLE_RESPONSE_INTERRUPTED'),raw);});
          listen(incomingOn,incoming,'aborted',()=>{const error=new NativeError('SEMANTIC_SINGLE_RESPONSE_INTERRUPTED');void fail(error,error);});
          try {
            const noBody = status === 204 || status === 205 || status === 304;
            const result = new NativeResponse(noBody ? null : stream, { status, headers: responseHeaders });
            const slots = new NativeMap<PropertyKey, PropertyDescriptor>(), names = keys(result);
            for (let i = 0; i < names.length; i++) apply(mapSet, slots, [names[i]!, descriptor(result, names[i]!)!]);
            apply(weakSet, ownedResponses, [result, { owner, slots, async drain(){await drain();if(completion)await completion;},known:()=>done&&!failure.unknown,diagnostic:()=>{const kinds:string[]=[];for(let i=0;i<failure.secondary.length;i++)kinds[i]=failure.secondary[i]!.kind;return{terminal:done,unknown:failure.unknown,secondaryKinds:kinds};} }]);
            if (noBody) void follow(drain(), () => { if (tracked && failure.unknown) reject(asSourceError(rejected())); else resolve(result); }); else resolve(result);
          } catch (error) { fail(rejected(), error); }
        })],true);
        requestClosed = closed(request); generation++;
        listen(on,request,'socket',(socket:import('node:net').Socket)=>{resourceCall(()=>socket,undefined,[],true);socketClosed=closed(socket);generation++;});
        listen(on,request,'error',(raw:unknown)=>{void fail(new NativeError('SEMANTIC_SINGLE_REQUEST_FAILED'),raw);});
        trackPhysicalDrain?.(drain());
        // Preserve the existing registration-after-abort check; the fixed gate repeats it.
        apply(signalThrow, combined, []); if (sdk) { scanResources(sdkResources); sdk.local(); } gate('send');
        if (tracked) resourceCall(nativeEnd,request,[body]); else request.end(body);
      } catch (error) { if(requestEntered&&!request)secondary('request_constructor_unconfirmed',error);fail(rejected(), error); }
    });
  };
  apply(weakSet,resourceGateSetters,[execute,(value:unknown)=>{if(claimed||resourceGate)throw rejected();resourceGate=captureResourceGate(value);}]);
  apply(weakSet, ownedFetches, [execute, owner]);
  apply(weakSet, fetchRequests,[execute,{destination:destinationInput,method:expectedMethod,requestBody:expectedBody}]);
  return execute;
}

/** Narrowing-only classification of this package's original error. Never an authority or successful-close proof. */
export function isSingleRequestSourceUnknown(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || isProxy(raw)) return false;
  const record = apply(weakGet, sourceFailures, [raw]) as { unknown: boolean } | undefined;
  return record?.unknown === true;
}

export interface SingleRequestOwnedReply {
  status: number; bytes: Uint8Array;
  headers: { etag: string | null; requestId: string | null; link: string | null; retryAfter: string | null; date:string|null };
  ownExtras: unknown[]; ownUnknown: boolean;
}
/** Original-instance custody and real body/close only. This marker grants neither A authority nor Native qualification. */
export async function readSingleRequestOwnedReply(fetch: typeof globalThis.fetch, raw: unknown): Promise<SingleRequestOwnedReply> {
  if (!raw || typeof raw !== 'object' || isProxy(raw)) throw rejected();
  const record = apply(weakGet, ownedResponses, [raw]) as OriginalResponseRecord | undefined;
  if (!record || apply(weakGet, ownedFetches, [fetch]) !== record.owner) throw rejected();
  const extras: unknown[] = []; let unknown = false;
  const inventory = () => {
    const names = keys(raw);
    for (let i = 0; i < names.length; i++) {
      const key = names[i]!, row = descriptor(raw, key), original = apply(mapGet, record.slots, [key]) as PropertyDescriptor | undefined;
      if (!row || !own(row, 'value')) { unknown = true; continue; }
      if (!original || !own(original, 'value') || row.value !== original.value) { data(extras, String(extras.length), row.value); unknown = true; }
    }
  };
  inventory();
  const status = apply(responseStatus, raw, []) as number, headers = apply(responseHeaders, raw, []) as Headers;
  const body = await apply(responseBytes, raw, []) as ArrayBuffer;
  await record.drain(); inventory();
  const result:SingleRequestOwnedReply = { status, bytes: new NativeBytes(body), headers: {
    etag: apply(headerGet, headers, ['etag']), requestId: apply(headerGet, headers, ['x-github-request-id']),
    link: apply(headerGet, headers, ['link']), retryAfter: apply(headerGet, headers, ['retry-after']),date:apply(headerGet,headers,['date']),
  }, ownExtras: extras, ownUnknown: unknown };
  const request=apply(weakGet,fetchRequests,[fetch]) as {destination:string;method:string;requestBody:string}|undefined;
  if(!request)throw rejected();apply(weakSet,physicalReplies,[result,{fetch,destination:request.destination,method:request.method,requestBody:request.requestBody,status,known:()=>!unknown&&record.known()}]);
  return result;
}

/** Membership only: no object properties, parser, or completion claim. */
export function isOriginalSingleRequestResponse(fetch:unknown,response:unknown):boolean {
 const record=apply(weakGet,ownedResponses,[response]) as OriginalResponseRecord|undefined;
 return !!record&&apply(weakGet,ownedFetches,[fetch])===record.owner;
}
/** Streaming SDKs already consume their body. Join the original request,
 * socket, response and terminal stream close; never read that body twice. */
export async function readOriginalSingleRequestStreamPhysicalReceipt(fetch:typeof globalThis.fetch,raw:unknown):Promise<object> {
 const failed=apply(weakGet,physicalReplies,[raw]) as OriginalPhysicalReply|undefined;
 if(failed){if(failed.fetch!==fetch)throw rejected();readOriginalSingleRequestPhysicalReceipt(raw).assertKnown();return raw as object;}
 const record=apply(weakGet,ownedResponses,[raw]) as OriginalResponseRecord|undefined;
 if(!record||apply(weakGet,ownedFetches,[fetch])!==record.owner)throw rejected();
 const request=apply(weakGet,fetchRequests,[fetch]) as {destination:string;method:string;requestBody:string}|undefined;
 if(!request)throw rejected();
 let unknown=false;
 const inventory=()=>{
  const names=keys(raw as object);
  for(let i=0;i<names.length;i++){
   const name=names[i]!,row=descriptor(raw as object,name),baseline=apply(mapGet,record.slots,[name]) as PropertyDescriptor|undefined;
   if(!row||!baseline||!own(row,'value')||!own(baseline,'value')||row.value!==baseline.value||row.writable!==baseline.writable||row.configurable!==baseline.configurable||row.enumerable!==baseline.enumerable)unknown=true;
  }
  if(names.length!==apply(mapSize,record.slots,[]))unknown=true;
 };
 inventory();await record.drain();inventory();
 if(unknown)throw new NativeError('SINGLE_REQUEST_RESPONSE_CHANGED');
 if(!record.known())throw new NativeError('SINGLE_REQUEST_STREAM_CLOSE_UNCONFIRMED',{cause:record.diagnostic()});
 const receipt=freezePhysical(createPhysical(null)) as object;
 const assertKnown=()=>{inventory();return !unknown&&record.known();};
 apply(weakSet,physicalReplies,[receipt,{fetch,destination:request.destination,method:request.method,requestBody:request.requestBody,status:apply(responseStatus,raw,[]),known:assertKnown}]);
 readOriginalSingleRequestPhysicalReceipt(receipt).assertKnown();return receipt;
}
