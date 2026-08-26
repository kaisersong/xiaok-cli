import type { GoalCommitInput, GoalDocument, GoalStore } from './types.js';

export class InMemoryGoalStore implements GoalStore {
  readonly documents = new Map<string, GoalDocument>();
  failNextCommit = false;

  async load(sessionId: string): Promise<GoalDocument | null> {
    const document = this.documents.get(sessionId);
    return document ? structuredClone(document) : null;
  }

  async commit(input: GoalCommitInput): Promise<void> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error('injected goal commit failure');
    }
    const current = this.documents.get(input.sessionId);
    const revision = current?.state.revision ?? null;
    if (revision !== input.expectedRevision) {
      throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
    }
    this.documents.set(input.sessionId, {
      state: structuredClone(input.next),
      events: [...(current?.events ?? []), ...structuredClone(input.events)],
      turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
      evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
    });
  }
}
