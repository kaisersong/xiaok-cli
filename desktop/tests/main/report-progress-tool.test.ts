import { describe, it, expect } from 'vitest';

/**
 * Unit tests for the report_progress tool execute logic.
 * We extract the validation logic to test it independently of desktop-services wiring.
 */

// Replicate the execute logic from desktop-services.ts to unit-test in isolation
function executeReportProgress(input: unknown): { ok: boolean; displayed_steps?: number; error?: string; _validated?: Array<{ id: string; label: string; status: string }> } {
  const { steps } = input as { steps: unknown };
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'steps must be an array' };
  }
  const validStatuses = new Set(['planned', 'running', 'completed', 'blocked', 'failed']);
  const validated: Array<{ id: string; label: string; status: string }> = [];
  for (const s of steps) {
    if (!s || !s.id || !s.label) continue;
    validated.push({
      id: String(s.id),
      label: String(s.label),
      status: validStatuses.has(s.status) ? s.status : 'planned',
    });
  }
  return { ok: true, displayed_steps: validated.length, _validated: validated };
}

describe('report_progress tool validation', () => {
  it('validates a well-formed steps array', () => {
    const result = executeReportProgress({
      steps: [
        { id: 'step-1', label: '分析需求', status: 'completed' },
        { id: 'step-2', label: '生成方案', status: 'running' },
        { id: 'step-3', label: '输出文档', status: 'planned' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(3);
    expect(result._validated).toEqual([
      { id: 'step-1', label: '分析需求', status: 'completed' },
      { id: 'step-2', label: '生成方案', status: 'running' },
      { id: 'step-3', label: '输出文档', status: 'planned' },
    ]);
  });

  it('returns error when steps is not an array', () => {
    const result = executeReportProgress({ steps: 'not-an-array' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('steps must be an array');
  });

  it('returns error when steps field is missing', () => {
    const result = executeReportProgress({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('steps must be an array');
  });

  it('skips entries with missing id', () => {
    const result = executeReportProgress({
      steps: [
        { id: '', label: '空id', status: 'planned' },
        { id: 'step-1', label: '有id', status: 'running' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
    expect(result._validated![0].id).toBe('step-1');
  });

  it('skips entries with missing label', () => {
    const result = executeReportProgress({
      steps: [
        { id: 'step-1', label: '', status: 'planned' },
        { id: 'step-2', label: '有label', status: 'completed' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
    expect(result._validated![0].id).toBe('step-2');
  });

  it('skips null and undefined entries in the array', () => {
    const result = executeReportProgress({
      steps: [null, undefined, { id: 'step-1', label: '正常', status: 'planned' }],
    });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(1);
  });

  it('falls back invalid status to planned', () => {
    const result = executeReportProgress({
      steps: [
        { id: 'step-1', label: '未知状态', status: 'invalid_status' },
        { id: 'step-2', label: '正常状态', status: 'blocked' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result._validated![0].status).toBe('planned');
    expect(result._validated![1].status).toBe('blocked');
  });

  it('coerces non-string id and label to strings', () => {
    const result = executeReportProgress({
      steps: [
        { id: 123, label: 456, status: 'running' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result._validated![0].id).toBe('123');
    expect(result._validated![0].label).toBe('456');
  });

  it('handles empty steps array gracefully', () => {
    const result = executeReportProgress({ steps: [] });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(0);
    expect(result._validated).toEqual([]);
  });

  it('accepts all valid status values', () => {
    const statuses = ['planned', 'running', 'completed', 'blocked', 'failed'];
    const steps = statuses.map((status, i) => ({ id: `step-${i}`, label: `步骤${i}`, status }));
    const result = executeReportProgress({ steps });
    expect(result.ok).toBe(true);
    expect(result.displayed_steps).toBe(5);
    for (let i = 0; i < statuses.length; i++) {
      expect(result._validated![i].status).toBe(statuses[i]);
    }
  });
});
