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
export function endStreamingPhaseForInterruptInOrder(deps, footerState) {
    if (!deps.scrollRegion.isActive() || !deps.scrollRegion.isContentStreaming()) {
        return;
    }
    deps.runtimeState.enterToolInterrupt();
    deps.scrollRegion.endContentStreaming(footerState);
    deps.mdRenderer.beginNewSegment();
}
