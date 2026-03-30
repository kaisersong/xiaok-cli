import { describe, expect, it } from 'vitest';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';

describe('AgentRunController', () => {
  it('creates a unique run id and marks the run active', () => {
    const controller = new AgentRunController();

    const run = controller.startRun();

    expect(run.runId).toMatch(/^run_/);
    expect(controller.hasActiveRun()).toBe(true);
  });

  it('rejects starting a second run while one is active', () => {
    const controller = new AgentRunController();

    controller.startRun();

    expect(() => controller.startRun()).toThrow(/active run/i);
  });

  it('aborts the active run signal', () => {
    const controller = new AgentRunController();
    const run = controller.startRun();

    controller.abortActiveRun();

    expect(run.signal.aborted).toBe(true);
  });

  it('clears the active run when completeRun is called', () => {
    const controller = new AgentRunController();
    const run = controller.startRun();

    controller.completeRun(run.runId);

    expect(controller.hasActiveRun()).toBe(false);
  });
});
