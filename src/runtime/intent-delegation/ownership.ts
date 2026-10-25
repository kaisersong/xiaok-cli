import type { StoredSessionIntentLedgerInput, NormalizedStoredSessionIntentLedger } from './stored-intent-clone.js';
import type { SessionIntentLedger, TakeoverSessionOptions } from './types.js';
import { cloneSessionIntentLedger, resolveActiveRiskTier } from './types.js';

export function markSessionOwned(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export function markSessionOwned(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
export function markSessionOwned(
  ledger: StoredSessionIntentLedgerInput,
  instanceId: string,
  now = Date.now(),
): NormalizedStoredSessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const currentOwner = next.ownership.ownerInstanceId;
  const previousOwner = next.ownership.previousOwnerInstanceId;

  if (currentOwner && currentOwner !== instanceId && next.ownership.state !== 'released') {
    throw new Error(`session already owned by ${currentOwner}`);
  }
  if (next.ownership.state === 'released' && previousOwner && previousOwner !== instanceId) {
    throw new Error(`released session requires prior owner ${previousOwner} to resume; use takeover for ${instanceId}`);
  }

  next.instanceId = instanceId;
  next.ownership = {
    state: 'owned',
    ownerInstanceId: instanceId,
    previousOwnerInstanceId: currentOwner ?? previousOwner,
    updatedAt: now,
  };
  next.updatedAt = now;
  return next;
}

export function releaseSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export function releaseSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
export function releaseSessionOwnership(
  ledger: StoredSessionIntentLedgerInput,
  instanceId: string,
  now = Date.now(),
): NormalizedStoredSessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  if (next.ownership.ownerInstanceId && next.ownership.ownerInstanceId !== instanceId) {
    throw new Error(`cannot release session owned by ${next.ownership.ownerInstanceId}`);
  }

  next.instanceId = instanceId;
  next.ownership = {
    state: 'released',
    previousOwnerInstanceId: next.ownership.ownerInstanceId ?? instanceId,
    updatedAt: now,
  };
  next.updatedAt = now;
  return next;
}

export function resumeSessionOwnership(ledger: SessionIntentLedger, instanceId: string, now?: number): SessionIntentLedger;
export function resumeSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, now?: number): NormalizedStoredSessionIntentLedger;
export function resumeSessionOwnership(
  ledger: StoredSessionIntentLedgerInput,
  instanceId: string,
  now = Date.now(),
): NormalizedStoredSessionIntentLedger {
  const next = cloneSessionIntentLedger(ledger);
  const currentOwner = next.ownership.ownerInstanceId;
  const previousOwner = next.ownership.previousOwnerInstanceId;

  if (currentOwner && currentOwner !== instanceId && next.ownership.state !== 'released') {
    throw new Error(`resume requires release or existing owner; current owner is ${currentOwner}`);
  }

  next.instanceId = instanceId;
  next.ownership = {
    state: 'resume',
    ownerInstanceId: instanceId,
    previousOwnerInstanceId: currentOwner ?? previousOwner ?? instanceId,
    updatedAt: now,
  };
  next.updatedAt = now;
  return next;
}

/** Data fields consumed by the existing ownership check; never a grant. */
export interface SessionWriteOwnershipData {
  readonly ownership: {
    readonly ownerInstanceId?: unknown;
    readonly previousOwnerInstanceId?: unknown;
    readonly state?: unknown;
  };
  readonly instanceId?: unknown;
  readonly intents: readonly unknown[];
  readonly latestPlan: unknown;
}

export function assertSessionWriteOwnership(
  ledger: SessionWriteOwnershipData,
  instanceId: string,
  action = 'write',
  options: { allowInitialClaim?: boolean } = {},
): void {
  const ownerInstanceId = ledger.ownership.ownerInstanceId;
  if (ownerInstanceId) {
    if (ownerInstanceId !== instanceId) {
      throw new Error(`cannot ${action}: session is owned by ${ownerInstanceId}`);
    }
    return;
  }

  if (
    options.allowInitialClaim
    && !ledger.ownership.previousOwnerInstanceId
    && !ledger.instanceId
    && ledger.intents.length === 0
    && ledger.latestPlan === null
  ) {
    return;
  }

  if (ledger.ownership.previousOwnerInstanceId || ledger.ownership.state === 'released') {
    throw new Error(`cannot ${action}: session ownership is released`);
  }

  if (ledger.instanceId) {
    if (ledger.instanceId !== instanceId) {
      throw new Error(`cannot ${action}: session is owned by ${ledger.instanceId}`);
    }
    return;
  }

  throw new Error(`cannot ${action}: session ownership is not established`);
}

export function takeoverSessionOwnership(ledger: SessionIntentLedger, instanceId: string, options?: TakeoverSessionOptions): SessionIntentLedger;
export function takeoverSessionOwnership(ledger: StoredSessionIntentLedgerInput, instanceId: string, options?: TakeoverSessionOptions): NormalizedStoredSessionIntentLedger;
export function takeoverSessionOwnership(
  ledger: StoredSessionIntentLedgerInput,
  instanceId: string,
  options: TakeoverSessionOptions = {},
): NormalizedStoredSessionIntentLedger {
  const now = options.now ?? Date.now();
  const next = cloneSessionIntentLedger(ledger);
  const currentOwner = next.ownership.ownerInstanceId ?? next.ownership.previousOwnerInstanceId;

  if (!currentOwner) {
    throw new Error('takeover requires an active or prior owner');
  }
  if (currentOwner === instanceId) {
    throw new Error('takeover requires a different instance');
  }

  if (resolveActiveRiskTier(next) === 'high' && options.confirmHighRisk !== true) {
    throw new Error('high-risk takeover requires explicit confirmation');
  }

  next.instanceId = instanceId;
  next.ownership = {
    state: 'takeover',
    ownerInstanceId: instanceId,
    previousOwnerInstanceId: currentOwner,
    updatedAt: now,
  };
  next.updatedAt = now;
  return next;
}
