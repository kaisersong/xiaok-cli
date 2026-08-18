interface MorningSuggestionRun {
  id: string;
  status: string;
}

interface MorningSuggestionEvidence {
  metadata: Record<string, unknown>;
}

export interface MorningSuggestionView {
  id: string;
  title: string;
  summary: string;
}

export function listLatestMorningSuggestions(input: {
  listRuns(): MorningSuggestionRun[];
  listEvidence(runId: string): MorningSuggestionEvidence[];
}): MorningSuggestionView[] {
  const run = input.listRuns().find(candidate => candidate.status === 'success');
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
      return [{ id: `${run.id}:${index}`, title, summary: reasonCode }];
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
