import { createHash } from 'node:crypto';
import {releaseCompoundPublicationHandoff} from './compound-publication-producer.js';
import { CompoundProviderAdmissionError, getProviderAncestorAdmissionBinding, type ProviderAncestorAdmission, type ProviderAncestorAttempt, type ProviderAncestorAttemptFacts, type ProviderAncestorAdmissionBinding } from './compound-provider-admission.js';
import type { ObservationDestination } from './observation-service.js';
import { createTransportAuthorizationError, isTransportAuthorizationError,
  type TransportCapability, type TransportDependency, type createTransportLeaseIssuer } from './transport-lease.js';
import { checkRequestCapacity, type VerifiedCapacityProfile } from './capacity-admission.js';
import { assertSynchronousFullSendResult, type FullSendCounterPort, type FullSendAttempt } from './full-send-counter.js';

interface FullSendBinding { counter: FullSendCounterPort; observationIds: readonly string[] }

export interface ProviderDisclosureContext { readonly opaqueProviderDisclosure: never }
interface AncestorBinding { capability: ProviderAncestorAdmission; destination: ObservationDestination; closureDigest: string }
interface State {
  ancestor?: Readonly<AncestorBinding & { port: ProviderAncestorAdmissionBinding }>;
  physicalIndex: number;
  admissionPending: boolean;
  expectedSerializedBody?: string;
  capacityProfile?: VerifiedCapacityProfile;
  fullSend?: FullSendBinding;
  issuer: ReturnType<typeof createTransportLeaseIssuer>;
  invocationId: string;
  destination: string;
  model: string;
  dependencies: readonly TransportDependency[];
  controller: AbortController;
  terminal?: Error;
  capability?: TransportCapability;
  fetch?: typeof fetch;
  active: Set<() => void>;
}
const states = new WeakMap<object, State>();
function state(context: ProviderDisclosureContext): State {
  const value = context && states.get(context);
  if (!value) throw createTransportAuthorizationError();
  return value;
}
function reject(value: State): Error {
  value.terminal ??= createTransportAuthorizationError();
  value.controller.abort(value.terminal);
  return value.terminal;
}
export function createProviderDisclosureContext(input: {
  ancestorAdmission?: AncestorBinding;
  /** Host-built exact wire bytes bound to projection and full-send IDs. */
  expectedSerializedBody?: string;
  capacityProfile?: VerifiedCapacityProfile;
  fullSend?: FullSendBinding;
  issuer: ReturnType<typeof createTransportLeaseIssuer>; invocationId: string;
  destination: string; model: string; dependencies: readonly TransportDependency[];
}): ProviderDisclosureContext {
  const supplied = input.ancestorAdmission;
  let ancestor: State['ancestor'];
  if (supplied) {
    try {
      const { capability, destination, closureDigest } = supplied;
      const target = Object.freeze({ ...destination });
      if (target.url !== input.destination || target.model !== input.model || !target.provider || !/^[a-f0-9]{64}$/.test(closureDigest)) throw createTransportAuthorizationError();
      ancestor = Object.freeze({ capability, destination: target, closureDigest, port: getProviderAncestorAdmissionBinding(capability) });
    } catch { throw createTransportAuthorizationError(); }
  }
  const context = Object.freeze(Object.create(null)) as ProviderDisclosureContext;
  states.set(context, { ...input, ancestor, physicalIndex: 0, admissionPending: false, dependencies: Object.freeze(input.dependencies.map(dep => Object.freeze({ ...dep }))),
    fullSend: input.fullSend && Object.freeze({ counter: input.fullSend.counter, observationIds: Object.freeze([...input.fullSend.observationIds]) }),
    controller: new AbortController(), active: new Set() });
  return context;
}
export function getProviderDisclosureSignal(context: ProviderDisclosureContext): AbortSignal { return state(context).controller.signal; }
export function assertProviderDisclosureActive(context: ProviderDisclosureContext): void {
  const value = state(context); if (value.terminal) throw value.terminal;
}
export function disposeProviderDisclosureContext(context: ProviderDisclosureContext): void {
  const value = state(context); reject(value);
  // Actual fetch/cancel settlement releases leases; abort alone is not drain.
}

