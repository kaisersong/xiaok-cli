/**
 * Destructive-site guard (design v58 §4.4; R27-01, R28-02, R29-01).
 *
 * Five production sites can delete or rebuild a digest path: stage pre-clean and
 * its exception cleanup, dependency-runtime pre-clean and its exception cleanup,
 * the installer `catch`, the post-pointer-switch pruner, and uninstall. Guarding
 * only the pruner (as the earlier drafts did) still lets stage/dependency delete
 * a digest another process is executing, so all five must funnel through this
 * single check while holding the same `PluginLockCapability`.
 *
 * Rules:
 *  - the capability must be presented; a site without it is a contract violation;
 *  - live pin state is re-read *inside* the lock, never from a snapshot taken
 *    before it (that gap is the TOCTOU the reviewers kept finding);
 *  - a live-pinned digest is never deleted or rebuilt in place. If its content
 *    re-verifies it may be reused read-only; otherwise the answer is
 *    `version_in_use` and the caller must build a new generation.
 */

import type { PluginLockCapability } from './plugin-claim-lock.js';
import { isSourceDeletable, reducePinState, type InstanceVerdict } from './provider-source-pin.js';
import type { ProcessIdentity } from './plugin-claim-lock.js';

export type DestructiveSite =
  | 'stage_pre_clean'
  | 'stage_exception_cleanup'
  | 'dependency_runtime_pre_clean'
  | 'dependency_runtime_exception_cleanup'
  | 'installer_catch_cleanup'
  | 'pointer_switch_prune'
  | 'uninstall';

export const DESTRUCTIVE_SITES: readonly DestructiveSite[] = Object.freeze([
  'stage_pre_clean',
  'stage_exception_cleanup',
  'dependency_runtime_pre_clean',
  'dependency_runtime_exception_cleanup',
  'installer_catch_cleanup',
  'pointer_switch_prune',
  'uninstall',
]);

export class MissingLockCapabilityError extends Error {
  readonly code = 'destructive_site_without_lock_capability';

  constructor(site: DestructiveSite) {
    super(`destructive_site_without_lock_capability: ${site}`);
    this.name = 'MissingLockCapabilityError';
  }
}

export type DestructiveDecision =
  | { kind: 'proceed' }
  | { kind: 'reuse_readonly'; reason: 'digest_live_pinned_and_verified' }
  | { kind: 'version_in_use'; verdicts: readonly InstanceVerdict[] };

export interface DestructiveRequest {
  readonly site: DestructiveSite;
  readonly capability: PluginLockCapability | null;
  readonly pinsRoot: string;
  readonly pluginName: string;
  readonly sourceDigest: string;
  /** Whether the existing tree re-verifies byte-for-byte against its manifest. */
  readonly reVerifies?: boolean;
  /** `--force` never overrides a live pin; it only skips content reuse. */
  readonly force?: boolean;
  probeIdentity(pid: number): ProcessIdentity | null;
}

export function authoriseDestructiveMutation(request: DestructiveRequest): DestructiveDecision {
  if (!request.capability) {
    throw new MissingLockCapabilityError(request.site);
  }

  // Re-read inside the lock: a verdict computed before acquiring it is stale.
  const verdicts = reducePinState(
    request.pinsRoot,
    request.pluginName,
    request.sourceDigest,
    request.probeIdentity,
  );

  if (isSourceDeletable(verdicts)) {
    return { kind: 'proceed' };
  }

  // Live-pinned: reuse read-only when the content still verifies, otherwise the
  // caller must target a new digest/generation instead of rebuilding this one.
  if (request.reVerifies === true && request.force !== true) {
    return { kind: 'reuse_readonly', reason: 'digest_live_pinned_and_verified' };
  }
  return { kind: 'version_in_use', verdicts };
}

/**
 * Uninstall keeps its user-visible promise (the version disappears for new
 * processes) by removing the pointer immediately, while physical deletion waits
 * for the pin to clear.
 */
export interface UninstallPlan {
  readonly removePointerNow: true;
  readonly deletePhysicallyNow: boolean;
  readonly deferReason?: string;
}

export function planUninstall(request: Omit<DestructiveRequest, 'site' | 'reVerifies' | 'force'>): UninstallPlan {
  const decision = authoriseDestructiveMutation({ ...request, site: 'uninstall' });
  if (decision.kind === 'proceed') {
    return { removePointerNow: true, deletePhysicallyNow: true };
  }
  return {
    removePointerNow: true,
    deletePhysicallyNow: false,
    deferReason: decision.kind === 'version_in_use'
      ? `version_in_use: ${decision.verdicts.map((v) => v.kind === 'in_use' ? v.reason : 'inactive').join(',')}`
      : decision.reason,
  };
}
