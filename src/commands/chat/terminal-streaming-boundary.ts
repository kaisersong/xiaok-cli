export interface TerminalStreamingFooterState {
  inputPrompt: string;
  summaryLine: string;
  statusLine: string;
}

type TerminalStreamingEndState = TerminalStreamingFooterState & {
  reserveActivityRow?: boolean;
};

export interface TerminalStreamingBoundaryDeps {
  scrollRegion: {
    isActive(): boolean;
    isContentStreaming(): boolean;
    endContentStreaming(options: TerminalStreamingEndState): void;
    renderFooter(options: TerminalStreamingFooterState): void;
  };
  replRenderer: { prepareForInput(): void };
  mdRenderer: { beginNewSegment(): void };
}

export interface TerminalStreamingInterruptDeps {
  scrollRegion: {
    isActive(): boolean;
    isContentStreaming(): boolean;
    endContentStreaming(options: TerminalStreamingEndState): void;
  };
  runtimeState: { enterToolInterrupt(): void };
  mdRenderer: { beginNewSegment(): void };
}

export function renderFooterChromeInOrder(
  deps: TerminalStreamingBoundaryDeps,
  footerState: TerminalStreamingFooterState,
): void {
  if (!deps.scrollRegion.isActive()) {
    return;
  }

  if (deps.scrollRegion.isContentStreaming()) {
    deps.scrollRegion.endContentStreaming(footerState);
    deps.mdRenderer.beginNewSegment();
  } else {
    deps.scrollRegion.renderFooter(footerState);
  }
  deps.replRenderer.prepareForInput();
}

export interface TerminalStreamingPhaseDeps {
  scrollRegion: {
    isActive(): boolean;
    isContentStreaming(): boolean;
    clearActivity(): void;
    positionCursorAtContentCursor(): void;
    writeAtContentCursor(text: string): void;
    beginContentStreaming(): void;
    getNewlineCallback(): () => void;
    getColumnAdvanceCallback(): (visibleWidth: number) => void;
  };
  runtimeState: { enterStreamingContent(): void };
  turnLayout: { consumeAssistantLeadIn(): string };
  mdRenderer: {
    setNewlineCallback(callback: (() => void) | null): void;
    setColumnAdvanceCallback(callback: ((visibleWidth: number) => void) | null): void;
  };
  stopLiveActivityTimer(): void;
  writeFallback(text: string): void;
}

/**
 * Attach the scroll-region-aware cursor bookkeeping callbacks before the next
 * assistant chunk is rendered. Called for every non-empty delta, so the
 * re-entry branch must stay free of absolute repositioning side effects beyond
 * restoring the tracked cursor.
 */
export function ensureStreamingPhaseInOrder(deps: TerminalStreamingPhaseDeps): void {
  const attachCallbacks = (): void => {
    deps.mdRenderer.setNewlineCallback(deps.scrollRegion.getNewlineCallback());
    deps.mdRenderer.setColumnAdvanceCallback(deps.scrollRegion.getColumnAdvanceCallback());
  };

  if (deps.scrollRegion.isContentStreaming()) {
    if (deps.scrollRegion.isActive()) {
      deps.scrollRegion.clearActivity();
      deps.scrollRegion.positionCursorAtContentCursor();
      attachCallbacks();
    }
    return;
  }

  const assistantLeadIn = deps.turnLayout.consumeAssistantLeadIn();
  if (assistantLeadIn) {
    if (deps.scrollRegion.isActive()) {
      deps.scrollRegion.writeAtContentCursor(assistantLeadIn);
    } else {
      deps.writeFallback(assistantLeadIn);
    }
  }
  deps.stopLiveActivityTimer();
  deps.scrollRegion.beginContentStreaming();
  deps.runtimeState.enterStreamingContent();
  attachCallbacks();
}

export function endStreamingPhaseForInterruptInOrder(
  deps: TerminalStreamingInterruptDeps,
  footerState: TerminalStreamingFooterState,
): void {
  if (!deps.scrollRegion.isActive() || !deps.scrollRegion.isContentStreaming()) {
    return;
  }

  deps.runtimeState.enterToolInterrupt();
  deps.scrollRegion.endContentStreaming({ ...footerState, reserveActivityRow: true });
  deps.mdRenderer.beginNewSegment();
}
