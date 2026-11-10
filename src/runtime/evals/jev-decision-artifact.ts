export interface DecisionArtifact {
  mode: 'analysis' | 'report'; items: Array<{ id: string; source: string; risk: string }>;
}
/** Pilot output gate shared by the actual generation exit and regression tests. */
export function validateDecisionArtifact(value: any, facts: Array<{ id: string; text: string }>, mode: string): DecisionArtifact {
  const exactKeys = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  if (!exactKeys(value, ['mode', 'items']) || !['analysis', 'report'].includes(value.mode) || value.mode !== mode
    || !Array.isArray(value.items) || value.items.length !== facts.length
    || !facts.every((f, i) => exactKeys(value.items[i], ['id', 'source', 'risk']) && value.items[i].id === f.id
      && value.items[i].source === f.text && typeof value.items[i].risk === 'string'
      && value.items[i].risk.trim().length > 0 && value.items[i].risk.length <= 1024)) throw new Error('invalid-decision-artifact');
  return { mode: value.mode, items: value.items.map((x: DecisionArtifact['items'][number]) => ({ id: x.id, source: x.source, risk: x.risk })) };
}
export function renderDecisionArtifact(value: DecisionArtifact): string {
  return `# ${value.mode === 'report' ? '风险报告' : '风险分析'}\n\n` + value.items.map((item, index) =>
    `## ${index + 1}\n\n来源：${item.source}\n\n分析：${item.risk}\n`).join('\n');
}
