import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, ToolDefinition } from '../../../src/types.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

const adapterState = vi.hoisted(() => ({
  streamCalls: 0,
  toolCounts: [] as number[],
  emptySecondTurn: false,
}));

vi.mock('../../../src/ai/models.js', () => ({
  createAdapter: vi.fn(() => ({
    getModelName: () => 'unit-test-model',
    async *stream(_messages: Message[], tools: ToolDefinition[]) {
      adapterState.streamCalls += 1;
      adapterState.toolCounts.push(tools.length);
      if (tools.length === 0) {
        yield {
          type: 'text',
          delta: JSON.stringify({
            output: {
              summary: 'finalized from prior tool results',
              artifacts: [],
              evidenceRefs: ['tool-results'],
            },
          }),
        };
        return;
      }
      if (adapterState.emptySecondTurn && adapterState.streamCalls === 2) {
        return;
      }
      yield {
        type: 'tool_use',
        id: `tool_${adapterState.streamCalls}`,
        name: 'report_progress',
        input: {
          steps: [
            { id: `step-${adapterState.streamCalls}`, label: 'collect evidence', status: 'running' },
          ],
        },
      };
    },
  })),
}));

const { createDesktopServices } = await import('../../electron/desktop-services.js');

function mockKSwarmService(): KSwarmService {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {},
    request: async () => new Response('{"error":"mock"}', { status: 501 }),
  };
}

describe('desktop runner finalization', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-runner-finalization-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
    adapterState.streamCalls = 0;
    adapterState.toolCounts = [];
    adapterState.emptySecondTurn = false;
  });

  afterEach(() => {
    // The task host persists snapshots asynchronously after the runner returns.
    // Deleting the temp root here races Windows rename() and creates false failures.
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('runs a no-tool finalization turn after exhausting tool-only iterations', async () => {
    const workFolder = join(rootDir, 'workflow-project');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-finalize',
        workflowRunId: 'wf-proj-finalize-1',
        workflowId: 'dynamic_research_workflow',
        nodeId: 'script-agent-4',
        nodeKind: 'agent_task',
        nodeTitle: 'Research node',
        attempt: 1,
        handoffId: 'wfhd-script-agent-4',
        project: { id: 'proj-finalize', name: 'AI infrastructure', goal: 'Collect updates', status: 'active', workFolder },
        input: { prompt: 'Collect AI infrastructure updates and return structured JSON.' },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(adapterState.streamCalls).toBe(21);
    expect(adapterState.toolCounts.slice(0, 20).every((count) => count > 0)).toBe(true);
    expect(adapterState.toolCounts[20]).toBe(0);
    expect(result.output?.summary).toBe('finalized from prior tool results');
  });

  it('runs a no-tool finalization turn when the model returns an empty turn after tool results', async () => {
    adapterState.emptySecondTurn = true;
    const workFolder = join(rootDir, 'workflow-project-empty-turn');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-finalize-empty',
        workflowRunId: 'wf-proj-finalize-empty-1',
        workflowId: 'dynamic_research_workflow',
        nodeId: 'script-agent-9',
        nodeKind: 'agent_task',
        nodeTitle: 'Research node',
        attempt: 1,
        handoffId: 'wfhd-script-agent-9',
        project: { id: 'proj-finalize-empty', name: 'AI infrastructure', goal: 'Collect updates', status: 'active', workFolder },
        input: { prompt: 'Collect AI infrastructure updates and return structured JSON.' },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(adapterState.streamCalls).toBe(3);
    expect(adapterState.toolCounts).toEqual([
      expect.any(Number),
      expect.any(Number),
      0,
    ]);
    expect(adapterState.toolCounts[0]).toBeGreaterThan(0);
    expect(adapterState.toolCounts[1]).toBeGreaterThan(0);
    expect(result.output?.summary).toBe('finalized from prior tool results');
  });
});
