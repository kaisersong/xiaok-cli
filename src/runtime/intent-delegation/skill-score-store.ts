import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../../utils/config.js';
import type { IntentType, StepRole } from '../../ai/intent-delegation/types.js';
import {
  buildSkillScoreKey,
  cloneContextualSkillScoreRecord,
  computeContextualSkillBoost,
  type ContextualSkillScoreRecord,
  type SkillFeedbackRecord,
  type SkillRoutingObservation,
} from './skill-eval.js';

const SCORE_SCHEMA_VERSION = 1;

interface PersistedSkillScoreDocument {
  schemaVersion: typeof SCORE_SCHEMA_VERSION;
  entries: ContextualSkillScoreRecord[];
}

export class FileSkillScoreStore {
  constructor(private readonly filePath = join(getConfigDir(), 'intent-delegation', 'skill-scores.json')) {}

  loadAll(): ContextualSkillScoreRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PersistedSkillScoreDocument>;
    if (parsed.schemaVersion !== SCORE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }

    return parsed.entries.map(cloneContextualSkillScoreRecord);
  }

  getBoost(input: {
    skillName: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverableFamily: string;
  }): number {
    const entry = this.loadAll().find((candidate) => buildSkillScoreKey(candidate) === buildSkillScoreKey(input));
    return computeContextualSkillBoost(entry);
  }

  recordRuntimeObservation(observation: SkillRoutingObservation): void {
    if (!observation.actualSkillName) {
      return;
    }
    if (observation.status !== 'completed' && observation.status !== 'failed') {
      return;
    }
    const actualSkillName = observation.actualSkillName;

    this.mutate((entries) => {
      const entry = getOrCreateEntry(entries, {
        skillName: actualSkillName,
        intentType: observation.intentType,
        stageRole: observation.stageRole,
        deliverableFamily: observation.deliverableFamily,
      });
      const target = observation.status === 'completed'
        ? entry.runtimeSuccessObservationIds
        : entry.runtimeFailureObservationIds;
      if (!target.includes(observation.observationId)) {
        target.push(observation.observationId);
        entry.updatedAt = Date.now();
      }
    });
  }

  recordFeedback(feedback: SkillFeedbackRecord, observations: SkillRoutingObservation[]): void {
    const relevant = observations.filter((observation) => Boolean(observation.actualSkillName));
    if (relevant.length === 0) {
      return;
    }

    this.mutate((entries) => {
      for (const observation of relevant) {
        const entry = getOrCreateEntry(entries, {
          skillName: observation.actualSkillName!,
          intentType: observation.intentType,
          stageRole: observation.stageRole,
          deliverableFamily: observation.deliverableFamily,
        });
        const target = selectFeedbackTarget(entry, feedback);
        if (!target.includes(feedback.feedbackId)) {
          target.push(feedback.feedbackId);
          entry.updatedAt = feedback.createdAt;
        }
      }
    });
  }

  private mutate(apply: (entries: ContextualSkillScoreRecord[]) => void): void {
    const entries = this.loadAll();
    apply(entries);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const document: PersistedSkillScoreDocument = {
      schemaVersion: SCORE_SCHEMA_VERSION,
      entries: entries.map(cloneContextualSkillScoreRecord),
    };
    writeFileSync(this.filePath, JSON.stringify(document, null, 2), 'utf8');
  }
}

function getOrCreateEntry(
  entries: ContextualSkillScoreRecord[],
  input: {
    skillName: string;
    intentType: IntentType;
    stageRole: StepRole;
    deliverableFamily: string;
  },
): ContextualSkillScoreRecord {
  const existing = entries.find((candidate) => buildSkillScoreKey(candidate) === buildSkillScoreKey(input));
  if (existing) {
    return existing;
  }

  const created: ContextualSkillScoreRecord = {
    ...input,
    runtimeSuccessObservationIds: [],
    runtimeFailureObservationIds: [],
    routingPositiveFeedbackIds: [],
    routingNegativeFeedbackIds: [],
    outcomePositiveFeedbackIds: [],
    outcomeNegativeFeedbackIds: [],
    updatedAt: Date.now(),
  };
  entries.push(created);
  return created;
}

function selectFeedbackTarget(
  entry: ContextualSkillScoreRecord,
  feedback: SkillFeedbackRecord,
): string[] {
  if (feedback.kind === 'routing') {
    return feedback.sentiment === 'positive'
      ? entry.routingPositiveFeedbackIds
      : entry.routingNegativeFeedbackIds;
  }

  return feedback.sentiment === 'positive'
    ? entry.outcomePositiveFeedbackIds
    : entry.outcomeNegativeFeedbackIds;
}
