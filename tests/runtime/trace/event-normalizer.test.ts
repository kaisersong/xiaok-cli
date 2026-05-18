import { describe, expect, it } from 'vitest';
import { normalizeDesktopRuntimeEvent, normalizeKSwarmProjectDetail, normalizeRuntimeEvent } from '../../../src/runtime/trace/normalizer.js';

describe('trace event normalizer', () => {
  it('normalizes runtime tool hook events into trace events', () => {
    expect(normalizeRuntimeEvent({
      type: 'pre_tool_use',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      toolName: 'bash',
      toolInput: { command: 'npm test' },
      toolUseId: 'tool-1',
    })).toEqual([
      expect.objectContaining({
        id: 'runtime:sess-1:turn-1:tool-1:pre_tool_use',
        source: 'tool',
        type: 'tool.started',
        refs: { turnId: 'turn-1', toolCallId: 'tool-1' },
      }),
    ]);

    expect(normalizeRuntimeEvent({
      type: 'post_tool_use_failure',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      toolName: 'bash',
      toolInput: { command: 'npm test' },
      toolUseId: 'tool-1',
      error: 'exit code 1',
    })).toEqual([
      expect.objectContaining({
        id: 'runtime:sess-1:turn-1:tool-1:post_tool_use_failure',
        severity: 'error',
        source: 'tool',
        type: 'tool.failed',
      }),
    ]);
  });

  it('normalizes KSwarm full detail while preserving new task and agent statuses', () => {
    const normalized = normalizeKSwarmProjectDetail({
      project: { id: 'proj-1', name: '技术大会演讲报告', status: 'active' },
      tasks: [
        { id: 'item-1', title: 'Accepted', status: 'accepted', assignedAgent: 'agent-1' },
        { id: 'item-2', title: 'Submitted', status: 'submitted', assignedAgent: 'agent-2' },
        { id: 'item-3', title: 'Blocked', status: 'blocked', blockedReason: 'missing_review_evidence' },
      ],
      agents: [
        { id: 'agent-1', name: 'Claude', status: 'waiting' },
        { id: 'agent-2', name: 'Codex', status: 'completed' },
      ],
      activities: [],
      humanActions: [],
      workspace: { path: '/Users/song/projects/customer', artifacts: [] },
      plan: null,
      planProgress: null,
      dispatchPlan: {
        dispatchable: [],
        blocked: [{ taskId: 'item-3', reason: 'missing_review_evidence' }],
        waiting: [{ taskId: 'item-1', reason: 'agent_busy', agentId: 'agent-1' }],
      },
      projectHealth: {
        status: 'blocked',
        primaryBlockedTaskId: 'item-3',
        message: '评审任务缺少证据',
      },
    });

    expect(normalized.tasks.map((task) => task.status)).toEqual(['accepted', 'submitted', 'blocked']);
    expect(normalized.agents.map((agent) => agent.status)).toEqual(['waiting', 'completed']);
    expect(normalized.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'kswarm.project_health', refs: { taskId: 'item-3' } }),
      expect.objectContaining({ type: 'kswarm.dispatch_blocked', refs: { taskId: 'item-3' } }),
    ]));
    expect(normalized.summary).toMatchObject({
      projectHealth: 'blocked',
      taskCount: 3,
      agentCount: 2,
    });
  });

  it('normalizes desktop artifact and file events without reading transcript text as authority', () => {
    expect(normalizeDesktopRuntimeEvent({
      type: 'artifact_written',
      sessionId: 'sess-1',
      artifactId: 'artifact-1',
      toolCallId: 'tool-1',
      path: '/Users/song/projects/report.md',
      kind: 'markdown',
    })).toEqual([
      expect.objectContaining({
        source: 'desktop',
        type: 'artifact.written',
        refs: { artifactId: 'artifact-1', toolCallId: 'tool-1' },
        data: { kind: 'markdown', path: '/Users/song/projects/report.md' },
      }),
    ]);

    expect(normalizeDesktopRuntimeEvent({
      type: 'file_changed',
      sessionId: 'sess-1',
      filePath: '/Users/song/projects/report.md',
      event: 'change',
    })).toEqual([
      expect.objectContaining({
        source: 'desktop',
        type: 'file.changed',
        data: { filePath: '/Users/song/projects/report.md', event: 'change' },
      }),
    ]);
  });
});