export function createProviderDisclosureFetch(context: ProviderDisclosureContext, rawFetch: typeof fetch): typeof fetch {
  const value = state(context);
  if (value.fetch) return value.fetch;
  const guarded: typeof fetch = async (input, supplied) => {
    assertProviderDisclosureActive(context);
    const init = { ...supplied };
    try {
      if (value.expectedSerializedBody !== undefined && (typeof value.expectedSerializedBody !== 'string' || init.body !== value.expectedSerializedBody)) throw reject(value);
      if (typeof input !== 'string' || input !== value.destination || init.method !== 'POST' || typeof init.body !== 'string') throw reject(value);
      const parsed: unknown = JSON.parse(init.body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { model?: unknown }).model !== value.model) throw reject(value);
      checkRequestCapacity(value.capacityProfile, { destination: value.destination, model: value.model, serializedBody: init.body });
      if (value.ancestor && (value.admissionPending || value.physicalIndex >= 3)) throw reject(value);
    } catch (error) {
      if (isTransportAuthorizationError(error) && error instanceof Error) value.terminal ??= error;
      throw reject(value);
    }
    const ancestor = value.ancestor;
    if (ancestor) value.admissionPending = true;
    const fullSendAttempt: FullSendAttempt | undefined = value.fullSend && { logicalInvocationId: value.invocationId,
      serializedBody: init.body as string, observationIds: value.fullSend.observationIds };
    const callCounter = (operation: () => void) => {
      try { assertSynchronousFullSendResult(operation()); }
      catch (cause) {
        if (!value.terminal) { value.terminal = createTransportAuthorizationError(); value.terminal.message += ':FULL_SEND_COUNTER_REJECTED'; value.terminal.cause = cause; }
        throw reject(value);
      }
    };
    let receivedResponse: Response | undefined, dispatchStarted = false;
    let transportSignal: AbortSignal | undefined;
    let pendingHold: ReturnType<State['issuer']['holdAdmission']> | undefined;
    let attempt: ReturnType<State['issuer']['dispatch']> | undefined;
    let ticket: ProviderAncestorAttempt | undefined;
    let facts: ProviderAncestorAttemptFacts | undefined;
    let consumed = false, reservationFailed = false, reservationUnconfirmed = false;
    let settlement: Promise<void> | undefined;
    const onAbort = () => { if (isTransportAuthorizationError(transportSignal?.reason)) reject(value); };
    const finish = (unknown = false): Promise<void> => settlement ??= (async () => {
      try {
        if (ticket) await ancestor!.port.settle(ticket, unknown ? 'unknown' : consumed ? 'drained' : 'cancelled_before_send');
        // Unknown reservation/durable facts never masquerade as successful drain.
        if (ancestor && (unknown || reservationUnconfirmed)) { reject(value); return; }
        transportSignal?.removeEventListener('abort', onAbort);
        attempt?.finish(); pendingHold?.finish(); value.active.delete(release);
        value.admissionPending = false;
      } catch (cause) { value.terminal ??= createTransportAuthorizationError(); value.terminal.cause = cause; throw reject(value); }
    })();
    const release = () => { void finish().catch(() => {}); };
    try {
      value.capability ??= value.issuer.issue({ invocationId: value.invocationId, destination: value.destination,
        serializedBody: init.body as string, dependencies: value.dependencies });
      if (fullSendAttempt) callCounter(() => value.fullSend!.counter.prepare(fullSendAttempt));
      if (ancestor) {
        pendingHold = value.issuer.holdAdmission(value.capability, value.invocationId);
        const signal = AbortSignal.any([pendingHold.signal, value.controller.signal, ...(init.signal ? [init.signal] : [])]);
        facts = Object.freeze({ logicalInvocationId: value.invocationId, attemptIndex: value.physicalIndex++ as 0|1|2,
          serializedBodySha256: createHash('sha256').update(init.body as string).digest('hex'), destination: ancestor.destination, closureDigest: ancestor.closureDigest });
        try { ticket = await ancestor.port.reserve({ ...facts, signal }); }
        catch (error) { reservationFailed = true; reservationUnconfirmed = !(error instanceof CompoundProviderAdmissionError && error.undeliveredState !== 'unconfirmed'); throw error; }
      }
      attempt = value.issuer.dispatch(value.capability, { invocationId: value.invocationId, input: input as string,
        init: { ...init, signal: AbortSignal.any([value.controller.signal, ...(init.signal ? [init.signal] : []), ...(pendingHold ? [pendingHold.signal] : [])]) } },
      (url, actualInit) => {
        transportSignal = actualInit.signal!;
        transportSignal.addEventListener('abort', onAbort, { once: true });
        if (ticket) { ancestor!.port.consume(ticket, facts!); consumed = true;releaseCompoundPublicationHandoff(ancestor!.capability,ticket,facts!); }
        dispatchStarted = true;
        return rawFetch(url, actualInit);
      });
      value.active.add(release);
      const response = receivedResponse = await attempt.response;
      transportSignal?.throwIfAborted();
      if (fullSendAttempt) {
        if (response.ok) callCounter(() => value.fullSend!.counter.confirm(fullSendAttempt));
        else callCounter(() => value.fullSend!.counter.markUnknown(fullSendAttempt));
      }
      if (!response.body) { await finish(); return response; }
      const reader = response.body.getReader();
      let onBodyAbort: (() => void) | undefined;
      let cancellation: Promise<void> | undefined;
      const complete = async () => {
        if (onBodyAbort) transportSignal?.removeEventListener('abort', onBodyAbort);
        if (cancellation) { try { await cancellation; } catch { await finish(Boolean(ancestor)); return; } }
        await finish();
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          onBodyAbort = () => { controller.error(transportSignal?.reason); cancellation = reader.cancel(transportSignal?.reason); void complete().catch(() => {}); };
          transportSignal?.addEventListener('abort', onBodyAbort, { once: true });
          if (transportSignal?.aborted) onBodyAbort();
        },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { await complete(); controller.close(); } else controller.enqueue(chunk.value);
          } catch (error) { controller.error(error); cancellation ??= reader.cancel(error); await complete(); }
        },
        async cancel(reason) { cancellation = reader.cancel(reason); try { await cancellation; } finally { await complete(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (dispatchStarted && fullSendAttempt) {
        try { callCounter(() => value.fullSend!.counter.markUnknown(fullSendAttempt)); } catch { /* Original failure and sticky counter uncertainty remain. */ }
      }
      let cancellationUncertain = false;
      if (receivedResponse?.body) {
        if (receivedResponse.body.locked) cancellationUncertain = true;
        else { try { await receivedResponse.body.cancel(error); } catch { cancellationUncertain = true; } }
      }
      await finish(Boolean(ancestor) && cancellationUncertain);
      transportSignal?.removeEventListener('abort', onAbort);
      if (reservationFailed || ancestor && !dispatchStarted || isTransportAuthorizationError(error)) throw reject(value);
      assertProviderDisclosureActive(context); throw error;
    }
  };
  value.fetch = guarded; return guarded;
}
