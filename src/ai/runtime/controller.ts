export interface ActiveRun {
  runId: string;
  signal: AbortSignal;
}

let nextRunOrdinal = 0;

export class AgentRunController {
  private active:
    | {
        runId: string;
        controller: AbortController;
      }
    | undefined;

  startRun(): ActiveRun {
    if (this.active) {
      throw new Error('cannot start a new run while another active run exists');
    }

    const controller = new AbortController();
    const runId = `run_${(nextRunOrdinal += 1)}`;
    this.active = { runId, controller };
    return { runId, signal: controller.signal };
  }

  hasActiveRun(): boolean {
    return Boolean(this.active);
  }

  abortActiveRun(): boolean {
    if (!this.active) {
      return false;
    }

    this.active.controller.abort();
    return true;
  }

  completeRun(runId: string): void {
    if (this.active?.runId === runId) {
      this.active = undefined;
    }
  }
}
