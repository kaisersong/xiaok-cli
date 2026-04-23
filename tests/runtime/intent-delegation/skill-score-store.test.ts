import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSkillScoreStore } from '../../../src/runtime/intent-delegation/skill-score-store.js';
import type { SkillFeedbackRecord, SkillRoutingObservation } from '../../../src/runtime/intent-delegation/skill-eval.js';

describe('skill score store', () => {
  let rootDir: string;
  let filePath: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-skill-score-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    filePath = join(rootDir, 'skill-scores.json');
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('accumulates runtime and feedback signals into a small contextual rerank boost', () => {
    const store = new FileSkillScoreStore(filePath);
    const observation: SkillRoutingObservation = {
      observationId: 'obs_1',
      sessionId: 'sess_1',
      intentId: 'intent_1',
      stageId: 'stage_1',
      stepId: 'step_1',
      intentType: 'generate',
      stageRole: 'compose',
      deliverable: '报告',
      deliverableFamily: 'document',
      selectedSkillName: 'report-skill',
      actualSkillName: 'report-skill',
      status: 'completed',
      artifactRecorded: true,
      structuralValidation: 'passed',
      semanticValidation: 'passed',
      createdAt: 1,
      updatedAt: 1,
    };
    const feedback: SkillFeedbackRecord = {
      feedbackId: 'feedback_1',
      sessionId: 'sess_1',
      intentId: 'intent_1',
      kind: 'routing',
      sentiment: 'positive',
      observationIds: ['obs_1'],
      createdAt: 2,
    };

    store.recordRuntimeObservation(observation);
    store.recordFeedback(feedback, [observation]);

    const boost = store.getBoost({
      skillName: 'report-skill',
      intentType: 'generate',
      stageRole: 'compose',
      deliverableFamily: 'document',
    });
    expect(boost).toBeGreaterThan(0);

    const unrelatedBoost = store.getBoost({
      skillName: 'report-skill',
      intentType: 'generate',
      stageRole: 'compose',
      deliverableFamily: 'markdown',
    });
    expect(unrelatedBoost).toBe(0);
  });
});
