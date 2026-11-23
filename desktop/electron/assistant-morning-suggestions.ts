import {parseAssistantActionRecommendation} from '../../src/runtime/assistant/action-recommendation.js';
interface MorningSuggestionRun {
  id: string;
  status: string;
  finishedAt?: number;
  updatedAt?: number;
}

interface MorningSuggestionEvidence {
  metadata: Record<string, unknown>;
}

export interface MorningSuggestionView {
  id: string;
  title: string;
  summary: string;
  observedAt?: number;
}

export function listLatestMorningSuggestions(input: {
  listRuns(): MorningSuggestionRun[];
  listEvidence(runId: string): MorningSuggestionEvidence[];
}): MorningSuggestionView[] {
  const run = input.listRuns().filter(candidate => candidate.status === 'success').sort((a,b)=>(b.finishedAt??b.updatedAt??0)-(a.finishedAt??a.updatedAt??0))[0];
  if (!run) return [];
  for (const evidence of input.listEvidence(run.id)) {
    if (evidence.metadata.assistantKind !== 'morning') continue;
    const output = asRecord(evidence.metadata.output);
    if (!output || !Array.isArray(output.recommendations)) continue;
    return output.recommendations.slice(0, 3).flatMap((value, index) => {
      const recommendation = asRecord(value);
      if (!recommendation) return [];
      const title = readString(recommendation.title);
      const reasonCode = readString(recommendation.reasonCode);
      if (!title || !reasonCode || !hasEvidenceRefs(recommendation.evidenceRefs)) return [];
      if(output.schemaVersion===2){try{const action=parseAssistantActionRecommendation(recommendation);return [{id:`${run.id}:${index}`,title:action.title,summary:action.action.reason,...(run.finishedAt!==undefined?{observedAt:run.finishedAt}:{})}];}catch{return [];}}
      return [{ id: `${run.id}:${index}`, title, summary: reasonCode, ...(run.finishedAt!==undefined?{observedAt:run.finishedAt}:{}) }];
    });
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hasEvidenceRefs(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(reference => {
    const record = asRecord(reference);
    return record !== undefined && readString(record.kind) !== undefined && readString(record.id) !== undefined;
  });
}
