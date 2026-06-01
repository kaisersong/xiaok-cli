import { describe, expect, it } from 'vitest';

import { shouldRefreshProjectsForEvent } from '../../renderer/src/hooks/useKSwarmClient';

describe('KSwarm client project refresh events', () => {
  it('refreshes the project list when a script workflow completes', () => {
    expect(shouldRefreshProjectsForEvent('workflow_run_completed')).toBe(true);
  });

  it('refreshes the project list for workflow state and progress updates', () => {
    expect(shouldRefreshProjectsForEvent('workflow_run_started')).toBe(true);
    expect(shouldRefreshProjectsForEvent('workflow_run_updated')).toBe(true);
    expect(shouldRefreshProjectsForEvent('workflow_progress_batch')).toBe(true);
  });

  it('does not refresh projects for unrelated events', () => {
    expect(shouldRefreshProjectsForEvent('broker_status')).toBe(false);
    expect(shouldRefreshProjectsForEvent(null)).toBe(false);
  });
});
