import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { createDesktopServices } from '../../electron/desktop-services.js';

// End-to-end coverage for the historical workflow-artifact recovery layer that came
// from agent/workflow-artifact-canvas. It is wired into services.recoverTask and had
// zero coverage after the merge, so this drives the whole chain:
//   recoverTask -> findHistoricalWorkflowStatusLookup -> get_dynamic_workflow_status
//   -> resolveKSwarmWorkflowStatusArtifacts -> overlayHistoricalWorkflowArtifacts

const PROJECT_ID = 'project-1';
const WORKFLOW_RUN_ID = 'workflow-1';
const TASK_ID = 'task-hist-1';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('historical workflow artifact recovery (e2e through recoverTask)', () => {
  let dataRoot: string;
  let workspaceRoot: string;

  beforeEach(() => {
    const base = join(tmpdir(), `xiaok-hist-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataRoot = join(base, 'data');
    workspaceRoot = join(base, 'workspace');
    mkdirSync(join(dataRoot, 'tasks', 'snapshots'), { recursive: true });
    mkdirSync(join(workspaceRoot, 'artifacts'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'artifacts', 'report.html'), '<!doctype html><title>R</title>');
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function kswarmMock(options: { includeProjectWorkspace: boolean }): KSwarmService {
    return {
      start: async () => {},
      stop: async () => {},
      restart: async () => {},
      getStatus: () => ({ running: true, port: 1, pid: 1, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {},
      request: async (path: string) => {
        if (path === `/projects/${PROJECT_ID}/workflows/${WORKFLOW_RUN_ID}`) {
          return jsonResponse({
            workflowRun: {
              id: WORKFLOW_RUN_ID,
              status: 'completed',
              scriptResult: {
                producerAgent: 'xiaok-worker',
                artifacts: [{ path: 'artifacts/report.html', kind: 'html', label: 'report.html' }],
              },
            },
          });
        }
        if (path === `/projects/${PROJECT_ID}`) {
          return options.includeProjectWorkspace
            ? jsonResponse({ workspace: { path: workspaceRoot } })
            : jsonResponse({});
        }
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      },
    } as unknown as KSwarmService;
  }

  // A completed task whose only trace of produced files is a successful
  // get_dynamic_workflow_status tool call — i.e. nothing was recorded as an artifact.
  function persistHistoricalSnapshot(): void {
    const snapshot: TaskSnapshot = {
      taskId: TASK_ID,
      sessionId: 'sess_123e4567-e89b-42d3-a456-426614174000',
      status: 'completed',
      prompt: 'run the workflow',
      materials: [],
      events: [
        {
          type: 'canvas_tool_call',
          toolName: 'get_dynamic_workflow_status',
          input: { projectId: PROJECT_ID, workflowRunId: WORKFLOW_RUN_ID },
          toolUseId: 'call-1',
          eventId: 'turn-1:canvas:call-1',
        },
        {
          type: 'canvas_tool_result',
          toolName: 'get_dynamic_workflow_status',
          toolUseId: 'call-1',
          ok: true,
          response: '{}',
          eventId: 'turn-1:canvas:call-1:result',
        },
        { type: 'result', result: { summary: 'workflow finished', artifacts: [] } },
      ],
      result: { summary: 'workflow finished', artifacts: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeFileSync(
      join(dataRoot, 'tasks', 'snapshots', `${TASK_ID}.json`),
      JSON.stringify(snapshot),
      'utf-8',
    );
  }

  it('recovers workflow artifacts into a historical snapshot that recorded none', async () => {
    persistHistoricalSnapshot();
    const services = createDesktopServices({
      dataRoot,
      kswarmService: kswarmMock({ includeProjectWorkspace: true }),
    });

    const { snapshot } = await services.recoverTask(TASK_ID);

    const artifactEvents = snapshot.events.filter(event => event.type === 'artifact_recorded');
    expect(artifactEvents).toHaveLength(1);
    expect(artifactEvents[0]).toMatchObject({ type: 'artifact_recorded', label: 'report.html' });
    expect(snapshot.result?.artifacts.map(artifact => artifact.title)).toEqual(['report.html']);
  });

  it('leaves the snapshot untouched when the workspace cannot be resolved', async () => {
    persistHistoricalSnapshot();
    const services = createDesktopServices({
      dataRoot,
      kswarmService: kswarmMock({ includeProjectWorkspace: false }),
    });

    const { snapshot } = await services.recoverTask(TASK_ID);

    expect(snapshot.events.filter(event => event.type === 'artifact_recorded')).toEqual([]);
    expect(snapshot.result?.artifacts).toEqual([]);
  });
});
