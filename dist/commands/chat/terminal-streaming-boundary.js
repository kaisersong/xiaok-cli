export function renderFooterChromeInOrder(deps, footerState) {
    if (!deps.scrollRegion.isActive()) {
        return;
    }
    if (deps.scrollRegion.isContentStreaming()) {
        deps.scrollRegion.endContentStreaming(footerState);
        deps.mdRenderer.beginNewSegment();
    }
    else {
        deps.scrollRegion.renderFooter(footerState);
    }
    deps.replRenderer.prepareForInput();
}
/**
 * Attach the scroll-region-aware cursor bookkeeping callbacks before the next
 * assistant chunk is rendered. Called for every non-empty delta, so the
 * re-entry branch must stay free of absolute repositioning side effects beyond
 * restoring the tracked cursor.
 */
export function ensureStreamingPhaseInOrder(deps) {
    const attachCallbacks = () => {
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
        }
        else {
            deps.writeFallback(assistantLeadIn);
        }
    }
    deps.stopLiveActivityTimer();
    deps.scrollRegion.beginContentStreaming();
    deps.runtimeState.enterStreamingContent();
    attachCallbacks();
}
export function endStreamingPhaseForInterruptInOrder(deps, footerState) {
    if (!deps.scrollRegion.isActive() || !deps.scrollRegion.isContentStreaming()) {
        return;
    }
    deps.runtimeState.enterToolInterrupt();
    deps.scrollRegion.endContentStreaming(footerState);
    deps.mdRenderer.beginNewSegment();
}
