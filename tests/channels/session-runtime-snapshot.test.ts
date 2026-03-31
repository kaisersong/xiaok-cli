import { describe, expect, it } from 'vitest';
import { formatSessionRuntimeSnapshot } from '../../src/channels/session-runtime-snapshot.js';

describe('session runtime snapshot', () => {
  it('formats task, background jobs, approvals, binding, and capability health into one status view', () => {
    const snapshot = formatSessionRuntimeSnapshot({
      sessionId: 'sess_1',
      binding: {
        sessionId: 'sess_1',
        channel: 'yzj',
        chatId: 'robot-1',
        userId: 'openid-1',
        cwd: '/repo',
        repoRoot: '/repo',
        branch: 'main',
        updatedAt: 1,
      },
      taskStatus: '任务 task_1\n状态：running',
      backgroundJobs: [
        { jobId: 'job_1', status: 'completed', detail: 'done:background task' },
      ],
      approvals: [
        { approvalId: 'approval_1', summary: '执行 bash 命令：git push' },
      ],
      capabilityHealth: '平台能力状态：正常\nmcp:docs connected (2 tools)',
    });

    expect(snapshot).toContain('会话 sess_1');
    expect(snapshot).toContain('工作区：/repo');
    expect(snapshot).toContain('任务 task_1');
    expect(snapshot).toContain('job_1 [completed]');
    expect(snapshot).toContain('approval_1');
    expect(snapshot).toContain('平台能力状态：正常');
  });

  it('normalizes restart interruption errors into user-facing status text', () => {
    const snapshot = formatSessionRuntimeSnapshot({
      sessionId: 'sess_2',
      taskStatus: '任务 task_2\n状态：failed\n错误：task interrupted by process restart',
      backgroundJobs: [
        { jobId: 'job_2', status: 'failed', detail: 'background job interrupted by process restart' },
      ],
      approvals: [],
      capabilityHealth: '平台能力状态：正常\ncapabilities: none declared',
    });

    expect(snapshot).toContain('错误：进程重启后任务已中断，请重新发起');
    expect(snapshot).toContain('job_2 [failed] 进程重启后后台任务已中断');
    expect(snapshot).not.toContain('task interrupted by process restart');
    expect(snapshot).not.toContain('background job interrupted by process restart');
  });

  it('shows recovered interrupted tasks in a separate section from the current task', () => {
    const snapshot = formatSessionRuntimeSnapshot({
      sessionId: 'sess_3',
      taskStatus: '任务 task_live\n状态：running',
      recoveredTasks: [
        '任务 task_old\n状态：failed\n错误：task interrupted by process restart',
      ],
      backgroundJobs: [],
      approvals: [],
      capabilityHealth: '平台能力状态：正常\ncapabilities: none declared',
    });

    expect(snapshot).toContain('任务 task_live');
    expect(snapshot).toContain('最近恢复任务：');
    expect(snapshot).toContain('任务 task_old');
    expect(snapshot).toContain('错误：进程重启后任务已中断，请重新发起');
  });

  it('shows that there is no active task when only recovered tasks remain', () => {
    const snapshot = formatSessionRuntimeSnapshot({
      sessionId: 'sess_4',
      taskStatus: '当前任务：无',
      recoveredTasks: [
        '任务 task_recovered\n状态：failed\n错误：task interrupted by process restart',
      ],
      backgroundJobs: [],
      approvals: [],
      capabilityHealth: '平台能力状态：正常\ncapabilities: none declared',
    });

    expect(snapshot).toContain('当前任务：无');
    expect(snapshot).toContain('最近恢复任务：');
    expect(snapshot).toContain('任务 task_recovered');
  });
});
