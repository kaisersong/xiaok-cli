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
