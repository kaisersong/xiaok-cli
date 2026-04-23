import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSessionStore } from '../../../src/ai/runtime/session-store.js';
import { createIntentDelegationTools } from '../../../src/ai/tools/intent-delegation.js';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { wireIntentDelegationToRuntimeSync } from '../../../src/runtime/intent-delegation/runtime-sync.js';
import { wireSkillEvalToRuntimeSync } from '../../../src/runtime/intent-delegation/skill-eval-sync.js';
import { SessionIntentDelegationStore } from '../../../src/runtime/intent-delegation/store.js';
import { SessionSkillEvalStore } from '../../../src/runtime/intent-delegation/skill-eval-store.js';
import { FileSkillScoreStore } from '../../../src/runtime/intent-delegation/skill-score-store.js';

describe('skill eval runtime sync', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-skill-eval-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('tracks actual skill invocation and completed runtime outcome for a non-generic stage step', async () => {
    const sessionStore = new FileSessionStore(rootDir);
    await sessionStore.save(createSessionSnapshot('sess_eval_sync'));
    const ledgerStore = new SessionIntentDelegationStore(sessionStore);
    const skillEvalStore = new SessionSkillEvalStore(sessionStore);
    const scoreStore = new FileSkillScoreStore(join(rootDir, 'skill-scores.json'));
    const tools = new Map(
      createIntentDelegationTools({ ledgerStore, sessionId: 'sess_eval_sync' }).map((tool) => [tool.definition.name, tool]),
    );
    const hooks = createRuntimeHooks();

    wireIntentDelegationToRuntimeSync({
      hooks,
      ledgerStore,
      sessionId: 'sess_eval_sync',
    });
    wireSkillEvalToRuntimeSync({
      hooks,
      ledgerStore,
      skillEvalStore,
      scoreStore,
      sessionId: 'sess_eval_sync',
    });

    const createdInput = {
      instance_id: 'inst_1',
      session_id: 'sess_eval_sync',
      raw_intent: 'Write a report',
      normalized_intent: 'write a report',
      intent_type: 'generate',
      deliverable: '报告',
      risk_tier: 'medium',
      template_id: 'generate_v1',
    };
    hooks.emit({ type: 'tool_started', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_create', toolInput: createdInput });
    const created = JSON.parse(await tools.get('intent_create')!.execute(createdInput)) as { intentId: string; activeStepId: string };
    hooks.emit({ type: 'tool_finished', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_create', ok: true });
    await flush();

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_eval_sync',
      turnId: 'turn_1',
      toolName: 'skill',
      toolInput: { name: 'report-skill' },
    });
    await flush();

    const runningInput = {
      instance_id: 'inst_1',
      session_id: 'sess_eval_sync',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'running',
      breadcrumb: 'Collecting source materials',
    };
    hooks.emit({ type: 'tool_started', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_step_update', toolInput: runningInput });
    await tools.get('intent_step_update')!.execute(runningInput);
    hooks.emit({ type: 'tool_finished', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_step_update', ok: true });
    await flush();

    const completedInput = {
      instance_id: 'inst_1',
      session_id: 'sess_eval_sync',
      intent_id: created.intentId,
      active_step_id: created.activeStepId,
      step_status: 'completed',
      breadcrumb: 'Collected source materials',
    };
    hooks.emit({ type: 'tool_started', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_step_update', toolInput: completedInput });
    await tools.get('intent_step_update')!.execute(completedInput);
    hooks.emit({ type: 'tool_finished', sessionId: 'sess_eval_sync', turnId: 'turn_1', toolName: 'intent_step_update', ok: true });
    await flush();

    const state = await skillEvalStore.load('sess_eval_sync');
    expect(state?.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intentId: created.intentId,
        actualSkillName: 'report-skill',
        status: 'completed',
      }),
    ]));

    const boost = scoreStore.getBoost({
      skillName: 'report-skill',
      intentType: 'generate',
      stageRole: 'collect',
      deliverableFamily: 'document',
    });
    expect(boost).toBeGreaterThanOrEqual(0);
  });
});

function createSessionSnapshot(sessionId: string) {
  return {
    sessionId,
    cwd: '/tmp/xiaok',
    createdAt: 100,
    updatedAt: 100,
    lineage: [sessionId],
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    compactions: [],
    memoryRefs: [],
    approvalRefs: [],
    backgroundJobRefs: [],
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
