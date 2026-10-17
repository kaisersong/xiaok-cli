import type { DesktopGoalCoordinator } from './desktop-goal-coordinator.js';
import type { SqliteGoalStore } from './goal-store-sqlite.js';
import type { DurableStoreOwner, IngressOwner } from './desktop-shutdown-coordinator.js';

/** The same Goal owner feeds both shutdown phases; an elapsed deadline never closes its DB. */
export function createDesktopGoalShutdownOwner(coordinator: DesktopGoalCoordinator, store: SqliteGoalStore): Readonly<{
  ingress: IngressOwner; durable: DurableStoreOwner;
}> {
  const stop = coordinator.stopAccepting.bind(coordinator);
  const drain = coordinator.drainShutdown.bind(coordinator);
  const close = store.close.bind(store);
  let closed = false;
  return Object.freeze({
    ingress: Object.freeze({ name: 'goals', stopAccepting: stop, abortAllActive: () => stop(), drain }),
    durable: Object.freeze({ name: 'goals', async close() {
      if (closed) return;
      if (!await drain(0)) throw Error('goal_shutdown_not_drained');
      close(); closed = true;
    } }),
  });
}
