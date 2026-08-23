/**
 * Two-phase updater handoff (design v58 §5.5, R16-05, R21-02, R22-02, R27-03,
 * R40-04, R42-02).
 *
 * The rule the whole state machine exists for: never dispose the runtime before
 * the updater has actually started quitting. `quitAndInstall()` can return
 * synchronously long before the app exits, so cleanup is driven by the real
 * `before-quit` event, not by the IPC call.
 *
 * Platform reality this encodes (verified against electron-updater 6.8.3):
 *  - darwin instantiates `MacUpdater extends AppUpdater`. Its `quitAndInstall()`
 *    delegates to the native Squirrel updater when ready; when not ready it only
 *    registers an `update-downloaded` listener and returns. With
 *    `autoInstallOnAppQuit === false` it additionally calls
 *    `nativeUpdater.checkForUpdates()`. Because that anonymous listener cannot
 *    be withdrawn, any synchronous throw after the wrapper was entered becomes
 *    `pending_error_sticky` — never a retry.
 *  - non-darwin installers go through `BaseUpdater`, where a synchronous
 *    rejection is dispatched as an error inside the same call stack. Only that
 *    synchronously attributable error may return the attempt to idle. A later
 *    async error (e.g. `NsisUpdater.doInstall()` returning true, queueing
 *    `setImmediate(app.quit)`, then `spawnLog()` rejecting) is diagnostic only.
 */

export type UpdaterPlatformClass = 'mac' | 'base';

export type HandoffState =
  | { kind: 'idle' }
  | { kind: 'pending'; attemptId: number; platformClass: UpdaterPlatformClass; startedAt: number }
  | { kind: 'pending_error_sticky'; attemptId: number; diagnostic: string }
  | { kind: 'error'; attemptId: number; diagnostic: string }
  | { kind: 'handed_off'; attemptId: number };

export type BeginOutcome =
  | { status: 'pending' }
  | { status: 'rejected_sync'; diagnostic: string }
  | { status: 'pending_error_sticky'; diagnostic: string }
  | { status: 'already_pending' }
  | { status: 'already_handed_off' };

export interface UpdaterHandoffAdapter {
  readonly platformClass: UpdaterPlatformClass;
  /**
   * Runs adapter-level preflight before the wrapper is entered. A failure here
   * is the only case that may return the attempt to idle on macOS.
   */
  preflight?(): void;
  /**
   * Invokes the real updater wrapper exactly once per attempt. Base adapters
   * return the synchronously attributed error, if any; mac adapters return
   * nothing and rely on the sticky rule.
   */
  invokeWrapper(): { syncError?: Error } | void;
}

export class UpdaterHandoffStateMachine {
  private state: HandoffState = { kind: 'idle' };

  private attemptSeq = 0;

  constructor(
    private readonly adapter: UpdaterHandoffAdapter,
    private readonly now: () => number = () => Date.now(),
  ) {}

  snapshot(): HandoffState {
    return this.state;
  }

  /** UI-facing projection; `install_handoff_pending` is not an error. */
  projection(): { status: string; diagnostic?: string } {
    switch (this.state.kind) {
      case 'idle': return { status: 'idle' };
      case 'pending': return { status: 'install_handoff_pending' };
      case 'pending_error_sticky':
        return { status: 'install_handoff_pending', diagnostic: this.state.diagnostic };
      case 'error': return { status: 'install_failed', diagnostic: this.state.diagnostic };
      case 'handed_off': return { status: 'install_handed_off' };
    }
  }

  /** `desktop:quitAndInstall`. Never writes isQuitting; see §5.5. */
  begin(): BeginOutcome {
    if (this.state.kind === 'handed_off') return { status: 'already_handed_off' };
    if (this.state.kind === 'pending') return { status: 'already_pending' };
    if (this.state.kind === 'pending_error_sticky') {
      return { status: 'pending_error_sticky', diagnostic: this.state.diagnostic };
    }

    this.attemptSeq += 1;
    const attemptId = this.attemptSeq;

    // Pre-wrapper adapter self-check: the only path back to idle on macOS.
    if (this.adapter.preflight) {
      try {
        this.adapter.preflight();
      } catch (error) {
        this.state = { kind: 'error', attemptId, diagnostic: describe(error) };
        return { status: 'rejected_sync', diagnostic: describe(error) };
      }
    }

    this.state = {
      kind: 'pending', attemptId, platformClass: this.adapter.platformClass, startedAt: this.now(),
    };

    let result: { syncError?: Error } | void;
    try {
      result = this.adapter.invokeWrapper();
    } catch (error) {
      if (this.adapter.platformClass === 'mac') {
        // The anonymous update-downloaded listener may already be installed and
        // cannot be withdrawn: no second wrapper call in this process.
        this.state = { kind: 'pending_error_sticky', attemptId, diagnostic: describe(error) };
        return { status: 'pending_error_sticky', diagnostic: describe(error) };
      }
      this.state = { kind: 'error', attemptId, diagnostic: describe(error) };
      return { status: 'rejected_sync', diagnostic: describe(error) };
    }

    const syncError = result && 'syncError' in result ? result.syncError : undefined;
    if (syncError) {
      if (this.adapter.platformClass === 'mac') {
        this.state = { kind: 'pending_error_sticky', attemptId, diagnostic: describe(syncError) };
        return { status: 'pending_error_sticky', diagnostic: describe(syncError) };
      }
      this.state = { kind: 'error', attemptId, diagnostic: describe(syncError) };
      return { status: 'rejected_sync', diagnostic: describe(syncError) };
    }

    return { status: 'pending' };
  }

  /**
   * Any updater error that is not synchronously attributable to the current
   * wrapper call: diagnostics only. It must never return the attempt to idle,
   * because Nsis may already have queued `app.quit()`.
   */
  observeAsyncUpdaterError(error: unknown): void {
    if (this.state.kind !== 'pending' && this.state.kind !== 'pending_error_sticky') return;
    const diagnostic = describe(error);
    this.state = this.state.kind === 'pending'
      ? { kind: 'pending_error_sticky', attemptId: this.state.attemptId, diagnostic }
      : { ...this.state, diagnostic };
  }

  /** The real `before-quit`: the only transition into irreversible cleanup. */
  commitHandoffOnBeforeQuit(): { committed: boolean; attemptId: number | null } {
    if (this.state.kind === 'pending' || this.state.kind === 'pending_error_sticky') {
      const attemptId = this.state.attemptId;
      this.state = { kind: 'handed_off', attemptId };
      return { committed: true, attemptId };
    }
    if (this.state.kind === 'handed_off') return { committed: false, attemptId: this.state.attemptId };
    return { committed: false, attemptId: null };
  }

  get hasPendingIntent(): boolean {
    return this.state.kind === 'pending' || this.state.kind === 'pending_error_sticky';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
