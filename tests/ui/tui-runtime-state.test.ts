import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TuiRuntimeState } from '../../src/ui/tui/runtime-state.js';

describe('TuiRuntimeState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createRuntimeState() {
    let activitySnapshot: { label: string; startedAt: number } | null = null;
    let activityLabel = '';

    const statusBar = {
      beginActivity: vi.fn((label: string, startedAt = Date.now()) => {
        activityLabel = label;
        activitySnapshot = { label, startedAt };
      }),
      updateActivity: vi.fn((label: string) => {
        activityLabel = label;
        if (activitySnapshot) {
          activitySnapshot = {
            ...activitySnapshot,
            label,
          };
        }
      }),
      endActivity: vi.fn(() => {
        activityLabel = '';
        activitySnapshot = null;
      }),
      clearLive: vi.fn(),
      getActivityLabel: vi.fn(() => activityLabel),
      getActivitySnapshot: vi.fn(() => activitySnapshot),
      getActivityLine: vi.fn((_now = Date.now(), _frameIndex = 0) => (
        activityLabel ? `⠋ ${activityLabel} · 1s` : ''
      )),
      getReassuranceTick: vi.fn(() => null),
    };

    let contentStreaming = false;
    const scrollRegion = {
      isContentStreaming: vi.fn(() => contentStreaming),
      renderActivity: vi.fn(),
      clearActivity: vi.fn(),
    };

    const writeProgressNote = vi.fn();
    const suspendInteractiveUi = vi.fn();

    const runtimeState = new TuiRuntimeState({
      statusBar,
      scrollRegion,
      onWriteProgressNote: writeProgressNote,
      onSuspendInteractiveUi: suspendInteractiveUi,
      isTerminalUiSuspended: () => false,
    });

    return {
      runtimeState,
      statusBar,
      scrollRegion,
      setContentStreaming(next: boolean) {
        contentStreaming = next;
      },
      writeProgressNote,
      suspendInteractiveUi,
    };
  }

  it('tracks explicit surface states across the turn lifecycle', () => {
    const { runtimeState } = createRuntimeState();

    expect(runtimeState.getSnapshot()).toEqual({
      turnSurfaceState: 'input_ready',
      footerMode: 'input_ready',
      activityVisible: false,
      summarySource: 'none',
    });
    expect(runtimeState.getFooterInputPrompt()).toBe('Type your message...');

    runtimeState.setSummarySource('turn');
    runtimeState.beginTurn('Thinking');
    expect(runtimeState.getSnapshot()).toMatchObject({
      turnSurfaceState: 'busy_finishing',
      footerMode: 'busy',
      summarySource: 'turn',
    });
    expect(runtimeState.getFooterInputPrompt()).toBe('Finishing response...');

    runtimeState.noteResponseStarted();
    runtimeState.enterStreamingContent();
    expect(runtimeState.getSnapshot()).toMatchObject({
      turnSurfaceState: 'streaming_content',
      footerMode: 'busy',
      summarySource: 'turn',
    });

    runtimeState.enterToolInterrupt();
    expect(runtimeState.getSnapshot()).toMatchObject({
      turnSurfaceState: 'tool_interrupt',
      footerMode: 'busy',
    });

    runtimeState.enterWaitingFeedback();
    expect(runtimeState.getSnapshot()).toMatchObject({
      turnSurfaceState: 'waiting_feedback',
      footerMode: 'feedback',
    });

    runtimeState.setSummarySource('waiting_user');
    expect(runtimeState.getSnapshot().summarySource).toBe('waiting_user');

    runtimeState.markInputReady();
    runtimeState.setSummarySource('none');
    expect(runtimeState.getSnapshot()).toEqual({
      turnSurfaceState: 'input_ready',
      footerMode: 'input_ready',
      activityVisible: false,
      summarySource: 'none',
    });
    expect(runtimeState.getFooterInputPrompt()).toBe('Type your message...');
  });

  it('pauses and restores live activity around blocking prompts when the turn remains active', async () => {
    const { runtimeState, statusBar, scrollRegion } = createRuntimeState();

    runtimeState.beginTurn('Thinking');
    expect(scrollRegion.renderActivity).toHaveBeenCalledWith('⠋ Thinking · 1s');
    expect(runtimeState.getSnapshot().activityVisible).toBe(true);

    await runtimeState.withPausedLiveActivity(async () => {
      expect(statusBar.clearLive).toHaveBeenCalled();
      expect(scrollRegion.clearActivity).toHaveBeenCalled();
      expect(runtimeState.getSnapshot().activityVisible).toBe(false);
      return Promise.resolve();
    });

    expect(statusBar.beginActivity).toHaveBeenCalledTimes(2);
    expect(scrollRegion.renderActivity).toHaveBeenLastCalledWith('⠋ Thinking · 1s');
    expect(runtimeState.getSnapshot().activityVisible).toBe(true);
  });

  it('does not restore live activity after the turn has already been deactivated', async () => {
    const { runtimeState, statusBar } = createRuntimeState();

    runtimeState.beginTurn('Thinking');
    runtimeState.deactivateTurn();

    await runtimeState.withPausedLiveActivity(async () => Promise.resolve());

    expect(statusBar.beginActivity).toHaveBeenCalledTimes(1);
    expect(runtimeState.getSnapshot().activityVisible).toBe(false);
  });

  it('does not render live activity while transcript streaming owns the cursor', () => {
    const { runtimeState, scrollRegion, setContentStreaming } = createRuntimeState();

    runtimeState.beginTurn('Thinking');
    expect(scrollRegion.renderActivity).toHaveBeenCalledTimes(1);

    setContentStreaming(true);
    runtimeState.beginActivity('Answering', true);

    expect(scrollRegion.renderActivity).toHaveBeenCalledTimes(1);
  });
});
