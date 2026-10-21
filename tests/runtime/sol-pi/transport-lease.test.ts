import { describe, expect, it, vi } from 'vitest';
import {
  createTransportLeaseIssuer,
  isTransportAuthorizationError,
} from '../../../src/runtime/sol-pi/transport-lease.js';

const destination = 'https://provider.example/v1/chat/completions';
const body = '{"model":"frozen","messages":[{"role":"user","content":"material"}]}';

// Simulates only the existing service serialization port, not the tested algorithm.
function ownerFixture() {
  const authority = {};
  const listeners = new Set<() => void>();
  let valid = true;
  let inside = false;
  const port = {
    authority,
    withAdmission<T>(operation: () => T): T {
      inside = true;
      try { return operation(); } finally { inside = false; }
    },
    validate: vi.fn(() => { if (!valid) throw new Error("revoked"); }),
    onRevoke(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const issuer = createTransportLeaseIssuer(port);
  const dependencies = [{ authority, key: 'observation:1:policy:scope:grant', epoch: 1 }];
  const issue = () => issuer.issue({ invocationId: 'inv-1', destination, serializedBody: body, dependencies });
  const request = () => ({ invocationId: 'inv-1', input: destination, init: { method: 'POST', body } });
  return { issuer, issue, request, dependencies, port,
    inside: () => inside,
    revoke() { valid = false; for (const notify of [...listeners]) notify(); },
  };
}

function terminal(operation: () => unknown) {
  try { operation(); throw new Error('EXPECTED_TERMINAL_REJECTION'); }
  catch (error) { expect(isTransportAuthorizationError(error)).toBe(true); }
}

describe('single-authority transport lease', () => {
  it('waits for physical response and factual finish without cancelling a live issuer', async () => {
    const f=ownerFixture();let respond!:(response:Response)=>void,signal:AbortSignal|undefined;
    const attempt=f.issuer.dispatch(f.issue(),f.request(),(_url:string,init:RequestInit)=>{
      signal=init.signal!;return new Promise<Response>(resolve=>{respond=resolve;});
    });
    let drained=false;const drain=f.issuer.waitForDrain().then(()=>{drained=true;});
    attempt.finish();await Promise.resolve();expect(drained).toBe(false);expect(signal?.aborted).toBe(false);
    respond(new Response(null));await attempt.response;await drain;expect(drained).toBe(true);
    const next=f.issuer.dispatch(f.issue(),f.request(),()=>Promise.resolve(new Response(null)));
    await next.response;next.finish();await f.issuer.waitForDrain();
  });
  it('keeps pending durable admission in owner drain before a physical send exists', async () => {
    const f=ownerFixture(),cap=f.issue();
    const hold=f.issuer.holdAdmission(cap,'inv-1');
    let drained=false;const pending=f.issuer.disposeAndDrain().then(()=>{drained=true;});
    expect(hold.signal.aborted).toBe(true);await Promise.resolve();expect(drained).toBe(false);
    terminal(()=>f.issuer.dispatch(cap,f.request(),async()=>new Response('must not send')));
    hold.finish();hold.finish();await pending;expect(drained).toBe(true);
  });
  it('pending admission validates the exact invocation and aborts immediately on real authority revoke', () => {
    const f=ownerFixture(),cap=f.issue();
    terminal(()=>f.issuer.holdAdmission({} as never,'inv-1'));
    terminal(()=>f.issuer.holdAdmission(cap,'other'));
    const hold=f.issuer.holdAdmission(f.issue(),'inv-1');f.revoke();expect(hold.signal.aborted).toBe(true);hold.finish();f.issuer.dispose();
  });
  it('calls transport synchronously within the same admission boundary; forbids redirects', async () => {
    const f = ownerFixture();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      expect(f.inside()).toBe(true);
      expect(init.redirect).toBe('error');
      expect(init.body).toBe(body);
      return Promise.resolve(new Response('ok'));
    });
    const attempt = f.issuer.dispatch(f.issue(), f.request(), fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no microtask between check and fetch
    await attempt.response;
    attempt.finish(); attempt.finish();
  });

  it('gives every SDK retry a new attempt and checks current authority each time', async () => {
    const f = ownerFixture(); const cap = f.issue();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(new Response('ok'));
    const first = f.issuer.dispatch(cap, f.request(), fetchImpl);
    await expect(first.response).rejects.toThrow('network'); first.finish();
    const validations = f.port.validate.mock.calls.length;
    const second = f.issuer.dispatch(cap, f.request(), fetchImpl);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(f.port.validate.mock.calls.length).toBeGreaterThan(validations);
    await second.response; second.finish();
    f.revoke(); terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('aborts after headers while body is in flight, and blocks every later retry', async () => {
    const f = ownerFixture(); const cap = f.issue(); let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!; return Promise.resolve(new Response('stream'));
    });
    const attempt = f.issuer.dispatch(cap, f.request(), fetchImpl);
    await attempt.response;
    expect(signal?.aborted).toBe(false);
    f.revoke(); expect(signal?.aborted).toBe(true);
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    attempt.finish(); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('registers cancellation before invoking transport, including synchronous revocation', async () => {
    const f = ownerFixture(); let signal: AbortSignal | undefined;
    const attempt = f.issuer.dispatch(f.issue(), f.request(), (_url: string, init: RequestInit) => {
      signal = init.signal!; f.revoke(); return Promise.resolve(new Response());
    });
    expect(signal?.aborted).toBe(true); await attempt.response; attempt.finish();
  });

  it('rejects revocation before first dispatch without touching transport', () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    f.revoke(); terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects forged, cloned, foreign issuer and cross-invocation capabilities', () => {
    const f = ownerFixture(); const other = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    for (const impostor of [{}, structuredClone(cap), other.issue()]) {
      terminal(() => f.issuer.dispatch(impostor as typeof cap, f.request(), fetchImpl));
    }
    terminal(() => f.issuer.dispatch(cap, { ...f.request(), invocationId: 'inv-2' }, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('binds the exact destination and serialized actual body, including cached input changes', () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    terminal(() => f.issuer.dispatch(cap, { ...f.request(), input: 'https://other.example/v1/chat/completions' }, fetchImpl));
    terminal(() => f.issuer.dispatch(cap, { ...f.request(), init: { method: 'POST', body: body.replace('material', 'cached-old-material') } }, fetchImpl));
    terminal(() => f.issuer.dispatch(cap, { ...f.request(), init: { method: 'GET', body } }, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([undefined, new Uint8Array([1]), new URLSearchParams('x=y'), new ReadableStream()])('rejects unknown/nonserialized body %s', (unknownBody) => {
    const f = ownerFixture(); const fetchImpl = vi.fn();
    const request = { ...f.request(), init: { method: 'POST', body: unknownBody } };
    terminal(() => f.issuer.dispatch(f.issue(), request as unknown as ReturnType<typeof f.request>, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects Request input whose actual body might differ', () => {
    const f = ownerFixture(); const fetchImpl = vi.fn();
    const request = { ...f.request(), input: new Request(destination, { method: 'POST', body: 'other' }) };
    terminal(() => f.issuer.dispatch(f.issue(), request as unknown as ReturnType<typeof f.request>, fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects multi-authority dependencies rather than copying their epochs', () => {
    const f = ownerFixture();
    terminal(() => f.issuer.issue({ invocationId: 'inv-1', destination, serializedBody: body,
      dependencies: [...f.dependencies, { authority: {}, key: 'room-grant', epoch: 1 }] }));
  });

  it('fails closed if authority lookup becomes unavailable', () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    f.port.validate.mockImplementation(() => { throw new Error('owner unavailable'); });
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    f.port.validate.mockImplementation(() => {});
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl)); // old invocation stays terminal
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('freezes dependency snapshots rather than trusting caller mutations', async () => {
    const f = ownerFixture(); const cap = f.issue();
    f.dependencies[0]!.epoch = 99;
    const attempt = f.issuer.dispatch(cap, f.request(), () => Promise.resolve(new Response()));
    const last = f.port.validate.mock.calls.at(-1) as unknown as [Array<{ epoch: number }>, string];
    expect(last[0][0]!.epoch).toBe(1);
    expect(last[1]).toBe(destination);
    await attempt.response; attempt.finish();
  });

  it('rejects missing dependencies instead of treating unknown provenance as public', () => {
    const f = ownerFixture();
    terminal(() => f.issuer.issue({ invocationId: 'inv-1', destination, serializedBody: body, dependencies: [] }));
  });

  it('rejects asynchronous validation without sending', () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    f.port.validate.mockImplementation((() => Promise.resolve()) as unknown as () => void);
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects asynchronous admission and makes delayed callbacks inert', async () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn();
    f.port.withAdmission = ((operation: () => unknown) => Promise.resolve().then(operation)) as typeof f.port.withAdmission;
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    await Promise.resolve(); await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not send twice if a broken admission port invokes its callback twice', async () => {
    const f = ownerFixture(); const cap = f.issue(); const fetchImpl = vi.fn(() => Promise.resolve(new Response()));
    f.port.withAdmission = ((operation: () => unknown) => { operation(); return operation(); }) as typeof f.port.withAdmission;
    terminal(() => f.issuer.dispatch(cap, f.request(), fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispose aborts active attempts, unregisters owner listener and closes issuer', async () => {
    const f = ownerFixture(); const cap = f.issue(); let signal: AbortSignal | undefined;
    const attempt = f.issuer.dispatch(cap, f.request(), (_url: string, init: RequestInit) => {
      signal = init.signal!; return Promise.resolve(new Response());
    });
    f.issuer.dispose(); f.issuer.dispose();
    expect(signal?.aborted).toBe(true);
    terminal(() => f.issue());
    terminal(() => f.issuer.dispatch(cap, f.request(), vi.fn()));
    await attempt.response; attempt.finish();
  });

  it('preserves caller cancellation and never dispatches an already cancelled call', () => {
    const f = ownerFixture(); const fetchImpl = vi.fn(); const abort = new AbortController(); abort.abort();
    expect(() => f.issuer.dispatch(f.issue(), { ...f.request(), init: { method: 'POST', body, signal: abort.signal } }, fetchImpl)).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

it('cannot report drain while an aborted actual fetch has not settled, even if finish was called', async () => {
  const f = ownerFixture(); let resolve!: (response: Response) => void;
  const attempt = f.issuer.dispatch(f.issue(), f.request(), () => new Promise<Response>(done => { resolve = done; }));
  let drained = false;
  const draining = f.issuer.disposeAndDrain().then(() => { drained = true; });
  attempt.finish(); await Promise.resolve(); expect(drained).toBe(false);
  resolve(new Response(null)); await attempt.response; await draining;
  expect(drained).toBe(true); terminal(() => f.issue());
});
