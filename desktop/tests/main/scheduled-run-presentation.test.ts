import { describe, expect, it } from 'vitest';
import { scheduledRunPresentation } from '../../electron/scheduled-run-presentation.js';
describe('scheduled dispatch is not execution completion', () => {
  it('keeps a created runtime handle in accepted state', () => {
    expect(scheduledRunPresentation({ status: 'success', runtimeTaskId: 'task-real' })).toMatchObject({ completed: false, dispatchStatus: 'success', runtimeState: 'accepted' });
  });
  it('does not imply an actual run for skipped or failed dispatch', () => {
    expect(scheduledRunPresentation({ status: 'skipped' })).toMatchObject({ completed: false, dispatchStatus: 'skipped', runtimeState: 'not_started' });
    expect(scheduledRunPresentation({ status: 'failed' })).toMatchObject({ completed: false, dispatchStatus: 'failed', runtimeState: 'not_started' });
  });
});
