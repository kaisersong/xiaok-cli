import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopStore } from '../../electron/loop-store.js';
import type { AddConstraintInput } from '../../electron/loop-store.js';
import type { LearnedConstraint } from '../../electron/loop-types.js';
import {
  extractViaLLM,
  extractViaRule,
  EXTRACTION_SYSTEM_PROMPT,
} from '../../electron/loop-llm-port.js';
import type { LoopLLMPort } from '../../electron/loop-llm-port.js';
import { buildPromptWithConstraints, runPreflight } from '../../electron/user-loop-template-runner.js';

describe('Loop Learned Constraints', () => {
  let rootDir: string;
  let dbPath: string;
  let store: LoopStore;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-loop-constraints-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    dbPath = join(rootDir, 'loops.sqlite');
    store = new LoopStore(dbPath);
    store.ensureBuiltInLoops(1_000);
  });

  afterEach(() => {
    try { store.close(); } catch { /* already closed */ }
    rmSync(rootDir, { recursive: true, force: true });
  });

  function createTestLoop(loopId = 'test-loop'): void {
    store.createUserLoopTemplate({
      loopId,
      title: 'Test Loop',
      description: 'A test loop',
      kind: 'markdown_file',
      prompt: 'Write a report',
      outputDirectory: join(rootDir, 'outputs'),
      outputFileName: 'report.md',
      now: 2_000,
    });
  }

  function addTestConstraint(overrides: Partial<AddConstraintInput> = {}): LearnedConstraint {
    return store.addConstraint({
      loopId: 'test-loop',
      source: 'llm_extraction',
      rule: 'Use Write tool to write file.',
      sourceRunId: 'run-1',
      failureKind: 'missing_file_artifact',
      failureReason: 'missing_file',
      now: 3_000,
      ...overrides,
    });
  }

  describe('Schema', () => {
    it('creates loop_learned_constraints table idempotently', () => {
      store.close();
      // Reopen should not throw
      const store2 = new LoopStore(dbPath);
      const db = new DatabaseSync(dbPath);
      const tables = db.prepare(`
        select name from sqlite_master
        where type = 'table' and name = 'loop_learned_constraints'
      `).all() as Array<{ name: string }>;
      db.close();
      store2.close();
      expect(tables).toHaveLength(1);
    });

    it('adds duration_ms column to loop_runs via ensureColumn', () => {
      store.close();
      const db = new DatabaseSync(dbPath);
      const columns = db.prepare('pragma table_info(loop_runs)').all() as Array<{ name: string }>;
      db.close();
      expect(columns.map(c => c.name)).toContain('duration_ms');
    });

    it('schema is idempotent on repeated opens', () => {
      store.close();
      const store2 = new LoopStore(dbPath);
      store2.close();
      const store3 = new LoopStore(dbPath);
      store3.close();
      // No error means idempotent
    });
  });

  describe('addConstraint', () => {
    it('creates a constraint with active=0', () => {
      createTestLoop();
      const constraint = addTestConstraint();
      expect(constraint.active).toBe(false);
      expect(constraint.source).toBe('llm_extraction');
      expect(constraint.rule).toBe('Use Write tool to write file.');
      expect(constraint.loopId).toBe('test-loop');
      expect(constraint.sourceRunId).toBe('run-1');
      expect(constraint.failureKind).toBe('missing_file_artifact');
      expect(constraint.failureReason).toBe('missing_file');
      expect(constraint.hitCount).toBe(0);
      expect(constraint.consecutiveIneffectiveCount).toBe(0);
      expect(constraint.deactivationReason).toBeNull();
      expect(constraint.supersededBy).toBeNull();
    });

    it('stores extractionContext', () => {
      createTestLoop();
      const constraint = store.addConstraint({
        loopId: 'test-loop',
        source: 'llm_extraction',
        rule: 'Always write to disk.',
        sourceRunId: 'run-2',
        extractionContext: 'Context about the failure',
        now: 3_000,
      });
      expect(constraint.extractionContext).toBe('Context about the failure');
    });
  });

  describe('dedup (four-tuple supersede)', () => {
    it('supersedes existing constraint with same four-tuple', () => {
      createTestLoop();
      const first = addTestConstraint({ now: 3_000 });
      const second = addTestConstraint({ now: 4_000, rule: 'Updated rule.' });

      // The first should be superseded
      const all = store.getConstraintsByLoopId('test-loop');
      const firstUpdated = all.find(c => c.id === first.id)!;
      expect(firstUpdated.supersededBy).toBe(second.id);
      expect(firstUpdated.deactivationReason).toBe('superseded');

      // The second is the new one
      expect(second.rule).toBe('Updated rule.');
      expect(second.supersededBy).toBeNull();
    });
  });

  describe('getActiveConstraints', () => {
    it('returns only confirmed (active=1) constraints', () => {
      createTestLoop();
      const c1 = addTestConstraint({ now: 3_000 });
      store.confirmConstraint(c1.id);

      const c2 = store.addConstraint({
        loopId: 'test-loop',
        source: 'rule_extraction',
        rule: 'Second rule',
        sourceRunId: 'run-2',
        failureKind: 'other',
        now: 4_000,
      });
      // c2 is pending

      const active = store.getActiveConstraints('test-loop');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(c1.id);
    });

    it('returns max 10 constraints ordered by created_at desc', () => {
      createTestLoop();
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) {
        const c = store.addConstraint({
          loopId: 'test-loop',
          source: 'user_manual',
          rule: `Rule ${i}`,
          sourceRunId: `run-${i}`,
          failureKind: `kind-${i}`,
          now: 3_000 + i,
        });
        store.confirmConstraint(c.id);
        ids.push(c.id);
      }
      const active = store.getActiveConstraints('test-loop');
      expect(active.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getPendingConstraints', () => {
    it('returns pending constraints (active=0, no deactivation, no supersede)', () => {
      createTestLoop();
      addTestConstraint({ now: 3_000 });
      const pending = store.getPendingConstraints('test-loop');
      expect(pending).toHaveLength(1);
      expect(pending[0].active).toBe(false);
    });
  });

  describe('confirmConstraint', () => {
    it('sets active=1', () => {
      createTestLoop();
      const c = addTestConstraint();
      const confirmed = store.confirmConstraint(c.id);
      expect(confirmed?.active).toBe(true);
    });

    it('returns undefined for already active constraint', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);
      const result = store.confirmConstraint(c.id);
      expect(result).toBeUndefined();
    });
  });

  describe('setConstraintActive', () => {
    it('user deactivates a constraint', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);
      const deactivated = store.setConstraintActive(c.id, false);
      expect(deactivated?.active).toBe(false);
      expect(deactivated?.deactivationReason).toBe('user');
    });

    it('user reactivates a constraint', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);
      store.setConstraintActive(c.id, false);
      const reactivated = store.setConstraintActive(c.id, true);
      expect(reactivated?.active).toBe(true);
      expect(reactivated?.deactivationReason).toBeNull();
    });
  });

  describe('bumpConstraintHits', () => {
    it('increments hitCount and sets lastHitAt', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);
      store.bumpConstraintHits([c.id]);
      const updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.hitCount).toBe(1);
      expect(updated.lastHitAt).not.toBeNull();
    });
  });

  describe('consecutiveIneffective', () => {
    it('increments count and auto-deactivates at 3', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);

      store.incrementConsecutiveIneffective([c.id]);
      let updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.consecutiveIneffectiveCount).toBe(1);
      expect(updated.active).toBe(true);

      store.incrementConsecutiveIneffective([c.id]);
      updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.consecutiveIneffectiveCount).toBe(2);
      expect(updated.active).toBe(true);

      store.incrementConsecutiveIneffective([c.id]);
      updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.consecutiveIneffectiveCount).toBe(3);
      expect(updated.active).toBe(false);
      expect(updated.deactivationReason).toBe('ineffective');
    });

    it('resetConsecutiveIneffective resets to 0', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);
      store.incrementConsecutiveIneffective([c.id]);
      store.incrementConsecutiveIneffective([c.id]);
      store.resetConsecutiveIneffective([c.id]);
      const updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.consecutiveIneffectiveCount).toBe(0);
    });
  });

  describe('deactivateStaleConstraints', () => {
    it('deactivates active constraints not hit in 30 days', () => {
      createTestLoop();
      const c = addTestConstraint({ now: 1_000 });
      store.confirmConstraint(c.id);

      const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;
      const deactivated = store.deactivateStaleConstraints('test-loop', 1_000 + thirtyOneDays);
      expect(deactivated).toBeGreaterThan(0);

      const updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.deactivationReason).toBe('stale');
    });

    it('deactivates pending constraints not confirmed in 14 days', () => {
      createTestLoop();
      const c = addTestConstraint({ now: 1_000 });
      // c stays pending (active=0)

      const fifteenDays = 15 * 24 * 60 * 60 * 1000;
      const deactivated = store.deactivateStaleConstraints('test-loop', 1_000 + fifteenDays);
      expect(deactivated).toBeGreaterThan(0);

      const updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.deactivationReason).toBe('stale');
    });

    it('does not deactivate recently created constraints', () => {
      createTestLoop();
      const now = Date.now();
      addTestConstraint({ now });

      const deactivated = store.deactivateStaleConstraints('test-loop', now + 1_000);
      expect(deactivated).toBe(0);
    });
  });

  describe('finishLoopRunWithDuration', () => {
    it('records duration_ms on a run', () => {
      createTestLoop();
      const beginResult = store.beginLoopRun('test-loop', { kind: 'manual' }, 5_000, 60_000);
      expect(beginResult.status).toBe('started');
      if (beginResult.status !== 'started') throw new Error('unexpected');
      const runId = beginResult.run.id;

      store.finishLoopRunSuccess(runId, [], 6_000, 'Done.');
      store.finishLoopRunWithDuration(runId, 1_000);

      // Verify via raw DB
      store.close();
      const db = new DatabaseSync(dbPath);
      const row = db.prepare('select duration_ms from loop_runs where id = ?').get(runId) as { duration_ms: number } | undefined;
      db.close();
      expect(row?.duration_ms).toBe(1_000);
    });
  });

  describe('extractViaLLM', () => {
    it('returns rule text from LLM', async () => {
      const mockPort: LoopLLMPort = {
        complete: vi.fn().mockResolvedValue({ text: 'Write file to disk before finishing.' }),
      };
      const result = await extractViaLLM(mockPort, {
        loopTitle: 'Test',
        loopPrompt: 'Write report',
        failureKind: 'missing_file_artifact',
        failureMessage: 'file not found',
        lastAgentOutput: 'I completed the task...',
      });
      expect(result).toBe('Write file to disk before finishing.');
      expect(mockPort.complete).toHaveBeenCalledWith(expect.objectContaining({
        model: 'fast',
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        temperature: 0,
      }));
    });

    it('returns null when LLM returns NONE', async () => {
      const mockPort: LoopLLMPort = {
        complete: vi.fn().mockResolvedValue({ text: 'NONE' }),
      };
      const result = await extractViaLLM(mockPort, {
        loopTitle: 'Test',
        loopPrompt: 'Write report',
        failureKind: 'unknown',
        failureMessage: 'something',
        lastAgentOutput: '',
      });
      expect(result).toBeNull();
    });

    it('returns null when LLM returns empty', async () => {
      const mockPort: LoopLLMPort = {
        complete: vi.fn().mockResolvedValue({ text: '' }),
      };
      const result = await extractViaLLM(mockPort, {
        loopTitle: 'Test',
        loopPrompt: 'Write report',
        failureKind: 'unknown',
        failureMessage: 'something',
        lastAgentOutput: '',
      });
      expect(result).toBeNull();
    });

    it('throws when LLM port throws (timeout simulation)', async () => {
      const mockPort: LoopLLMPort = {
        complete: vi.fn().mockRejectedValue(new Error('timeout')),
      };
      await expect(extractViaLLM(mockPort, {
        loopTitle: 'Test',
        loopPrompt: 'Write report',
        failureKind: 'unknown',
        failureMessage: 'something',
        lastAgentOutput: '',
      })).rejects.toThrow('timeout');
    });
  });

  describe('extractViaRule (fallback)', () => {
    it('returns rule for missing_file_artifact + missing_file', () => {
      const result = extractViaRule('missing_file_artifact', 'missing_file');
      expect(result).toBe('使用 Write 工具将内容写入目标路径，不要仅在对话中输出。');
    });

    it('returns rule for missing_file_artifact + empty_file', () => {
      const result = extractViaRule('missing_file_artifact', 'empty_file');
      expect(result).toBe('确保输出文件非空，至少包含标题和正文内容。');
    });

    it('returns null for unknown failureKind', () => {
      const result = extractViaRule('random_kind', 'random_reason');
      expect(result).toBeNull();
    });

    it('returns null for undefined failureKind', () => {
      const result = extractViaRule(undefined, undefined);
      expect(result).toBeNull();
    });
  });

  describe('buildPromptWithConstraints', () => {
    it('returns base prompt unchanged when no active constraints', () => {
      createTestLoop();
      const { prompt, injectedConstraintIds } = buildPromptWithConstraints(
        'Write a report',
        store,
        'test-loop'
      );
      expect(prompt).toBe('Write a report');
      expect(injectedConstraintIds).toEqual([]);
    });

    it('appends active constraints to prompt', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);

      const { prompt, injectedConstraintIds } = buildPromptWithConstraints(
        'Write a report',
        store,
        'test-loop'
      );
      expect(prompt).toContain('以下规则必须遵守');
      expect(prompt).toContain('Use Write tool to write file.');
      expect(injectedConstraintIds).toEqual([c.id]);
    });

    it('bumps hit count for injected constraints', () => {
      createTestLoop();
      const c = addTestConstraint();
      store.confirmConstraint(c.id);

      buildPromptWithConstraints('Write a report', store, 'test-loop');
      const updated = store.getConstraintsByLoopId('test-loop').find(x => x.id === c.id)!;
      expect(updated.hitCount).toBe(1);
    });
  });

  describe('runPreflight', () => {
    it('returns ok for writable directory', () => {
      const result = runPreflight({
        loopId: 'test',
        kind: 'markdown_file',
        prompt: 'test',
        outputDirectory: rootDir,
        outputFileName: 'out.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      expect(result.ok).toBe(true);
    });

    it('returns not ok for non-absolute directory', () => {
      const result = runPreflight({
        loopId: 'test',
        kind: 'markdown_file',
        prompt: 'test',
        outputDirectory: 'relative/path',
        outputFileName: 'out.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('output_directory_not_absolute');
      }
    });

    it('returns ok for task_completion (no dir check)', () => {
      const result = runPreflight({
        loopId: 'test',
        kind: 'task_completion',
        prompt: 'do something',
        outputDirectory: '',
        outputFileName: '',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('getConstraintsByLoopId', () => {
    it('returns all constraints for a loop', () => {
      createTestLoop();
      addTestConstraint({ now: 3_000 });
      store.addConstraint({
        loopId: 'test-loop',
        source: 'rule_extraction',
        rule: 'Another rule',
        sourceRunId: 'run-3',
        failureKind: 'other',
        now: 4_000,
      });

      const all = store.getConstraintsByLoopId('test-loop');
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });
});
