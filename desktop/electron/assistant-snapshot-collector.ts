export type AssistantActivityScope = 'threads' | 'projects' | 'tasks' | 'artifacts' | 'automations' | 'meetings';

export interface AssistantEvidenceReference {
  kind: string;
  id: string;
}

export interface AssistantActivityRecord {
  id: string;
  scope: AssistantActivityScope;
  updatedAt: number;
  summary: string;
  reference: AssistantEvidenceReference;
  priority: number;
}

export interface BoundedAssistantSnapshot {
  from: number;
  to: number;
  timeZone: string;
  items: AssistantActivityRecord[];
  dropped: {
    duplicate: number;
    perScopeLimit: number;
    totalBytes: number;
    outsideWindow: number;
  };
}

export interface AssistantSnapshotLimits {
  maxItemsPerScope: number;
  maxSerializedBytes: number;
  maxSummaryChars: number;
}

const DEFAULT_LIMITS: AssistantSnapshotLimits = {
  maxItemsPerScope: 100,
  maxSerializedBytes: 256 * 1024,
  maxSummaryChars: 2_000,
};

export function buildBoundedAssistantSnapshot(input: {
  from: number;
  to: number;
  timeZone: string;
  records: AssistantActivityRecord[];
  limits?: Partial<AssistantSnapshotLimits>;
}): BoundedAssistantSnapshot {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const dropped = { duplicate: 0, perScopeLimit: 0, totalBytes: 0, outsideWindow: 0 };
  const latestByIdentity = new Map<string, AssistantActivityRecord>();

  for (const source of input.records) {
    if (source.updatedAt < input.from || source.updatedAt > input.to) {
      dropped.outsideWindow += 1;
      continue;
    }
    const normalized = {
      ...source,
      summary: source.summary.slice(0, limits.maxSummaryChars),
      reference: { ...source.reference },
    };
    const identity = `${source.scope}:${source.id}`;
    const current = latestByIdentity.get(identity);
    if (current) dropped.duplicate += 1;
    if (!current || compareActivity(normalized, current) < 0) {
      latestByIdentity.set(identity, normalized);
    }
  }

  const scopeCounts = new Map<AssistantActivityScope, number>();
  const candidates: AssistantActivityRecord[] = [];
  for (const item of [...latestByIdentity.values()].sort(compareActivity)) {
    const count = scopeCounts.get(item.scope) ?? 0;
    if (count >= limits.maxItemsPerScope) {
      dropped.perScopeLimit += 1;
      continue;
    }
    scopeCounts.set(item.scope, count + 1);
    candidates.push(item);
  }

  const snapshot: BoundedAssistantSnapshot = {
    from: input.from,
    to: input.to,
    timeZone: input.timeZone,
    items: [],
    dropped,
  };
  for (const item of candidates) {
    snapshot.items.push(item);
    if (serializedBytes(snapshot) > limits.maxSerializedBytes) {
      snapshot.items.pop();
      snapshot.dropped.totalBytes += 1;
    }
  }

  while (serializedBytes(snapshot) > limits.maxSerializedBytes && snapshot.items.length > 0) {
    snapshot.items.pop();
    snapshot.dropped.totalBytes += 1;
  }
  return snapshot;
}

function compareActivity(left: AssistantActivityRecord, right: AssistantActivityRecord): number {
  return right.priority - left.priority
    || right.updatedAt - left.updatedAt
    || left.scope.localeCompare(right.scope)
    || left.id.localeCompare(right.id);
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
