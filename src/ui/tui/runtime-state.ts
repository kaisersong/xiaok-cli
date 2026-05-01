import type { ActivitySnapshot } from '../statusbar.js';

export type TuiTurnSurfaceState =
  | 'input_ready'
  | 'streaming_content'
  | 'tool_interrupt'
  | 'waiting_feedback'
  | 'busy_finishing'
  | 'compat_input_ready'
  | 'compat_streaming';

export type TuiFooterMode = 'input_ready' | 'busy' | 'feedback' | 'compat';
export type TuiSummarySource = 'none' | 'turn' | 'completed_turn' | 'waiting_user';

export interface TuiSurfaceSnapshot {
  turnSurfaceState: TuiTurnSurfaceState;
  footerMode: TuiFooterMode;
  activityVisible: boolean;
  summarySource: TuiSummarySource;
}

interface ReassuranceTick {
  bucket: number;
  line: string;
}

export interface TuiRuntimeStatusBar {
  beginActivity(label: string, startedAt?: number): void;
  updateActivity(label: string): void;
  endActivity(): void;
  clearLive(): void;
  getActivityLabel(): string;
  getActivitySnapshot(): ActivitySnapshot | null;
  getActivityLine(now?: number, frameIndex?: number): string;
  getReassuranceTick(now?: number, lastBucket?: number): ReassuranceTick | null;
}

export interface TuiRuntimeScrollRegion {
  isContentStreaming(): boolean;
  renderActivity(activityLine: string): void;
  clearActivity(): void;
}

export interface TuiRuntimeStateOptions {
  statusBar: TuiRuntimeStatusBar;
  scrollRegion: TuiRuntimeScrollRegion;
  onWriteProgressNote: (note: string) => void;
  onSuspendInteractiveUi: (context: string, error: unknown) => void;
  isTerminalUiSuspended: () => boolean;
}

export class TuiRuntimeState {
  private liveActivityTimer: NodeJS.Timeout | null = null;
  private resumeActivityTimer: NodeJS.Timeout | null = null;
  private reassuranceTimer: NodeJS.Timeout | null = null;
  private pauseActivityTimer: NodeJS.Timeout | null = null;
  private interactivePromptDepth = 0;
  private liveActivityFrame = 0;
  private liveActivityVisible = false;
  private responseStarted = false;
  private lastReassuranceBucket = -1;
  private turnActive = false;

  private snapshot: TuiSurfaceSnapshot = {
    turnSurfaceState: 'input_ready',
    footerMode: 'input_ready',
    activityVisible: false,
    summarySource: 'none',
  };

  constructor(private readonly options: TuiRuntimeStateOptions) {}

  getSnapshot(): TuiSurfaceSnapshot {
    return { ...this.snapshot };
  }

  setSummarySource(summarySource: TuiSummarySource): void {
    this.snapshot.summarySource = summarySource;
  }

  getFooterInputPrompt(): string {
    return this.snapshot.footerMode === 'busy' ? 'Finishing response...' : 'Type your message...';
  }

  beginTurn(activityLabel = 'Thinking'): void {
    this.turnActive = true;
    this.responseStarted = false;
    this.lastReassuranceBucket = -1;
    this.liveActivityFrame = 0;
    this.markBusyFinishing();
    this.beginActivity(activityLabel, true);
    this.ensureReassuranceTimer();
  }

  noteResponseStarted(): void {
    this.responseStarted = true;
  }

  enterStreamingContent(): void {
    this.snapshot.turnSurfaceState = this.snapshot.footerMode === 'compat'
      ? 'compat_streaming'
      : 'streaming_content';
  }

  enterToolInterrupt(): void {
    this.snapshot.turnSurfaceState = 'tool_interrupt';
  }

  enterWaitingFeedback(): void {
    this.stopLiveActivityTimer();
    this.snapshot.turnSurfaceState = 'waiting_feedback';
    this.snapshot.footerMode = 'feedback';
  }

  markBusyFinishing(): void {
    this.snapshot.turnSurfaceState = 'busy_finishing';
    this.snapshot.footerMode = 'busy';
  }

  markInputReady(): void {
    this.snapshot.turnSurfaceState = 'input_ready';
    this.snapshot.footerMode = 'input_ready';
    this.snapshot.activityVisible = false;
  }

  markCompatInputReady(): void {
    this.snapshot.turnSurfaceState = 'compat_input_ready';
    this.snapshot.footerMode = 'compat';
    this.snapshot.activityVisible = false;
  }

  deactivateTurn(): void {
    this.turnActive = false;
  }

  beginActivity(label: string, restart = false, startedAt = Date.now()): void {
    if (!this.turnActive && this.liveActivityTimer) {
      return;
    }
    this.clearResumeTimer();

    if (restart || !this.liveActivityTimer) {
      this.options.statusBar.beginActivity(label, startedAt);
    } else {
      this.options.statusBar.updateActivity(label);
    }

    if (!this.liveActivityTimer) {
      this.renderLiveActivity();
      this.liveActivityTimer = setInterval(() => {
        this.renderLiveActivity();
      }, 120);
      return;
    }

    this.renderLiveActivity();
  }

