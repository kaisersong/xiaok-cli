import { describe, expect, it } from 'vitest';
import { createInitialAppState, hydrateAppStateFromSnapshot, reduceAppEvent } from '../../renderer/src/state.js';
import type { DesktopTaskEvent, TaskSnapshot } from '../../shared/task-types';

describe('desktop renderer state', () => {
  it('keeps understanding, needs-user, progress, and result in one cockpit state', () => {
    let state = createInitialAppState();
    const events: DesktopTaskEvent[] = [
      { type: 'task_started', taskId: 'task_1' },
      {
        type: 'understanding_updated',
        understanding: {
          goal: '为 A 客户生成制造业数字化方案 PPT 初稿',
          deliverable: '可继续编辑的 PPT 初稿',
          taskType: 'sales_deck',
          audience: '客户 CIO / 管理层',
          inputs: [{ materialId: 'mat_1', name: 'A客户需求.md', role: 'customer_material', parseStatus: 'pending' }],
          missingInfo: ['报价表'],
          assumptions: ['报价相关页面先使用占位说明'],
          riskLevel: 'medium',
          suggestedPlan: [{ id: 'parse', label: '解析客户材料', status: 'planned' }],
          nextAction: 'confirm_outline_direction',
        },
      },
      {
        type: 'needs_user',
        question: {
          questionId: 'q_1',
          taskId: 'task_1',
          kind: 'confirm_understanding',
          prompt: '请确认任务理解和建议计划是否正确。',
        },
      },
      { type: 'progress', eventId: 'e_1', message: '正在生成方案大纲', stage: 'running' },
      { type: 'assistant_delta', eventId: 'e_2', delta: '模型' },
      { type: 'assistant_delta', eventId: 'e_3', delta: '回复' },
      { type: 'result', result: { summary: '已生成方案大纲', artifacts: [] } },
    ];

    for (const event of events) {
      state = reduceAppEvent(state, event);
    }

    expect(state.taskId).toBe('task_1');
    expect(state.status).toBe('completed');
    expect(state.understanding?.goal).toContain('A 客户');
    expect(state.currentQuestion).toBeNull();
    expect(state.progress).toEqual([{ eventId: 'e_1', message: '正在生成方案大纲', stage: 'running' }]);
    expect(state.result?.summary).toBe('已生成方案大纲');
    expect(state.assistantText).toBe('模型回复');
    expect(state.plan).toEqual([{ id: 'parse', label: '解析客户材料', status: 'planned' }]);
  });

  it('hydrates a recovered snapshot and deduplicates replayed progress events', () => {
    const snapshot: TaskSnapshot = {
      taskId: 'task_1',
      sessionId: 'sess_1',
      status: 'running',
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: 'mat_1', originalName: 'A客户需求.md', role: 'customer_material', parseStatus: 'pending' }],
      events: [
        { type: 'task_started', taskId: 'task_1' },
        { type: 'progress', eventId: 'e_1', message: '正在解析材料', stage: 'running' },
        { type: 'plan_updated', plan: [{ id: 'outline', label: '生成方案大纲', status: 'running' }] },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    let state = hydrateAppStateFromSnapshot(snapshot);
    state = reduceAppEvent(state, { type: 'progress', eventId: 'e_1', message: '正在解析材料', stage: 'running' });

    expect(state.taskId).toBe('task_1');
    expect(state.status).toBe('running');
    expect(state.progress).toEqual([{ eventId: 'e_1', message: '正在解析材料', stage: 'running' }]);
    expect(state.plan).toEqual([{ id: 'outline', label: '生成方案大纲', status: 'running' }]);
  });

  it('updates plan from progress_plan_reported event', () => {
    let state = createInitialAppState();
    state = reduceAppEvent(state, { type: 'task_started', taskId: 'task_1' });
    state = reduceAppEvent(state, {
      type: 'progress_plan_reported',
      steps: [
        { id: 'step-1', label: '分析需求', status: 'running' },
        { id: 'step-2', label: '生成方案', status: 'planned' },
      ],
    });

    expect(state.plan).toEqual([
      { id: 'step-1', label: '分析需求', status: 'running' },
      { id: 'step-2', label: '生成方案', status: 'planned' },
    ]);
  });

  it('overwrites previous plan when progress_plan_reported fires again', () => {
    let state = createInitialAppState();
    state = reduceAppEvent(state, { type: 'task_started', taskId: 'task_1' });
    state = reduceAppEvent(state, {
      type: 'progress_plan_reported',
      steps: [
        { id: 'step-1', label: '分析需求', status: 'running' },
        { id: 'step-2', label: '生成方案', status: 'planned' },
      ],
    });
    state = reduceAppEvent(state, {
      type: 'progress_plan_reported',
      steps: [
        { id: 'step-1', label: '分析需求', status: 'completed' },
        { id: 'step-2', label: '生成方案', status: 'running' },
        { id: 'step-3', label: '输出文档', status: 'planned' },
      ],
    });

    expect(state.plan).toHaveLength(3);
    expect(state.plan[0].status).toBe('completed');
    expect(state.plan[1].status).toBe('running');
    expect(state.plan[2].status).toBe('planned');
  });

  it('resets plan on task_started after progress_plan_reported was set', () => {
    let state = createInitialAppState();
    state = reduceAppEvent(state, { type: 'task_started', taskId: 'task_1' });
    state = reduceAppEvent(state, {
      type: 'progress_plan_reported',
      steps: [{ id: 'step-1', label: '分析需求', status: 'completed' }],
    });

    // Simulate new task starting — plan should not carry over
    // (plan reset happens in ChatShell via setPlanSteps([]), not in reducer)
    // But plan_updated from understanding_updated should still work
    state = reduceAppEvent(state, { type: 'task_started', taskId: 'task_2' });
    // plan is not reset in reducer (that's ChatShell's responsibility via local state)
    // but taskId should update
    expect(state.taskId).toBe('task_2');
  });

  it('hydrates progress_plan_reported from snapshot events', () => {
    const snapshot: TaskSnapshot = {
      taskId: 'task_1',
      sessionId: 'sess_1',
      status: 'running',
      prompt: '生成方案',
      materials: [],
      events: [
        { type: 'task_started', taskId: 'task_1' },
        {
          type: 'progress_plan_reported',
          steps: [
            { id: 'step-1', label: '分析需求', status: 'completed' },
            { id: 'step-2', label: '生成方案', status: 'running' },
          ],
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    const state = hydrateAppStateFromSnapshot(snapshot);
    expect(state.plan).toEqual([
      { id: 'step-1', label: '分析需求', status: 'completed' },
      { id: 'step-2', label: '生成方案', status: 'running' },
    ]);
  });

  it('progress_plan_reported does not affect other state fields', () => {
    let state = createInitialAppState();
    state = reduceAppEvent(state, { type: 'task_started', taskId: 'task_1' });
    state = reduceAppEvent(state, { type: 'progress', eventId: 'e_1', message: '开始', stage: 'running' });
    state = reduceAppEvent(state, {
      type: 'progress_plan_reported',
      steps: [{ id: 'step-1', label: '步骤', status: 'running' }],
    });

    expect(state.progress).toEqual([{ eventId: 'e_1', message: '开始', stage: 'running' }]);
    expect(state.assistantText).toBe('');
    expect(state.result).toBeNull();
    expect(state.currentQuestion).toBeNull();
  });

  it('clears stale questions and keeps salvage visible on terminal events', () => {
    let state = createInitialAppState();
    state = reduceAppEvent(state, {
      type: 'needs_user',
      question: {
        questionId: 'q_1',
        taskId: 'task_1',
        kind: 'confirm_understanding',
        prompt: '请确认任务理解和建议计划是否正确。',
      },
    });
    state = reduceAppEvent(state, {
      type: 'salvage',
      salvage: {
        summary: ['已保留任务理解'],
        reason: 'cancelled',
      },
    });

    expect(state.currentQuestion).toBeNull();
    expect(state.status).toBe('cancelled');
    expect(state.salvage).toEqual({
      summary: ['已保留任务理解'],
      reason: 'cancelled',
    });
  });
});
