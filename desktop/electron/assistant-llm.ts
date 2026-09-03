import type { LoopLLMPort } from './loop-llm-port.js';

export interface AssistantEvidenceRef {
  kind: string;
  id: string;
}

export interface AssistantCandidateProposal {
  kind: 'memory' | 'knowledge' | 'follow_up';
  title: string;
  content: string;
  scope: 'global' | 'project';
  projectId?: string;
  confidence: number;
  evidenceRefs: AssistantEvidenceRef[];
  dedupeKey: string;
}

export interface EveningReflectionOutput {
  summary: string;
  candidates: AssistantCandidateProposal[];
}

export interface MorningRecommendation {
  title: string;
  reasonCode: string;
  evidenceRefs: AssistantEvidenceRef[];
}

export interface MorningBriefingOutput {
  recommendations: MorningRecommendation[];
}

export async function completeAssistantJson<T>(input: {
  port: Pick<LoopLLMPort, 'complete'>;
  systemPrompt: string;
  snapshot: unknown;
  validate: (value: unknown) => T;
  maxTokens: number;
  queueTimeoutMs?: number;
  completionTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const response = await input.port.complete({
    model: 'fast',
    systemPrompt: input.systemPrompt,
    userMessage: JSON.stringify(input.snapshot),
    maxTokens: input.maxTokens,
    temperature: 0,
    queueTimeoutMs: input.queueTimeoutMs,
    completionTimeoutMs: input.completionTimeoutMs,
    signal: input.signal,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error('assistant_json_invalid');
  }
  return input.validate(parsed);
}

export function validateEveningReflection(value: unknown): EveningReflectionOutput {
  const record = asRecord(value, 'assistant_evening_invalid');
  const summary = requiredString(record.summary, 'summary');
  if (!Array.isArray(record.candidates)) throw new Error('assistant candidate list invalid');
  return {
    summary,
    candidates: record.candidates.map(validateCandidate),
  };
}

export function validateMorningBriefing(value: unknown): MorningBriefingOutput {
  const record = asRecord(value, 'assistant_morning_invalid');
  if (!Array.isArray(record.recommendations)) throw new Error('assistant recommendations invalid');
  if (record.recommendations.length > 3) throw new Error('assistant recommendations exceed three');
  return {
    recommendations: record.recommendations.map((item) => {
      const recommendation = asRecord(item, 'assistant recommendation invalid');
      return {
        title: requiredString(recommendation.title, 'title'),
        reasonCode: requiredString(recommendation.reasonCode, 'reasonCode'),
        evidenceRefs: validateEvidenceRefs(recommendation.evidenceRefs),
      };
    }),
  };
}

function validateCandidate(value: unknown): AssistantCandidateProposal {
  const record = asRecord(value, 'assistant candidate invalid');
  if (record.kind !== 'memory' && record.kind !== 'knowledge' && record.kind !== 'follow_up') {
    throw new Error('assistant candidate kind invalid');
  }
  if (record.scope !== 'global' && record.scope !== 'project') {
    throw new Error('assistant candidate scope invalid');
  }
  if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)
    || record.confidence < 0 || record.confidence > 1) {
    throw new Error('assistant candidate confidence invalid');
  }
  const projectId = optionalString(record.projectId);
  if (record.scope === 'project' && !projectId) throw new Error('assistant candidate project scope missing projectId');
  return {
    kind: record.kind,
    title: requiredString(record.title, 'title'),
    content: requiredString(record.content, 'content'),
    scope: record.scope,
    projectId,
    confidence: record.confidence,
    evidenceRefs: validateEvidenceRefs(record.evidenceRefs),
    dedupeKey: requiredString(record.dedupeKey, 'dedupeKey'),
  };
}

function validateEvidenceRefs(value: unknown): AssistantEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('assistant candidate evidence missing');
  return value.map((item) => {
    const evidence = asRecord(item, 'assistant evidence invalid');
    return {
      kind: requiredString(evidence.kind, 'evidence kind'),
      id: requiredString(evidence.id, 'evidence id'),
    };
  });
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`assistant ${field} invalid`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
