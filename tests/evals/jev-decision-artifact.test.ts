import { describe, expect, it } from 'vitest';
import { validateDecisionArtifact, renderDecisionArtifact } from '../../src/runtime/evals/jev-decision-artifact.js';
const facts = [{ id: 'f1', text: '验收包含24项检查，6项待完成。' }, { id: 'f2', text: '培训日期未确定。' }];
const artifact = () => ({ mode: 'analysis', items: facts.map(f => ({ id: f.id, source: f.text, risk: '相关事项尚待确认。' })) });
describe('actual decision pilot artifact exit', () => {
  it('preserves every source in a real Markdown artifact', () => {
    const a = validateDecisionArtifact(artifact(), facts, 'analysis');
    const md = renderDecisionArtifact(a);
    expect(md).toContain('# 风险分析'); for (const f of facts) expect(md).toContain(f.text);
  });
  it('renders report mode independently of the analysis label', () => {
    expect(renderDecisionArtifact(validateDecisionArtifact({ ...artifact(), mode: 'report' }, facts, 'report'))).toContain('# 风险报告');
  });
  it('rejects missing and reordered evidence', () => {
    expect(() => validateDecisionArtifact({ ...artifact(), items: artifact().items.slice(1) }, facts, 'analysis')).toThrow();
    expect(() => validateDecisionArtifact({ ...artifact(), items: artifact().items.reverse() }, facts, 'analysis')).toThrow();
  });
  it('rejects edited source and wrong routing mode', () => {
    const a = artifact(); a.items[0].source = '已全部完成。';
    expect(() => validateDecisionArtifact(a, facts, 'analysis')).toThrow();
    expect(() => validateDecisionArtifact(artifact(), facts, 'report')).toThrow();
  });
  it('rejects unknown fields and empty generated explanation', () => {
    expect(() => validateDecisionArtifact({ ...artifact(), passed: true }, facts, 'analysis')).toThrow();
    const a = artifact(); Object.assign(a.items[0], { hidden: 'omitted source' });
    expect(() => validateDecisionArtifact(a, facts, 'analysis')).toThrow();
    const b = artifact(); b.items[0].risk = ' ';
    expect(() => validateDecisionArtifact(b, facts, 'analysis')).toThrow();
  });
});
