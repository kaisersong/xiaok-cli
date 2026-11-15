import {activityOwnerStartupLabels} from '../shared/activity-owner-startup-labels.js';
import type { ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';

/** The only text a user sees when the background follow-up component cannot be attached.
 * It never carries an internal error code (e.g. activity_owner_config_mismatch). */
export const ACTIVITY_OWNER_UNAVAILABLE_NOTICE = activityOwnerStartupLabels.zh.unavailable;

type OwnerSourceConfig = Pick<ActivityOwnerConfig, 'kswarm' | 'managedSources'>;

export interface ActivityOwnerStartupDeps {
  kswarmService: {
    activityOwnerConfig?(): Promise<OwnerSourceConfig>;
    releaseActivityOwnerDelegation?(): void;
    start(): Promise<void>;
  };
  attachConversationActivityOwner(config: OwnerSourceConfig): Promise<void>;
  activityEnabled: boolean;
  log?(message: string): void;
}

/** One notice per distinct failure for the lifetime of the process, however often the attach is retried. */
export function createOnceNotice(show: (text: string) => void | Promise<void>,locale:'zh'|'en'='zh'): (failureKey: string) => boolean {
  const shown = new Set<string>();
  return failureKey => {
    if (shown.has(failureKey)) return false;
    shown.add(failureKey);
    try { void Promise.resolve(show(failureKey==='activity_source_start_timeout:local_connection_unavailable'?activityOwnerStartupLabels[locale].localConnectionUnavailable:failureKey==='activity_owner_config_mismatch'||failureKey==='activity_owner_profile_mismatch'?activityOwnerStartupLabels[locale].versionMismatch:activityOwnerStartupLabels[locale].unavailable)).catch(() => undefined); } catch { /* a notice failure must not break startup */ }
    return true;
  };
}

/** Attach the activity owner, then start KSwarm. An attach failure never prevents KSwarm from starting. */
export async function startKSwarmWithActivityOwner(deps: ActivityOwnerStartupDeps, noticeOnce: (failureKey: string) => boolean): Promise<{ attached: boolean }> {
  let attached = true;
  if (deps.activityEnabled && deps.kswarmService.activityOwnerConfig) {
    try {
      await deps.attachConversationActivityOwner(await deps.kswarmService.activityOwnerConfig());
    } catch (error) {
      attached = false;
      const code = error instanceof Error ? error.message : 'activity_owner_attach_failed';
      deps.log?.(`[main] Activity owner attach failed (${code}); starting KSwarm without it`);
      deps.kswarmService.releaseActivityOwnerDelegation?.();
      noticeOnce(code);
    }
  }
  await deps.kswarmService.start();
  return { attached };
}
