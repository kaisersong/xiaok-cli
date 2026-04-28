import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, UsageStats } from '../../../src/types.js';
import { FileSessionStore, SQLiteSessionStore } from '../../../src/ai/runtime/session-store.js';
import { createFileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import type { SessionStore } from '../../../src/ai/runtime/session-store/store.js';
import { createEmptySessionIntentLedger } from '../../../src/runtime/intent-delegation/store.js';
import { createEmptySessionSkillEvalState } from '../../../src/runtime/intent-delegation/skill-eval.js';
import { createEmptySessionSkillExecutionState } from '../../../src/ai/skills/execution-state.js';

describe('FileSessionStore', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-session-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('saves and loads a session snapshot', async () => {
    const store = new FileSessionStore(rootDir);
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ];
    const usage: UsageStats = { inputTokens: 10, outputTokens: 5 };

    await store.save({
      sessionId: 'sess_alpha',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_alpha'],
      messages,
      usage,
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      skillExecution: createEmptySessionSkillExecutionState(200),
    });

    await expect(store.load('sess_alpha')).resolves.toEqual({
      sessionId: 'sess_alpha',
      cwd: 'D:/projects/workspace/xiaok-cli',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_alpha'],
      messages,
      usage,
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      skillExecution: createEmptySessionSkillExecutionState(200),
    });
  });

  it('lists saved sessions ordered by most recent update', async () => {
    const store = new FileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_old',
      cwd: 'D:/projects/old',
      createdAt: 100,
      updatedAt: 110,
      lineage: ['sess_old'],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });
    await store.save({
      sessionId: 'sess_new',
      cwd: 'D:/projects/new',
      createdAt: 120,
      updatedAt: 220,
      lineage: ['sess_new'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'latest' }] }],
      usage: { inputTokens: 3, outputTokens: 1 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    await expect(store.list()).resolves.toEqual([
      {
        sessionId: 'sess_new',
        cwd: 'D:/projects/new',
        updatedAt: 220,
        preview: 'latest',
      },
      {
        sessionId: 'sess_old',
        cwd: 'D:/projects/old',
        updatedAt: 110,
        preview: '',
      },
    ]);
  });

  it('forks an existing session into a new snapshot', async () => {
    const store = new FileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_source',
      cwd: 'D:/projects/source',
      model: 'claude-opus-4-6',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_source'],
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'original' }] }],
      usage: { inputTokens: 7, outputTokens: 9 },
      compactions: [{ id: 'cmp_1', createdAt: 150, summary: 'summary', replacedMessages: 2 }],
      promptSnapshotId: 'prompt_1',
      memoryRefs: ['mem_1'],
      approvalRefs: ['apr_1'],
      backgroundJobRefs: ['bg_1'],
      skillExecution: {
        invocations: [{
          invocationId: 'skill_inv_1',
          sessionId: 'sess_source',
          agentId: 'main',
          skillName: 'release-checklist',
          requested: ['release-checklist'],
          strategy: 'inline',
          strictMode: true,
          bundleHash: 'hash',
          status: 'completed',
          plan: {
            type: 'skill_plan',
            requested: ['release-checklist'],
            strategy: 'inline',
            primarySkill: 'release-checklist',
            strict: true,
            resolved: [],
          },
          evidence: [{
            type: 'step_completed',
            invocationId: 'skill_inv_1',
            agentId: 'main',
            stepId: 'read_skill',
            createdAt: 160,
          }],
          createdAt: 150,
          updatedAt: 160,
          compliance: {
            passed: true,
            missingReferences: [],
            missingScripts: [],
            missingSteps: [],
            failedChecks: [],
            checkedAt: 160,
          },
        }],
        updatedAt: 160,
      },
    });

    const forked = await store.fork('sess_source');

    expect(forked.sessionId).not.toBe('sess_source');
    expect(forked.forkedFromSessionId).toBe('sess_source');
    expect(forked.lineage).toEqual(['sess_source']);
    expect(forked.messages).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'original' }] },
    ]);
    expect(forked.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
    expect(forked.compactions).toEqual([{ id: 'cmp_1', createdAt: 150, summary: 'summary', replacedMessages: 2 }]);
    expect(forked.promptSnapshotId).toBe('prompt_1');
    expect(forked.memoryRefs).toEqual(['mem_1']);
    expect(forked.approvalRefs).toEqual(['apr_1']);
    expect(forked.backgroundJobRefs).toEqual(['bg_1']);
    expect(forked.skillExecution?.invocations[0]?.skillName).toBe('release-checklist');
  });

  it('rekeys nested intent delegation session identities when forking', async () => {
    const store = new FileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_nested',
      cwd: '/nested',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_nested'],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation: {
        instanceId: 'inst_nested',
        sessionId: 'sess_nested',
        activeIntentId: 'intent_nested',
        latestPlan: {
          intentId: 'intent_nested',
          instanceId: 'inst_nested',
          sessionId: 'sess_nested',
          rawIntent: 'Write summary',
          normalizedIntent: 'write summary',
          intentType: 'generate',
          deliverable: 'summary',
          explicitConstraints: [],
          delegationBoundary: [],
          riskTier: 'medium',
          templateId: 'tpl_generate',
          steps: [
            {
              stepId: 'intent_nested:step:collect',
              key: 'collect',
              order: 0,
              role: 'collect',
              skillName: null,
              dependsOn: [],
              status: 'planned',
              riskTier: 'medium',
            },
          ],
          activeStepId: 'intent_nested:step:collect',
          overallStatus: 'drafting_plan',
          attemptCount: 1,
          createdAt: 100,
          updatedAt: 200,
        },
        intents: [{
          intentId: 'intent_nested',
          instanceId: 'inst_nested',
          sessionId: 'sess_nested',
          rawIntent: 'Write summary',
          normalizedIntent: 'write summary',
          intentType: 'generate',
          deliverable: 'summary',
          explicitConstraints: [],
          delegationBoundary: [],
          riskTier: 'medium',
          templateId: 'tpl_generate',
          steps: [
            {
              stepId: 'intent_nested:step:collect',
              key: 'collect',
              order: 0,
              role: 'collect',
              skillName: null,
              dependsOn: [],
              status: 'planned',
              riskTier: 'medium',
            },
          ],
          activeStepId: 'intent_nested:step:collect',
          overallStatus: 'drafting_plan',
          attemptCount: 1,
          createdAt: 100,
          updatedAt: 200,
        }],
        breadcrumbs: [],
        receipt: null,
        salvage: null,
        ownership: {
          state: 'released',
          previousOwnerInstanceId: 'inst_nested',
          updatedAt: 200,
        },
        updatedAt: 200,
      },
    });

    const forked = await store.fork('sess_nested');

    expect(forked.sessionId).not.toBe('sess_nested');
    expect(forked.intentDelegation?.sessionId).toBe(forked.sessionId);
    expect(forked.intentDelegation?.latestPlan?.sessionId).toBe(forked.sessionId);
    expect(forked.intentDelegation?.intents.map((intent) => intent.sessionId)).toEqual([forked.sessionId]);
  });

  it('keeps save/load/loadLast/list/fork working through the shared SessionStore contract', async () => {
    const store: SessionStore = createFileSessionStore(rootDir);

    await store.save({
      sessionId: 'sess_contract',
      cwd: '/contract',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_contract'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'contract preview' }] }],
      usage: { inputTokens: 1, outputTokens: 2 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
    });

    const loaded = await store.load('sess_contract');
    const last = await store.loadLast();
    const listed = await store.list();
    const forked = await store.fork('sess_contract');

    expect(loaded?.sessionId).toBe('sess_contract');
    expect(last?.sessionId).toBe('sess_contract');
    expect(listed[0]).toMatchObject({
      sessionId: 'sess_contract',
      preview: 'contract preview',
    });
    expect(forked.forkedFromSessionId).toBe('sess_contract');
  });

  it('persists intent delegation and skill eval state through SQLiteSessionStore', async () => {
    let store: SQLiteSessionStore;
    try {
      store = new SQLiteSessionStore(join(rootDir, 'sessions.db'));
    } catch (error) {
      if (isSqliteAbiMismatch(error)) {
        return;
      }
      throw error;
    }
    const intentDelegation = createEmptySessionIntentLedger('sess_sqlite', 200);
    intentDelegation.instanceId = 'inst_sqlite';
    intentDelegation.ownership = {
      state: 'owned',
      ownerInstanceId: 'inst_sqlite',
      updatedAt: 200,
    };

    const skillEval = createEmptySessionSkillEvalState(200);
    skillEval.observations.push({
      observationId: 'obs_sqlite',
      sessionId: 'sess_sqlite',
      intentId: 'intent_sqlite',
      stageId: 'intent_sqlite:stage:1',
      stepId: 'intent_sqlite:stage:1:step:compose',
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
      createdAt: 200,
      updatedAt: 200,
    });

    await store.save({
      sessionId: 'sess_sqlite',
      cwd: '/sqlite',
      createdAt: 100,
      updatedAt: 200,
      lineage: ['sess_sqlite'],
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      compactions: [],
      memoryRefs: [],
      approvalRefs: [],
      backgroundJobRefs: [],
      intentDelegation,
      skillEval,
    });

    const loaded = await store.load('sess_sqlite');
    expect(loaded?.intentDelegation).toMatchObject({
      sessionId: 'sess_sqlite',
      instanceId: 'inst_sqlite',
      ownership: {
        state: 'owned',
        ownerInstanceId: 'inst_sqlite',
      },
    });
    expect(loaded?.skillEval?.observations).toEqual([
      expect.objectContaining({
        observationId: 'obs_sqlite',
        actualSkillName: 'report-skill',
        status: 'completed',
      }),
    ]);
  });

  describe('loadLast', () => {
    it('returns null when no last_session file exists', async () => {
      const store = new FileSessionStore(rootDir);
      await expect(store.loadLast()).resolves.toBeNull();
    });

    it('loads the most recently saved session', async () => {
      const store = new FileSessionStore(rootDir);
      await store.save({
        sessionId: 'sess_recent',
        cwd: '/recent',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_recent'],
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      const loaded = await store.loadLast();
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe('sess_recent');
    });

    it('last_session contains only session ID (no path or extra content)', async () => {
      const store = new FileSessionStore(rootDir);
      await store.save({
        sessionId: 'sess_clean_id',
        cwd: '/test',
        createdAt: 100,
        updatedAt: 200,
        lineage: ['sess_clean_id'],
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        compactions: [],
        memoryRefs: [],
        approvalRefs: [],
        backgroundJobRefs: [],
      });

      const lastSessionPath = join(rootDir, 'last_session');
      expect(existsSync(lastSessionPath)).toBe(true);

      const content = readFileSync(lastSessionPath, 'utf-8').trim();
      expect(content).toBe('sess_clean_id');
      // Ensure no path separators or extra content
      expect(content).not.toContain('/');
      expect(content).not.toContain('\n');
      expect(content).toMatch(/^sess_[a-z0-9_]+$/);
    });

    it('returns null if last_session contains corrupted content', async () => {
      const store = new FileSessionStore(rootDir);
      // Write corrupted content (e.g., path or garbage)
      writeFileSync(join(rootDir, 'last_session'), '/some/path/sess_xyz.json\n', 'utf-8');

      await expect(store.loadLast()).resolves.toBeNull();
    });
  });
});

function isSqliteAbiMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NODE_MODULE_VERSION|better-sqlite3/i.test(message);
}
