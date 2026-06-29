import { describe, expect, it } from 'vitest';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import {
  buildMobileSnapshotFromSources,
  resolveMobileApprovalAnswer,
} from '../../electron/mobile-snapshot.js';

describe('mobile snapshot projection', () => {
  it('projects desktop tasks, approvals, loops, and artifacts into a bounded mobile snapshot', () => {
    const snapshot = buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      activeTaskId: 'task-waiting',
      now: Date.parse('2026-06-28T10:00:00.000Z'),
      mobileMessages: [{
        id: 'mobile-user-1',
        conversationId: 'task-mobile',
        role: 'user',
        text: 'from phone',
        createdAt: '2026-06-28T09:59:00.000Z',
        deliveryStatus: 'sent',
      }],
      snapshots: [
        taskSnapshot({
          taskId: 'task-waiting',
          status: 'waiting_user',
          prompt: 'Ship mobile pairing',
          updatedAt: Date.parse('2026-06-28T09:59:30.000Z'),
          events: [{
            type: 'needs_user',
            question: {
              questionId: 'q-approve',
              taskId: 'task-waiting',
              kind: 'assumption_approval',
              prompt: 'Allow the desktop task to continue?',
              choices: [
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ],
            },
          }],
        }),
        taskSnapshot({
          taskId: 'task-done',
          status: 'completed',
          prompt: 'Create report',
          updatedAt: Date.parse('2026-06-28T09:58:00.000Z'),
          result: {
            summary: 'Report ready',
            artifacts: [{
              artifactId: 'artifact-report',
              kind: 'pdf',
              title: 'report.pdf',
              createdAt: '2026-06-28T09:58:00.000Z',
              previewAvailable: true,
            }],
          },
        }),
      ],
      loopDefinitions: [{
        id: 'loop-daily',
        title: 'Daily loop',
        description: '',
        status: 'active',
        origin: 'user_template',
        createdAt: 1,
        updatedAt: 1,
      }],
      userLoopTemplates: [{
        loopId: 'loop-daily',
        kind: 'task_completion',
        prompt: 'daily',
        outputDirectory: '',
        outputFileName: '',
        scheduleEnabled: true,
        autoRunApproved: true,
        createdAt: 1,
        updatedAt: 1,
      }],
      loopRunsByLoopId: new Map([[
        'loop-daily',
        [{
          id: 'run-1',
          loopId: 'loop-daily',
          status: 'success',
          trigger: { kind: 'manual' },
          evidenceIds: [],
          startedAt: 1,
          finishedAt: 2,
          updatedAt: 2,
        }],
      ]]),
    });

    expect(snapshot.runningTurn).toMatchObject({
      id: 'task-waiting',
      title: 'Ship mobile pairing',
      status: 'waiting',
    });
    expect(snapshot.messages.map(message => message.text)).toContain('from phone');
    expect(snapshot.messages.map(message => message.text)).toContain('Report ready');
    expect(snapshot.messages.find(message => message.text === 'from phone')).toMatchObject({
      conversationId: 'task-mobile',
      deliveryStatus: 'sent',
    });
    expect(snapshot.messages.find(message => message.text === 'Report ready')).toMatchObject({
      conversationId: 'task-done',
    });
    expect(snapshot.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'task-waiting',
        title: 'Ship mobile pairing',
        status: 'waiting',
      }),
      expect.objectContaining({
        id: 'task-done',
        title: 'Create report',
        status: 'completed',
        lastMessagePreview: 'Report ready',
        messageCount: 2,
      }),
      expect.objectContaining({
        id: 'task-mobile',
        title: 'from phone',
        status: 'running',
        messageCount: 1,
      }),
    ]));
    expect(snapshot.projects.map(project => project.name)).toContain('Ship mobile pairing');
    expect(snapshot.approvals).toEqual([expect.objectContaining({
      id: 'task-waiting:q-approve',
      title: 'Allow the desktop task to continue?',
      status: 'pending',
    })]);
    expect(snapshot.loops).toEqual([expect.objectContaining({
      id: 'loop-daily',
      name: 'Daily loop',
      status: 'scheduled',
      lastRunStatus: 'success',
    })]);
    expect(snapshot.artifacts).toEqual([expect.objectContaining({
      id: 'artifact-report',
      name: 'report.pdf',
      kind: 'pdf',
      status: 'ready',
    })]);
  });

  it('resolves mobile approval decisions to explicit desktop question choices', () => {
    const question = {
      questionId: 'q-1',
      taskId: 'task-1',
      kind: 'assumption_approval' as const,
      prompt: 'Continue?',
      choices: [
        { id: 'continue', label: '继续' },
        { id: 'stop', label: '停止' },
      ],
    };

    expect(resolveMobileApprovalAnswer(question, 'approve')).toEqual({
      questionId: 'q-1',
      type: 'choice',
      choiceId: 'continue',
    });
    expect(resolveMobileApprovalAnswer(question, 'reject')).toEqual({
      questionId: 'q-1',
      type: 'choice',
      choiceId: 'stop',
    });
  });

  it('projects full task history and artifact preview metadata for mobile conversations', () => {
    const snapshot = buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      now: Date.parse('2026-06-28T10:10:00.000Z'),
      snapshots: [
        taskSnapshot({
          taskId: 'task-rich',
          status: 'completed',
          prompt: 'Build a markdown report',
          updatedAt: Date.parse('2026-06-28T10:09:00.000Z'),
          events: [
            { type: 'progress', message: 'Reading source notes', eventId: 'evt-progress-1' },
            { type: 'assistant_delta', delta: '## Report\n\n```mermaid\ngraph TD\nA-->B\n```', eventId: 'evt-assistant-1' },
            {
              type: 'artifact_recorded',
              artifactId: 'artifact-markdown',
              kind: 'markdown',
              label: 'report.md',
              filePath: '/tmp/report.md',
              previewAvailable: true,
              turnId: 'task-rich',
              mimeType: 'text/markdown',
            },
          ],
          result: {
            summary: '**Done** with report artifacts.',
            artifacts: [{
              artifactId: 'artifact-summary',
              kind: 'text',
              title: 'summary.txt',
              createdAt: '2026-06-28T10:09:00.000Z',
              previewAvailable: true,
              filePath: '/tmp/summary.txt',
              mimeType: 'text/plain',
              sizeBytes: 42,
            }],
          },
        }),
      ],
    });

    const richConversation = snapshot.conversations.find(conversation => conversation.id === 'task-rich');
    expect(richConversation).toMatchObject({
      id: 'task-rich',
      title: 'Build a markdown report',
      status: 'completed',
      messageCount: 4,
    });
    expect(snapshot.messages.filter(message => message.conversationId === 'task-rich').map(message => message.text)).toEqual([
      'Build a markdown report',
      'Reading source notes',
      '## Report\n\n```mermaid\ngraph TD\nA-->B\n```',
      '**Done** with report artifacts.',
    ]);
    expect(snapshot.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'artifact-markdown',
        name: 'report.md',
        kind: 'markdown',
        source: 'task-rich',
        status: 'ready',
        previewAvailable: true,
        mimeType: 'text/markdown',
      }),
      expect.objectContaining({
        id: 'artifact-summary',
        name: 'summary.txt',
        kind: 'text',
        source: 'task-rich',
        previewAvailable: true,
        mimeType: 'text/plain',
        sizeBytes: 42,
      }),
    ]));
  });

  it('projects kswarm project details and project-owned artifacts for mobile work views', () => {
    const snapshot = buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      now: Date.parse('2026-06-28T10:15:00.000Z'),
      snapshots: [],
      kswarmProjects: [
        {
          id: 'proj-alpha',
          name: 'Alpha project',
          goal: 'Compare desktop and mobile task outputs',
          requirements: 'Show project details and artifacts on mobile.',
          summary: 'Two project artifacts are ready.',
          status: 'active',
          taskCount: 5,
          doneCount: 3,
          stoppedCount: 1,
          updatedAt: Date.parse('2026-06-28T10:14:00.000Z'),
          deliverable: {
            artifacts: [
              {
                path: 'artifacts/desktop-mobile-review.md',
                kind: 'markdown',
                label: 'desktop-mobile-review.md',
                mimeType: 'text/markdown',
                sizeBytes: 101,
              },
            ],
          },
          workspaceArtifacts: [
            {
              path: '/tmp/alpha/artifacts/mobile-project-report.html',
              kind: 'html',
              label: 'mobile-project-report.html',
              mimeType: 'text/html',
              sizeBytes: 202,
            },
          ],
        } as any,
      ],
    });

    expect(snapshot.projects).toEqual([
      expect.objectContaining({
        id: 'proj-alpha',
        name: 'Alpha project',
        goal: 'Compare desktop and mobile task outputs',
        requirements: 'Show project details and artifacts on mobile.',
        summary: 'Two project artifacts are ready.',
        progress: 0.6,
        activeTasks: 1,
        taskCount: 5,
        doneCount: 3,
        stoppedCount: 1,
        artifactCount: 2,
      }),
    ]);
    expect(snapshot.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'desktop-mobile-review.md',
        kind: 'markdown',
        source: 'proj-alpha',
        status: 'ready',
        previewAvailable: true,
        mimeType: 'text/markdown',
        sizeBytes: 101,
      }),
      expect.objectContaining({
        name: 'mobile-project-report.html',
        kind: 'html',
        source: 'proj-alpha',
        status: 'ready',
        previewAvailable: true,
        mimeType: 'text/html',
        sizeBytes: 202,
      }),
    ]));
  });

  it('coalesces streamed assistant deltas into one mobile task message without splitting markdown blocks', () => {
    const snapshot = buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      now: Date.parse('2026-06-28T10:20:00.000Z'),
      snapshots: [
        taskSnapshot({
          taskId: 'task-streamed',
          status: 'completed',
          prompt: 'Explain the mobile sync plan',
          createdAt: Date.parse('2026-06-28T10:18:00.000Z'),
          updatedAt: Date.parse('2026-06-28T10:19:00.000Z'),
          events: [
            { type: 'assistant_delta', delta: '## Plan\n\n', eventId: 'evt-delta-1', ts: Date.parse('2026-06-28T10:18:01.000Z') },
            { type: 'assistant_delta', delta: '- Keep LAN first\n', eventId: 'evt-delta-2', ts: Date.parse('2026-06-28T10:18:02.000Z') },
            { type: 'assistant_delta', delta: '- Fall back to relay\n\n', eventId: 'evt-delta-3', ts: Date.parse('2026-06-28T10:18:03.000Z') },
            { type: 'assistant_delta', delta: '```mermaid\ngraph TD\nPhone[Phone] --> Desktop[Desktop]\n```\n', eventId: 'evt-delta-4', ts: Date.parse('2026-06-28T10:18:04.000Z') },
          ],
        }),
      ],
    });

    const messages = snapshot.messages.filter(message => message.conversationId === 'task-streamed');

    expect(messages.map(message => message.id)).toEqual([
      'desktop-prompt-task-streamed',
      'desktop-assistant-task-streamed',
    ]);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      text: '## Plan\n\n- Keep LAN first\n- Fall back to relay\n\n```mermaid\ngraph TD\nPhone[Phone] --> Desktop[Desktop]\n```',
    });
    expect(snapshot.conversations.find(conversation => conversation.id === 'task-streamed')).toMatchObject({
      messageCount: 2,
      lastMessagePreview: '## Plan\n\n- Keep LAN first\n- Fall back to relay\n\n```mermaid\ngraph TD\nPhone[Phone] --> Desktop[Desktop]\n```',
    });
  });

  it('keeps at least openable messages for every returned desktop conversation when the global message budget is exceeded', () => {
    const baseTime = Date.parse('2026-06-28T11:00:00.000Z');
    const snapshot = buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      now: baseTime + 30_000,
      snapshots: Array.from({ length: 20 }, (_, taskIndex) => taskSnapshot({
        taskId: `task-over-budget-${taskIndex}`,
        status: 'completed',
        prompt: `Task ${taskIndex}`,
        createdAt: baseTime + taskIndex * 1_000,
        updatedAt: baseTime + taskIndex * 1_000 + 900,
        events: Array.from({ length: 18 }, (_, eventIndex) => ({
          type: 'progress',
          message: `Task ${taskIndex} progress ${eventIndex}`,
          eventId: `evt-${taskIndex}-${eventIndex}`,
        })),
        result: {
          summary: `Task ${taskIndex} done`,
          artifacts: [],
        },
      })),
    });

    expect(snapshot.messages.length).toBeLessThanOrEqual(120);
    expect(snapshot.conversations).toHaveLength(20);
    expect(snapshot.conversations.every(conversation => conversation.messageCount > 0)).toBe(true);
    expect(snapshot.messages.some(message => message.conversationId === 'task-over-budget-0')).toBe(true);
    expect(snapshot.messages.filter(message => message.conversationId === 'task-over-budget-0').map(message => message.text)).toEqual(
      expect.arrayContaining(['Task 0', 'Task 0 done']),
    );
  });
});

function taskSnapshot(input: Partial<TaskSnapshot> & Pick<TaskSnapshot, 'taskId' | 'status' | 'prompt'>): TaskSnapshot {
  return {
    sessionId: `${input.taskId}-session`,
    materials: [],
    events: [],
    createdAt: input.updatedAt ?? 1,
    updatedAt: input.updatedAt ?? 1,
    ...input,
  };
}
