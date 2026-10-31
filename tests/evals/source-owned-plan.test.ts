import { describe, it, expect } from 'vitest';
import { bindSourceOwnedPlan, groupSourceFacts, validateSourceAudit } from '../../src/runtime/evals/source-owned-plan.js';

describe('source-owned plan binding', () => {
  const facts = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, text: `来源事实${i}：责任人、数字和否定条件不能丢失` }));
  const plan = { title: '来源限定的完整叙事', slides: Array.from({ length: 5 }, (_, i) => ({
    title: `第${i}项结论`, key_point: '保留原始条件', role: i === 4 ? 'closing' : 'evidence',
    preferred_layout_family: 'evidence', fact_ids: [`f${i*2}`, `f${i*2+1}`],
  })) };
  const template = { content: { must_include: ['demo'], global_facts: ['demo'] }, deck: {}, narrative: {}, style: {}, timing: {} };
  it('绑定全部原文而非模型提供的替代事实，metadata 从实际计划生成', () => {
    const before = JSON.stringify(template);
    const result = bindSourceOwnedPlan(template, facts, plan);
    expect(result.narrative.slides.flatMap((s: any) => s.supporting_facts)).toEqual(facts.map(f => f.text));
    expect(result.deck.page_count).toBe(5);
    expect(result.narrative.page_roles).toHaveLength(5);
    expect(JSON.stringify(result.content)).not.toContain('demo');
    expect(JSON.stringify(template)).toBe(before);
  });
  it('未知和遗漏事实 ID 不静默回退或通过', () => {
    const unknown = structuredClone(plan); unknown.slides[0].fact_ids[0] = 'fake';
    expect(() => bindSourceOwnedPlan(template, facts, unknown)).toThrow();
    const missing = structuredClone(plan); missing.slides[0].fact_ids.pop();
    expect(() => bindSourceOwnedPlan(template, facts, missing)).toThrow();
  });
  it('空页、超出原页数与非 closing 末页拒绝', () => {
    const empty = structuredClone(plan); empty.slides[0].fact_ids = [];
    expect(() => bindSourceOwnedPlan(template, facts, empty)).toThrow();
    expect(() => bindSourceOwnedPlan(template, facts, { ...plan, slides: Array(21).fill(plan.slides[0]) })).toThrow();
    const end = structuredClone(plan); end.slides[4].role = 'evidence';
    expect(() => bindSourceOwnedPlan(template, facts, end)).toThrow();
  });
  it('宿主连续分组不丢、不过度复制事实，保留原顺序', () => {
    const groups = groupSourceFacts(facts, 5);
    expect(groups).toHaveLength(5);
    expect(groups.flat().map(f=>f.id)).toEqual(facts.map(f=>f.id));
    expect(groups.every(g=>g.length>0)).toBe(true);
  });
  it('保留完整源封面，不向封面塞入后续长表格；短块计入卡片开销', () => {
    const source = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, chapter: i < 16 ? 's01' : 's02', text: i < 16 ? '封面短块' : '长规则'.repeat(50) }));
    const groups = groupSourceFacts(source, 5);
    expect(groups[0]).toEqual(source.slice(0,16));
    expect(groups.flat()).toEqual(source);
  });
  it('审核不能用 pass 标签掩盖缺项、部分覆盖或幻觉', () => {
    const rubric = { requirements: [{ id: 's02' }], tables: [{ id: 't01' }] };
    const valid = { verdict: 'pass', chapters: [{ id: 's02', status: 'complete', missing: [] }], tables: [{ id: 't01', status: 'complete', missing: [] }], hallucinations: [], narrative_issues: [] };
    expect(() => validateSourceAudit(valid, rubric)).not.toThrow();
    expect(() => validateSourceAudit({ ...valid, tables: [] }, rubric)).toThrow();
    expect(() => validateSourceAudit({ ...valid, hallucinations: [{}] }, rubric)).toThrow();
    expect(() => validateSourceAudit({ ...valid, chapters: [{ id: 's02', status: 'partial', missing: ['遗漏条件'] }] }, rubric)).toThrow();
    expect(() => validateSourceAudit({ ...valid, verdict: 'fail', chapters: [{ id: 's02', status: 'partial', missing: ['遗漏条件'] }] }, rubric)).not.toThrow();
  });
});
