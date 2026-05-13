import { describe, it, expect, vi } from 'vitest';
import { looksLikeMultiDeliverable, runDeliverableGate, type DeliverableGateFunction } from '../../../src/runtime/task-host/deliverable-gate.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

// ─── looksLikeMultiDeliverable ─────────────────────────────────────

describe('looksLikeMultiDeliverable', () => {
  const positives = [
    '把claude本月更新做一份报告写一份演示文稿',
    '根据claude本月的更新生成报告和演示文档',
    '做一份报告和一份PPT',
    '生成报告及演示文稿',
    '写一个总结，同时做一份PPT',
    '帮我写方案并做一份演示文稿',
    '一份文档一份PPT',
    '做报告，另外出一份幻灯片',
    '总结还有PPT都要',
    '一篇分析报告一个演示文稿',
    '写一份报告写一份slides',
  ];

  const negatives = [
    '帮我做一份报告',
    '写一份PPT',
    '分析这个文件',
    '这份报告写得怎么样',
    '把3个文件合并成一份报告',
    '今天天气怎么样',
    '解释一下Claude的更新',
    '帮我翻译这份文档',
  ];

  positives.forEach(p => {
    it(`positive: "${p}"`, () => {
      expect(looksLikeMultiDeliverable(p)).toBe(true);
    });
  });

  negatives.forEach(p => {
    it(`negative: "${p}"`, () => {
      expect(looksLikeMultiDeliverable(p)).toBe(false);
    });
  });
});

// ─── runDeliverableGate ─────────────────────────────────────────────

function makeSnapshot(overrides: Partial<TaskSnapshot> & { prompt: string }): TaskSnapshot {
  return {
    taskId: 'task-1',
    sessionId: 'sess-1',
    status: 'running',
    materials: [],
    events: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('runDeliverableGate', () => {
  it('skips gate for single-deliverable prompts', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockResolvedValue({ complete: true });
    const snapshot = makeSnapshot({ prompt: '帮我做一份报告' });
    const result = await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(result).toBe(true);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it('calls gate for multi-deliverable prompts when plan is complete', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockResolvedValue({ complete: true });
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份演示文稿',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '生成报告', status: 'completed' },
          { id: 's2', label: '生成演示文稿', status: 'completed' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(mockGate).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('returns false when gate says incomplete', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockResolvedValue({ complete: false, missing: ['演示文稿'] });
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份演示文稿',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '生成报告', status: 'completed' },
          { id: 's2', label: '生成演示文稿', status: 'completed' },
        ]},
        { type: 'artifact_recorded', artifactId: 'a1', kind: 'html', label: 'report.html', filePath: '/tmp/report.html', previewAvailable: true, turnId: 't1' },
      ],
    });
    const result = await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(result).toBe(false);
  });

  it('passes artifacts to gate function', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockResolvedValue({ complete: true });
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份PPT',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '报告', status: 'completed' },
          { id: 's2', label: 'PPT', status: 'completed' },
        ]},
        { type: 'artifact_recorded', artifactId: 'a1', kind: 'html', label: 'report.html', filePath: '/tmp/r.html', previewAvailable: true, turnId: 't1' },
        { type: 'artifact_recorded', artifactId: 'a2', kind: 'html', label: 'slides.html', filePath: '/tmp/s.html', previewAvailable: true, turnId: 't1' },
      ],
    });
    await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(mockGate.mock.calls[0][0].artifacts).toHaveLength(2);
    expect(mockGate.mock.calls[0][0].artifacts[0]).toEqual({ kind: 'html', label: 'report.html' });
  });

  it('defaults to pass when no gate and no plan events', async () => {
    const snapshot = makeSnapshot({ prompt: '做一份报告写一份演示文稿' });
    const result = await runDeliverableGate(snapshot, undefined, new AbortController().signal);
    expect(result).toBe(true);
  });

  it('fails open when gate throws', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockRejectedValue(new Error('network error'));
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份演示文稿',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '报告', status: 'completed' },
          { id: 's2', label: 'PPT', status: 'completed' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(result).toBe(true);
  });

  it('passes signal to gate function', async () => {
    const controller = new AbortController();
    const mockGate = vi.fn<DeliverableGateFunction>().mockImplementation(async (input) => {
      expect(input.signal).toBe(controller.signal);
      return { complete: true };
    });
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份PPT',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '报告', status: 'completed' },
          { id: 's2', label: 'PPT', status: 'completed' },
        ]},
      ],
    });
    await runDeliverableGate(snapshot, mockGate, controller.signal);
    expect(mockGate).toHaveBeenCalled();
  });

  // ─── Built-in plan check ────────────────────────────────────────────

  it('returns false when last plan has incomplete steps (no gate function)', async () => {
    const snapshot = makeSnapshot({
      prompt: '生成报告和演示文稿',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '搜索信息', status: 'completed' },
          { id: 's2', label: '编写报告', status: 'completed' },
          { id: 's3', label: '渲染报告', status: 'completed' },
          { id: 's4', label: '编写演示文稿', status: 'running' },
          { id: 's5', label: '渲染演示文稿', status: 'planned' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, undefined, new AbortController().signal);
    expect(result).toBe(false);
  });

  it('returns true when last plan has all steps completed (no gate function)', async () => {
    const snapshot = makeSnapshot({
      prompt: '生成报告和演示文稿',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '编写报告', status: 'completed' },
          { id: 's2', label: '编写演示文稿', status: 'completed' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, undefined, new AbortController().signal);
    expect(result).toBe(true);
  });

  it('uses the LAST plan event for built-in check', async () => {
    const snapshot = makeSnapshot({
      prompt: '生成报告和演示文档',
      events: [
        // First plan: still running
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '搜索', status: 'running' },
          { id: 's2', label: '报告', status: 'planned' },
        ]},
        // Second plan: step 2 still running
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '搜索', status: 'completed' },
          { id: 's2', label: '报告', status: 'running' },
          { id: 's3', label: '演示文稿', status: 'planned' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, undefined, new AbortController().signal);
    expect(result).toBe(false);
  });

  it('built-in check takes priority over gate function when plan is incomplete', async () => {
    const mockGate = vi.fn<DeliverableGateFunction>().mockResolvedValue({ complete: true });
    const snapshot = makeSnapshot({
      prompt: '做一份报告写一份PPT',
      events: [
        { type: 'progress_plan_reported', steps: [
          { id: 's1', label: '报告', status: 'completed' },
          { id: 's2', label: 'PPT', status: 'running' },
        ]},
      ],
    });
    const result = await runDeliverableGate(snapshot, mockGate, new AbortController().signal);
    expect(result).toBe(false);
    // Gate not called since built-in check already failed
    expect(mockGate).not.toHaveBeenCalled();
  });
});
