import {types} from 'node:util';

const descriptor = Object.getOwnPropertyDescriptor;
const own = Object.hasOwn;
const isProxy = types.isProxy;

function combine(primary: {raw: unknown} | undefined, cleanup: unknown): never {
  if (!primary) throw cleanup;
  // Preserve a fixed cleanup aggregate already carrying the exact first cause.
  if (cleanup && typeof cleanup === 'object' && !isProxy(cleanup)) {
    const cause = descriptor(cleanup, 'cause');
    if (cause && own(cause, 'value') && cause.value === primary.raw) throw cleanup;
  }
  throw new AggregateError([primary.raw, cleanup], 'decision_primary_and_cleanup', {cause: primary.raw});
}

export async function withDecisionCleanup<T>(
  work: () => Promise<T>, cleanup: () => Promise<void>,
): Promise<T> {
  let result!: T;
  let first: {raw: unknown} | undefined;
  try { result = await work(); } catch (raw) { first = {raw}; }
  try { await cleanup(); } catch (raw) { combine(first, raw); }
  if (first) throw first.raw;
  return result;
}

export function withDecisionSyncCleanup<T>(work: () => T, cleanup: () => void): T {
  let result!: T;
  let first: {raw: unknown} | undefined;
  try { result = work(); } catch (raw) { first = {raw}; }
  try { cleanup(); } catch (raw) { combine(first, raw); }
  if (first) throw first.raw;
  return result;
}
