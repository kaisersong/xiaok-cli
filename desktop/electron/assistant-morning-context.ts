interface EveningRunSummary {
  id: string;
  status: string;
  summary?: string;
}

interface PendingCandidateSummary {
  id: string;
  kind: string;
  title: string;
}

export function buildAssistantMorningContext(input: {
  snapshot: unknown;
  eveningRun?: EveningRunSummary;
  pendingCandidates: PendingCandidateSummary[];
  pinnedThreadIds: string[];
}) {
  const evening = input.eveningRun;
  return {
    current: input.snapshot,
    latestEvening: evening?.status === 'success' && typeof evening.summary === 'string' && evening.summary.trim()
      ? { runId: evening.id, summary: evening.summary.trim() }
      : null,
    pendingCandidates: input.pendingCandidates.slice(0, 100).map(candidate => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
    })),
    pinnedThreadIds: [...new Set(input.pinnedThreadIds)].sort().slice(0, 100),
  };
}
