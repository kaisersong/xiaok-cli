/**
 * Report renderer adapter — `invocation-scoped` resource mode (design v58 §4.5,
 * §6.3; R2-04, R22-01, R40-01, R44-01, R54-01).
 *
 * Each render owns its own child: connect → call → parse → *await a controlled
 * close* → promote the default output. That order is the opposite of slide, and it
 * matters: the child must be proven gone before its scratch artifact is published,
 * while slide's generation child has to stay ready across promotions.
 *
 * The lease budget is phased, not a single timeout:
 *   startup 30s + call 30s + controlled close 3s + promotion 30s + guard 1s = 94s.
 * Once the backend result is parsed the lease enters `finalizing`, where neither a
 * caller nor a runtime abort may interrupt the close or the promotion — a failure
 * there is a typed cleanup/output error, never `provider_unavailable`.
 */

import { REQUIRED_PROVIDER_OPERATIONS } from '../provider-gateways/host-gateway-contracts.js';
import type { ProviderOperationCall } from '../provider-gateways/create-host-gateways.js';
import type { HostNodeRuntimeIdentity } from '../../../src/platform/provider-store/host-node-identity.js';
import {
  assertSupportedHostNode,
  checkHostIdentityBeforeSpawn,
  HostRuntimeIdentityDriftError,
} from '../../../src/platform/provider-store/host-node-identity.js';
import type { EffectHandle } from '../../../src/platform/provider-runtime/types.js';

export const REPORT_PHASE_BUDGET = Object.freeze({
  startupMs: 30_000,
  callMs: 30_000,
  controlledCloseMs: 3_000,
  promotionMs: 30_000,
  guardMs: 1_000,
});

export const REPORT_TOTAL_LEASE_BUDGET_MS =
  REPORT_PHASE_BUDGET.startupMs + REPORT_PHASE_BUDGET.callMs + REPORT_PHASE_BUDGET.controlledCloseMs
  + REPORT_PHASE_BUDGET.promotionMs + REPORT_PHASE_BUDGET.guardMs;

export class ReportCleanupFailedError extends Error {
  readonly code = 'cleanup_failed';

  constructor(detail: string) {
    super(`cleanup_failed: ${detail}`);
    this.name = 'ReportCleanupFailedError';
  }
}

export interface ReportInvocationChild {
  /** Raw close handle, handed over before `client.connect()` can await. */
  readonly rawCloseHandle: { close(): Promise<void>; getChildPid(): number | null };
  call(request: ProviderOperationCall, signal: AbortSignal): Promise<string>;
  listOperations(): Promise<readonly string[]>;
  /** Resolves only once the child and its managed population are gone. */
  closeAndProveExit(): Promise<{ exited: boolean; diagnostic?: string }>;
}

export interface ReportInvocationContext {
  readonly operation: string;
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal;
  /** Marks the parse transition; false when shutdown already closed the gate. */
  beginFinalizing(): boolean;
  registerInvocationHandle(handle: EffectHandle): void;
  readonly owner: { componentId: string; generationId: string };
  readonly leaseId: string;
}

export interface ReportFactoryDeps {
  readonly frozenIdentity: HostNodeRuntimeIdentity;
  liveIdentityFacts(): {
    execPath: string; platform: string; nodeVersion: string;
    moduleAbi: string; v8Version: string; appVersion: string;
  };
  now(): number;
  lastFullHashAt(): number;
  spawnChild(): Promise<ReportInvocationChild>;
  /** Promotes the default output; only called for a successful parse. */
  promoteDefaultOutput?(result: string): Promise<string>;
}

export interface ReportInvocationOutcome {
  readonly result: string;
  readonly childExited: boolean;
  readonly promotedPath?: string;
}

/**
 * One report invocation. Every spawn re-verifies the host interpreter identity, so
 * an app update can never make a pinned generation silently execute a different
 * Node; the invocation fails closed and the reconciler builds a new generation
 * outside the lease.
 */
export async function runReportInvocation(
  deps: ReportFactoryDeps,
  context: ReportInvocationContext,
): Promise<ReportInvocationOutcome> {
  const live = deps.liveIdentityFacts();
  assertSupportedHostNode({ nodeVersion: live.nodeVersion, moduleAbi: live.moduleAbi });
  const gate = checkHostIdentityBeforeSpawn(
    deps.frozenIdentity, deps.now(), deps.lastFullHashAt(), live,
  );
  if (gate.kind === 'drift') {
    // This invocation fails; re-generation happens asynchronously in the
    // reconciler, never synchronously inside the spawn path.
    throw new HostRuntimeIdentityDriftError(gate.field);
  }

  const child = await deps.spawnChild();
  // Registered before any external await so a force-revoke can still reach it.
  context.registerInvocationHandle({
    owner: { componentId: context.owner.componentId, generationId: context.owner.generationId },
    kind: 'mcp-connection',
    resourceId: `report-invocation:${context.leaseId}`,
    dispose: () => child.rawCloseHandle.close(),
  });

  const advertised = new Set(await child.listOperations());
  const missing = REQUIRED_PROVIDER_OPERATIONS['mcp:report-renderer'].filter((op) => !advertised.has(op));
  if (missing.length > 0) {
    await child.closeAndProveExit();
    throw new Error(`activation_failed: report-renderer is missing ${missing.join(', ')}`);
  }

  const result = await child.call({ operation: context.operation, input: context.input }, context.signal);

  // Parse succeeded: from here the host owns an uninterruptible finalization.
  context.beginFinalizing();

  const closed = await child.closeAndProveExit();
  if (!closed.exited) {
    throw new ReportCleanupFailedError(
      closed.diagnostic ?? 'report invocation child could not be proven gone',
    );
  }

  if (!deps.promoteDefaultOutput) {
    return { result, childExited: true };
  }
  const promotedPath = await deps.promoteDefaultOutput(result);
  return { result, childExited: true, promotedPath };
}
