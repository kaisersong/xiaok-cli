import { describe, expect, it } from 'vitest';
import {
  UpdaterHandoffStateMachine,
  type UpdaterHandoffAdapter,
} from '../../electron/updater-handoff.js';

/** Mimics MacUpdater: not-ready path registers an anonymous listener, then returns. */
function macAdapter(behaviour: {
  listenerRegistered?: () => void;
  throwAfterListener?: Error;
  preflightError?: Error;
} = {}): UpdaterHandoffAdapter {
  return {
    platformClass: 'mac',
    preflight: behaviour.preflightError ? () => { throw behaviour.preflightError; } : undefined,
    invokeWrapper: () => {
      behaviour.listenerRegistered?.();
      if (behaviour.throwAfterListener) throw behaviour.throwAfterListener;
    },
  };
}

/** Mimics BaseUpdater: a synchronous rejection is dispatched in the same stack. */
function baseAdapter(syncError?: Error): UpdaterHandoffAdapter {
  return {
    platformClass: 'base',
    invokeWrapper: () => (syncError ? { syncError } : undefined),
  };
}

describe('updater handoff — macOS branch (design R21-02, R42-02, R40-04)', () => {
  it('stays pending after the wrapper returns and keeps the runtime usable', () => {
    let listeners = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({ listenerRegistered: () => { listeners += 1; } }));

    expect(sm.begin()).toEqual({ status: 'pending' });
    expect(sm.projection()).toEqual({ status: 'install_handoff_pending' });
    expect(listeners).toBe(1);
  });

  it('never calls the wrapper twice for one pending attempt', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({ listenerRegistered: () => { calls += 1; } }));

    sm.begin();
    expect(sm.begin()).toEqual({ status: 'already_pending' });
    expect(sm.begin()).toEqual({ status: 'already_pending' });

    expect(calls).toBe(1);
  });

  it('becomes pending_error_sticky when checkForUpdates throws after the listener', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine(macAdapter({
      listenerRegistered: () => { calls += 1; },
      throwAfterListener: new Error('checkForUpdates exploded'),
    }));

    const outcome = sm.begin();

    expect(outcome).toEqual({ status: 'pending_error_sticky', diagnostic: 'checkForUpdates exploded' });
    // Sticky: repeated IPC must not register a second listener or retry.
    expect(sm.begin()).toEqual({ status: 'pending_error_sticky', diagnostic: 'checkForUpdates exploded' });
    expect(calls).toBe(1);
    // The app stays usable and still reports pending to the UI.
    expect(sm.projection().status).toBe('install_handoff_pending');
  });

  it('allows a retry only when the pre-wrapper self-check fails', () => {
    let calls = 0;
    let updateDownloaded = false;
    const sm = new UpdaterHandoffStateMachine({
      platformClass: 'mac',
      preflight: () => { if (!updateDownloaded) throw new Error('no downloaded update'); },
      invokeWrapper: () => { calls += 1; },
    });

    expect(sm.begin()).toEqual({ status: 'rejected_sync', diagnostic: 'no downloaded update' });
    expect(calls).toBe(0);

    updateDownloaded = true;
    expect(sm.begin()).toEqual({ status: 'pending' });
    expect(calls).toBe(1);
  });
});

describe('updater handoff — Base/Nsis branch (design R27-03, R22-02)', () => {
  it('returns to idle on a synchronously attributed error and allows a retry', () => {
    let attempt = 0;
    const sm = new UpdaterHandoffStateMachine({
      platformClass: 'base',
      invokeWrapper: () => {
        attempt += 1;
        return attempt === 1 ? { syncError: new Error('install returned false') } : undefined;
      },
    });

    expect(sm.begin()).toEqual({ status: 'rejected_sync', diagnostic: 'install returned false' });
    expect(sm.projection()).toEqual({ status: 'install_failed', diagnostic: 'install returned false' });

    expect(sm.begin()).toEqual({ status: 'pending' });
    expect(attempt).toBe(2);
  });

  it('keeps pending after a late async spawn error (Nsis already queued app.quit)', () => {
    let calls = 0;
    const sm = new UpdaterHandoffStateMachine({
      platformClass: 'base',
      invokeWrapper: () => { calls += 1; },
    });
    sm.begin();

    sm.observeAsyncUpdaterError(new Error('spawnLog failed'));

    expect(sm.hasPendingIntent).toBe(true);
    expect(sm.projection()).toEqual({ status: 'install_handoff_pending', diagnostic: 'spawnLog failed' });
    // No second wrapper call is permitted for the same intent.
    expect(sm.begin()).toEqual({ status: 'pending_error_sticky', diagnostic: 'spawnLog failed' });
    expect(calls).toBe(1);
  });

  it('ignores unrelated background updater errors when idle', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());

    sm.observeAsyncUpdaterError(new Error('4h check failed'));

    expect(sm.snapshot()).toEqual({ kind: 'idle' });
  });
});

describe('updater handoff — commit on real before-quit', () => {
  it('commits exactly once and reports the attempt id', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());
    sm.begin();

    const first = sm.commitHandoffOnBeforeQuit();
    const second = sm.commitHandoffOnBeforeQuit();

    expect(first).toEqual({ committed: true, attemptId: 1 });
    expect(second).toEqual({ committed: false, attemptId: 1 });
    expect(sm.projection()).toEqual({ status: 'install_handed_off' });
  });

  it('commits a sticky pending attempt too, and late errors cannot roll it back', () => {
    const sm = new UpdaterHandoffStateMachine(macAdapter({ throwAfterListener: new Error('sync throw') }));
    sm.begin();

    expect(sm.commitHandoffOnBeforeQuit()).toEqual({ committed: true, attemptId: 1 });
    sm.observeAsyncUpdaterError(new Error('late error'));

    expect(sm.snapshot()).toEqual({ kind: 'handed_off', attemptId: 1 });
  });

  it('a normal quit without an install intent commits nothing', () => {
    const sm = new UpdaterHandoffStateMachine(baseAdapter());

    expect(sm.commitHandoffOnBeforeQuit()).toEqual({ committed: false, attemptId: null });
  });
});
