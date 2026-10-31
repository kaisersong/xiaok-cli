export interface SourceFact { id: string; text: string; chapter?: string; kind?: string }

/** Reject a transport-successful but incomplete or internally inconsistent audit. */
export function validateSourceAudit(verdict: any, rubric: any): void {
  const idsMatch = (actual: any[], expected: any[]) => Array.isArray(actual) && actual.length === expected.length
    && new Set(actual.map(x => x.id)).size === expected.length && expected.every(x => actual.some(y => y.id === x.id));
  if (!idsMatch(verdict?.chapters, rubric.requirements) || !idsMatch(verdict?.tables, rubric.tables)
    || !['pass', 'fail'].includes(verdict.verdict) || !Array.isArray(verdict.hallucinations) || !Array.isArray(verdict.narrative_issues)) throw new Error('incomplete audit');
  const items = [...verdict.chapters, ...verdict.tables];
  if (items.some(x => !['complete', 'partial', 'missing'].includes(x.status) || !Array.isArray(x.missing))) throw new Error('invalid audit status');
  if (verdict.verdict === 'pass' && (items.some(x => x.status !== 'complete' || x.missing.length) || verdict.hallucinations.length || verdict.narrative_issues.length)) throw new Error('contradictory audit pass');
}

/** Contiguous, complete source groups; no model decides which facts survive. */
export function groupSourceFacts(facts: SourceFact[], count: number): SourceFact[][] {
  if (!Number.isInteger(count) || count < 1 || count > facts.length) throw new Error('invalid group count');
  if (count > 1 && facts[0].chapter === 's01') {
    const end = facts.findIndex(f => f.chapter !== 's01');
    if (end > 0 && facts.length - end >= count - 1) return [facts.slice(0,end), ...groupSourceFacts(facts.slice(end),count-1)];
  }
  const cumulative = [0];
  // Approximate readable two-column line count plus card padding/margin.
  // Actual browser geometry remains the authoritative gate.
  for (const fact of facts) cumulative.push(cumulative.at(-1)! + Math.ceil(fact.text.length / 32) + 1.2);
  const groups: SourceFact[][] = [];
  let start = 0;
  for (let group = 1; group < count; group++) {
    const target = cumulative.at(-1)! * group / count;
    let end = start + 1;
    const last = facts.length - (count - group);
    while (end < last && Math.abs(cumulative[end + 1] - target) < Math.abs(cumulative[end] - target)) end++;
    groups.push(facts.slice(start, end)); start = end;
  }
  groups.push(facts.slice(start));
  return groups;
}

/** Experimental immutable source binding. The planner never supplies body facts. */
export function bindSourceOwnedPlan(template: any, facts: SourceFact[], plan: any): any {
  if (!Array.isArray(plan?.slides) || plan.slides.length < 5 || plan.slides.length > 20 || plan.slides.at(-1)?.role !== 'closing') throw new Error('invalid page contract');
  const byId = new Map(facts.map(f => [f.id, f.text]));
  if (!facts.length || byId.size !== facts.length) throw new Error('invalid source facts');
  const covered = new Set<string>();
  const slides = plan.slides.map((s: any, i: number) => {
    if (typeof s.title !== 'string' || typeof s.key_point !== 'string' || typeof s.role !== 'string' || !Array.isArray(s.fact_ids) || !s.fact_ids.length) throw new Error('invalid planned slide');
    const source = s.fact_ids.map((id: string) => {
      if (!byId.has(id)) throw new Error('unknown fact id');
      covered.add(id); return byId.get(id)!;
    });
    return { slide_number: i+1, role: s.role, title: s.title, claim: s.title, key_point: s.key_point,
      explanation: s.key_point, visual: s.preferred_layout_family ?? 'evidence',
      visual_intent: s.preferred_layout_family ?? 'evidence', preferred_layout_family: s.preferred_layout_family ?? 'evidence',
      chart_policy: 'auto', supporting_facts: source };
  });
  if (covered.size !== byId.size) throw new Error('missing source fact ids');
  const data = structuredClone(template);
  data.title = plan.title;
  data.mode = 'auto'; data.language = 'zh-CN';
  data.brief_id = 'source-owned-experiment';
  data.audience = '产品、研发、商业与交付负责人'; data.desired_action = '根据完整来源证据推进受控执行';
  data.deck = { ...data.deck, deck_type: 'user-content', page_count: slides.length };
  data.style = { ...data.style, preset: 'Aurora Mesh', visual_density: 'high' };
  data.content = { source_policy: 'distill-only', must_include: facts.slice(0,5).map(f=>f.text), global_facts: facts.slice(0,5).map(f=>f.text), must_avoid: ['无关演示文案', '改写原始数字与责任条件'] };
  data.narrative = { thesis: plan.title, page_roles: slides.map((s:any)=>s.role), slides };
  data.timing = { estimate: template.timing?.estimate ?? {}, actual: { plan: '由宿主计时', generate: '由宿主计时', validate: '由宿主计时', polish: '由宿主计时', total: '由宿主计时' } };
  return data;
}
