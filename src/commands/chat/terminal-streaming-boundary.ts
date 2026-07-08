export interface TerminalStreamingFooterState {
  inputPrompt: string;
  summaryLine: string;
  statusLine: string;
}

export interface TerminalStreamingBoundaryDeps {
  scrollRegion: {
    isActive(): boolean;
    isContentStreaming(): boolean;
    endContentStreaming(options: TerminalStreamingFooterState): void;
    renderFooter(options: TerminalStreamingFooterState): void;
  };
  replRenderer: { prepareForInput(): void };
  mdRenderer: { beginNewSegment(): void };
}

export interface TerminalStreamingInterruptDeps {
  scrollRegion: {
    isActive(): boolean;
    isContentStreaming(): boolean;
    endContentStreaming(options: TerminalStreamingFooterState): void;
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

export function endStreamingPhaseForInterruptInOrder(
  deps: TerminalStreamingInterruptDeps,
  footerState: TerminalStreamingFooterState,
): void {
  if (!deps.scrollRegion.isActive() || !deps.scrollRegion.isContentStreaming()) {
    return;
  }

  deps.runtimeState.enterToolInterrupt();
  deps.scrollRegion.endContentStreaming(footerState);
  deps.mdRenderer.beginNewSegment();
}