  scheduleActivityResume(label: string, delayMs = 180): void {
    this.clearResumeTimer();
    this.resumeActivityTimer = setTimeout(() => {
      this.resumeActivityTimer = null;
      this.beginActivity(label);
    }, delayMs);
  }

  scheduleActivityPause(delayMs = 180): void {
    this.clearResumeTimer();
    if (this.pauseActivityTimer) {
      clearTimeout(this.pauseActivityTimer);
      this.pauseActivityTimer = null;
    }
    this.pauseActivityTimer = setTimeout(() => {
      this.pauseActivityTimer = null;
      this.pauseActivity();
    }, delayMs);
  }

  ensureReassuranceTimer(): void {
    if (this.reassuranceTimer) {
      return;
    }
    this.reassuranceTimer = setInterval(() => {
      if (this.interactivePromptDepth > 0) {
        return;
      }
      if (this.options.scrollRegion.isContentStreaming()) {
        return;
      }
      if (!this.responseStarted) {
        return;
      }
      const tick = this.options.statusBar.getReassuranceTick(Date.now(), this.lastReassuranceBucket);
      if (!tick) {
        return;
      }
      this.lastReassuranceBucket = tick.bucket;
      this.pauseActivity();
      this.options.onWriteProgressNote(tick.line);
      const label = this.options.statusBar.getActivityLabel();
      if (this.liveActivityTimer && label) {
        this.scheduleActivityResume(label, 240);
      }
    }, 1000);
  }

  pauseActivity(): void {
    if (!this.liveActivityTimer || !this.liveActivityVisible) {
      return;
    }
    this.options.statusBar.clearLive();
    this.liveActivityVisible = false;
    this.snapshot.activityVisible = false;
    if (!this.options.scrollRegion.isContentStreaming()) {
      try {
        this.options.scrollRegion.clearActivity();
      } catch {}
    }
  }

  stopLiveActivityTimer(): void {
    this.clearPauseTimer();
    this.clearResumeTimer();
    if (this.liveActivityTimer) {
      clearInterval(this.liveActivityTimer);
      this.liveActivityTimer = null;
    }
    if (this.liveActivityVisible) {
      this.options.statusBar.clearLive();
      this.liveActivityVisible = false;
      this.snapshot.activityVisible = false;
    }
    if (!this.options.scrollRegion.isContentStreaming()) {
      try {
        this.options.scrollRegion.clearActivity();
      } catch {}
    }
  }

  async withPausedLiveActivity<T>(action: () => Promise<T>): Promise<T> {
    const snapshot = this.options.statusBar.getActivitySnapshot();
    this.enterInteractivePrompt();
    try {
      return await action();
    } finally {
      this.exitInteractivePrompt();
      if (
        snapshot
        && !this.options.isTerminalUiSuspended()
        && this.turnActive
        && !this.options.scrollRegion.isContentStreaming()
        && this.interactivePromptDepth === 0
      ) {
        this.beginActivity(snapshot.label, true, snapshot.startedAt);
      }
    }
  }

  enterInteractivePrompt(): void {
    this.interactivePromptDepth += 1;
    this.stopLiveActivityTimer();
  }

  exitInteractivePrompt(): void {
    this.interactivePromptDepth = Math.max(0, this.interactivePromptDepth - 1);
  }

  stopActivity(): void {
    this.options.statusBar.endActivity();
    if (this.reassuranceTimer) {
      clearInterval(this.reassuranceTimer);
      this.reassuranceTimer = null;
    }
    this.stopLiveActivityTimer();
    this.liveActivityFrame = 0;
    this.responseStarted = false;
    this.lastReassuranceBucket = -1;
    this.interactivePromptDepth = 0;
  }

  destroy(): void {
    this.turnActive = false;
    this.stopActivity();
    this.markInputReady();
  }

  private renderLiveActivity(): void {
    if (this.options.scrollRegion.isContentStreaming()) {
      return;
    }

    const line = this.options.statusBar.getActivityLine(Date.now(), this.liveActivityFrame++);
    if (!line) {
      return;
    }

    this.liveActivityVisible = true;
    this.snapshot.activityVisible = true;
    try {
      this.options.scrollRegion.renderActivity(line);
    } catch (error) {
      this.options.onSuspendInteractiveUi('render_live_activity', error);
    }
  }

  private clearResumeTimer(): void {
    if (this.resumeActivityTimer) {
      clearTimeout(this.resumeActivityTimer);
      this.resumeActivityTimer = null;
    }
  }

  private clearPauseTimer(): void {
    if (this.pauseActivityTimer) {
      clearTimeout(this.pauseActivityTimer);
      this.pauseActivityTimer = null;
    }
  }
}
