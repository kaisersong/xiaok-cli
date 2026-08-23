/**
 * Provider runtime core types (design v58 §3.1–§3.4).
 *
 * Pure logic only: this module must not import Electron or Desktop runtime
 * types. Desktop main owns the single instance; the CLI does not use it yet.
 */

/** Stable component id + non-reusable generation id. */
export interface ComponentInstanceKey {
  readonly componentId: string;
  readonly generationId: string;
}

export function componentInstanceKeyOf(componentId: string, generationId: string): ComponentInstanceKey {
  return Object.freeze({ componentId, generationId });
}

export function sameComponentInstance(a: ComponentInstanceKey, b: ComponentInstanceKey): boolean {
  return a.componentId === b.componentId && a.generationId === b.generationId;
}

/** Every generation/invocation-owned resource returns one of these (§3.3). */
export interface EffectHandle {
  readonly owner: ComponentInstanceKey;
  readonly kind: string;
  readonly resourceId: string;
  dispose(): void | Promise<void>;
}

export interface EffectDisposeFailure {
  readonly kind: string;
  readonly resourceId: string;
  readonly error: Error;
}

export interface EffectScopeDisposeResult {
  readonly disposed: number;
  readonly failures: readonly EffectDisposeFailure[];
  readonly durationMs: number;
}

export type ProviderSlotState =
  | 'preparing'
  | 'committed'
  | 'retiring'
  | 'failed';

export type LeaseAbortSource = 'none' | 'caller' | 'runtime';

/** §3.4 lease phases. `finalizing` is protected from abort/force-revoke. */
export type LeasePhase = 'executing' | 'finalizing' | 'settled';

export interface ProviderInvocationLease<T> {
  readonly leaseId: string;
  readonly provider: ComponentInstanceKey;
  readonly generationId: string;
  readonly value: T;
  readonly signal: AbortSignal;
  /** Getter backed by the mutable lease record; freezes on first abort. */
  readonly abortSource: LeaseAbortSource;
  readonly phase: LeasePhase;
  registerInvocationHandle(handle: EffectHandle): void;
  /**
   * Marks the gateway result as parsed, entering protected host finalization.
   * Returns false when the runtime already closed the transition gate.
   */
  beginFinalizing(): boolean;
  release(): void;
}

export class ProviderUnavailableError extends Error {
  readonly code = 'provider_unavailable';

  constructor(message = 'provider_unavailable') {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderUnavailableRetryError extends Error {
  readonly code = 'provider_unavailable_retry';

  constructor(message = 'provider_unavailable_retry') {
    super(message);
    this.name = 'ProviderUnavailableRetryError';
  }
}

/** Canonical caller cancellation, rebuilt by gateways from a frozen abortSource. */
export function canonicalAbortError(reason = 'The operation was aborted'): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(reason, 'AbortError');
  }
  const error = new Error(reason);
  error.name = 'AbortError';
  return error;
}

export function isAbortErrorLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
