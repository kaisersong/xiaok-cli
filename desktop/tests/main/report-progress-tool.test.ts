// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createReportProgressTool } from '../../electron/desktop-services.js';

// Exercise the production tool, not a test copy of its validation or parser.
async function executeReportProgress(input: unknown): Promise<string> {
  return createReportProgressTool().execute(input as Record<string, unknown>);
}
function parseResult(result: string) { return JSON.parse(result); }

describe('report_progress tool validation', async () => {
  it('validates a well-formed steps array', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [
        { id: 'step-1', label: '分析需求', status: 'completed' },
        { id: 'step-2', label: '生成方案', status: 'running' },
        { id: 'step-3', label: '输出文档', status: 'planned' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(3);
    expect(result._validated).toEqual([
      { id: 'step-1', label: '分析需求', status: 'completed' },
      { id: 'step-2', label: '生成方案', status: 'running' },
      { id: 'step-3', label: '输出文档', status: 'planned' },
    ]);
  });

  it('returns error when steps is not an array', async () => {
    const result = parseResult(await executeReportProgress({ steps: 'not-an-array' }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('steps must be an array');
  });

  it('returns error when steps field is missing', async () => {
    const result = parseResult(await executeReportProgress({}));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('steps must be an array');
  });

  it('skips entries with missing id', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [
        { id: '', label: '空id', status: 'planned' },
        { id: 'step-1', label: '有id', status: 'running' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
    expect(result._validated![0].id).toBe('step-1');
  });

  it('skips entries with missing label', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [
        { id: 'step-1', label: '', status: 'planned' },
        { id: 'step-2', label: '有label', status: 'completed' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
    expect(result._validated![0].id).toBe('step-2');
  });

  it('skips null and undefined entries in the array', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [null, undefined, { id: 'step-1', label: '正常', status: 'planned' }],
    }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
  });

  it('falls back invalid status to planned', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [
        { id: 'step-1', label: '未知状态', status: 'invalid_status' },
        { id: 'step-2', label: '正常状态', status: 'blocked' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result._validated![0].status).toBe('planned');
    expect(result._validated![1].status).toBe('blocked');
  });

  it('coerces non-string id and label to strings', async () => {
    const result = parseResult(await executeReportProgress({
      steps: [
        { id: 123, label: 456, status: 'running' },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result._validated![0].id).toBe('123');
    expect(result._validated![0].label).toBe('456');
  });

  it('handles empty steps array gracefully', async () => {
    const result = parseResult(await executeReportProgress({ steps: [] }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(0);
    expect(result._validated).toEqual([]);
  });

  it('accepts all valid status values', async () => {
    const statuses = ['planned', 'running', 'completed', 'blocked', 'failed'];
    const steps = statuses.map((status, i) => ({ id: `step-${i}`, label: `步骤${i}`, status }));
    const result = parseResult(await executeReportProgress({ steps }));
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(5);
    for (let i = 0; i < statuses.length; i++) {
      expect(result._validated![i].status).toBe(statuses[i]);
    }
  });
});

describe('report_progress tool - deliverable reminder (Layer 2)', async () => {
  it('returns reminder when all steps are completed', async () => {
    const result = await executeReportProgress({
      steps: [
        { id: 'step-1', label: '生成报告', status: 'completed' },
        { id: 'step-2', label: '生成演示文稿', status: 'completed' },
      ],
    });
    expect(result).toContain('_validated');
    expect(result).toContain('所有步骤已标记完成');
    expect(result).toContain('确认是否所有要求的交付物都已生成');
  });

  it('does NOT return reminder when steps still running', async () => {
    const result = await executeReportProgress({
      steps: [
        { id: 'step-1', label: '生成报告', status: 'completed' },
        { id: 'step-2', label: '生成演示文稿', status: 'running' },
      ],
    });
    expect(result).not.toContain('所有步骤已标记完成');
  });

  it('does NOT return reminder for empty steps array', async () => {
    const result = await executeReportProgress({ steps: [] });
    expect(result).not.toContain('所有步骤已标记完成');
  });

  it('returns reminder even for single completed step', async () => {
    const result = await executeReportProgress({
      steps: [{ id: 'step-1', label: '回答问题', status: 'completed' }],
    });
    expect(result).toContain('所有步骤已标记完成');
  });

  it('the entire result remains JSON when completion guidance is included', async () => {
    const result = await executeReportProgress({
      steps: [
        { id: 'step-1', label: '完成', status: 'completed' },
      ],
    });
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed._validated).toHaveLength(1);
  });
});
