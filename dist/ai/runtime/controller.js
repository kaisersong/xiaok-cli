let nextRunOrdinal = 0;
export class AgentRunController {
    active;
    startRun() {
        if (this.active) {
            throw new Error('cannot start a new run while another active run exists');
        }
        const controller = new AbortController();
        const runId = `run_${(nextRunOrdinal += 1)}`;
        this.active = { runId, controller };
        return { runId, signal: controller.signal };
    }
    hasActiveRun() {
        return Boolean(this.active);
    }
    abortActiveRun() {
        if (!this.active) {
            return false;
        }
        this.active.controller.abort();
        return true;
    }
    completeRun(runId) {
        if (this.active?.runId === runId) {
            this.active = undefined;
        }
    }
}
