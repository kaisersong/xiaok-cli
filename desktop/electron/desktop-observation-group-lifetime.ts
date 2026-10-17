import type { ToolRegistry } from '../../src/ai/tools/index.js';
import { getObservationSessionOwnerHostBinding, type ObservationSessionOwner } from '../../src/runtime/sol-pi/observation-session-owner.js';
import { createTransportAuthorizationError } from '../../src/runtime/sol-pi/transport-lease.js';

/** Main-owned lifetime/serialization primitive. It does not authorize a Desktop
 * actor, persist group membership, or qualify an OS sandbox. Actual callers must
 * still bind the service actor and exact store before entering these callbacks. */
export function createDesktopObservationGroupLifetime(input: {
  owner: ObservationSessionOwner; registry: ToolRegistry; dispose(): void | Promise<void>;
}) {
  const host = getObservationSessionOwnerHostBinding(input.owner);
  input.owner.assertSession(host.session);
  const permission = input.registry.getObservationPermissionRevisionPort(), revision = permission.getRevision();
  const controller = new AbortController(), children = new Set<Promise<unknown>>(), retired = new WeakSet<ToolRegistry>();
  let tail: Promise<void> = Promise.resolve(), paused = false, closed = false;
  let disposal: Promise<void> | undefined;
  const revoke = () => {
    if (closed) return;
    closed = true;
    controller.abort(createTransportAuthorizationError());
    input.owner.dispose();
  };
  const unsubscribeOwner = host.onDispose(revoke);
  const unsubscribePermission = permission.onRevisionChanged(revoke);
  const assertCurrent = () => {
    if (closed || permission.getRevision() !== revision) { revoke(); throw createTransportAuthorizationError(); }
    input.owner.assertSession(host.session);
  };
  return Object.freeze({
    signal: controller.signal,
    runRootTurn<T>(registry: ToolRegistry, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const current = tail.then(async () => {
        assertCurrent(); signal.throwIfAborted();
        if (retired.has(registry)) { revoke(); throw createTransportAuthorizationError(); }
        retired.add(registry);
        const next = registry.getObservationPermissionRevisionPort();
        if (next.authority !== permission.authority || next.getRevision() !== revision) {
          revoke(); throw createTransportAuthorizationError();
        }
        if (paused) { host.resumeTransport(); paused = false; }
        const bound = AbortSignal.any([controller.signal, signal]);
        try { return await work(bound); }
        finally {
          // Per-turn cancellation retires only root transport. Children hold
          // their independent owners and are not tied to the first root signal.
          if (closed) await host.drainTransport();
          else { await host.pauseTransport(); paused = true; }
        }
      });
      tail = current.then(() => {}, () => {});
      return current;
    },
    holdPreparation() {
      assertCurrent();let release!:()=>void;let released=false;
      const pending=new Promise<void>(resolve=>{release=resolve;});children.add(pending);
      return Object.freeze({signal:controller.signal,release(){if(released)return;released=true;children.delete(pending);release();}});
    },
    runChild<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      assertCurrent();
      const pending = Promise.resolve().then(() => { assertCurrent(); return work(controller.signal); });
      children.add(pending);
      void pending.finally(() => children.delete(pending)).catch(() => {});
      return pending;
    },
    revoke,
    dispose(): Promise<void> {
      if (disposal) return disposal;
      revoke();
      disposal = (async () => {
        await tail;
        await Promise.allSettled([...children]);
        await host.drainTransport();
        unsubscribePermission(); unsubscribeOwner();
        await input.dispose();
      })();
      return disposal;
    },
  });
}
