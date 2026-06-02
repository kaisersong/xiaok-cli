export class TuiRuntimeState {
    options;
    liveActivityTimer = null;
    resumeActivityTimer = null;
    reassuranceTimer = null;
    pauseActivityTimer = null;
    interactivePromptDepth = 0;
    liveActivityFrame = 0;
    liveActivityVisible = false;
    responseStarted = false;
    lastReassuranceBucket = -1;
    turnActive = false;
    snapshot = {
        turnSurfaceState: 'input_ready',
        footerMode: 'input_ready',
        activityVisible: false,
        summarySource: 'none',
    };
    constructor(options) {
        this.options = options;
    }
    getSnapshot() {
        return { ...this.snapshot };
    }
    setSummarySource(summarySource) {
        this.snapshot.summarySource = summarySource;
    }
    getFooterInputPrompt() {
        return this.snapshot.footerMode === 'busy' ? 'Finishing response...' : 'Type your message...';
    }
    beginTurn(activityLabel = 'Thinking', options = {}) {
        this.turnActive = true;
        this.responseStarted = false;
        this.lastReassuranceBucket = -1;
        this.liveActivityFrame = 0;
        this.markBusyFinishing();
        if (!options.deferActivity) {
            this.beginActivity(activityLabel, true);
        }
        this.ensureReassuranceTimer();
    }
    noteResponseStarted() {
        this.responseStarted = true;
    }
    enterStreamingContent() {
        this.snapshot.turnSurfaceState = this.snapshot.footerMode === 'compat'
            ? 'compat_streaming'
            : 'streaming_content';
    }
    enterToolInterrupt() {
        this.snapshot.turnSurfaceState = 'tool_interrupt';
    }
    enterWaitingFeedback() {
        this.stopLiveActivityTimer();
        this.snapshot.turnSurfaceState = 'waiting_feedback';
        this.snapshot.footerMode = 'feedback';
    }
    markBusyFinishing() {
        this.snapshot.turnSurfaceState = 'busy_finishing';
        this.snapshot.footerMode = 'busy';
    }
    markInputReady() {
        this.snapshot.turnSurfaceState = 'input_ready';
        this.snapshot.footerMode = 'input_ready';
        this.snapshot.activityVisible = false;
    }
    markCompatInputReady() {
        this.snapshot.turnSurfaceState = 'compat_input_ready';
        this.snapshot.footerMode = 'compat';
        this.snapshot.activityVisible = false;
    }
    deactivateTurn() {
        this.turnActive = false;
    }
    beginActivity(label, restart = false, startedAt = Date.now()) {
        if (!this.turnActive && this.liveActivityTimer) {
            return;
        }
        this.clearResumeTimer();
        if (restart || !this.liveActivityTimer) {
            this.options.statusBar.beginActivity(label, startedAt);
        }
        else {
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
    scheduleActivityResume(label, delayMs = 180) {
        this.clearResumeTimer();
        this.resumeActivityTimer = setTimeout(() => {
            this.resumeActivityTimer = null;
            this.beginActivity(label);
        }, delayMs);
    }
    scheduleActivityPause(delayMs = 180) {
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
    ensureReassuranceTimer() {
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
    pauseActivity() {
        if (!this.liveActivityTimer || !this.liveActivityVisible) {
            return;
        }
        this.options.statusBar.clearLive();
        this.liveActivityVisible = false;
        this.snapshot.activityVisible = false;
        if (!this.options.scrollRegion.isContentStreaming()) {
            try {
                this.options.scrollRegion.clearActivity();
            }
            catch { }
        }
    }
    stopLiveActivityTimer() {
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
            }
            catch { }
        }
    }
    async withPausedLiveActivity(action) {
        const snapshot = this.options.statusBar.getActivitySnapshot();
        this.enterInteractivePrompt();
        try {
            return await action();
        }
        finally {
            this.exitInteractivePrompt();
            if (snapshot
                && !this.options.isTerminalUiSuspended()
                && this.turnActive
                && !this.options.scrollRegion.isContentStreaming()
                && this.interactivePromptDepth === 0) {
                this.beginActivity(snapshot.label, true, snapshot.startedAt);
            }
        }
    }
    enterInteractivePrompt() {
        this.interactivePromptDepth += 1;
        this.stopLiveActivityTimer();
    }
    exitInteractivePrompt() {
        this.interactivePromptDepth = Math.max(0, this.interactivePromptDepth - 1);
    }
    stopActivity() {
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
    destroy() {
        this.turnActive = false;
        this.stopActivity();
        this.markInputReady();
    }
    renderLiveActivity() {
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
        }
        catch (error) {
            this.options.onSuspendInteractiveUi('render_live_activity', error);
        }
    }
    clearResumeTimer() {
        if (this.resumeActivityTimer) {
            clearTimeout(this.resumeActivityTimer);
            this.resumeActivityTimer = null;
        }
    }
    clearPauseTimer() {
        if (this.pauseActivityTimer) {
            clearTimeout(this.pauseActivityTimer);
            this.pauseActivityTimer = null;
        }
    }
}
