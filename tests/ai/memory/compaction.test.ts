import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compactL0toL1, compactL1toL2, compactL2toL3 } from '../../../src/ai/memory/compaction.js';
import { runMigrations } from '../../../src/ai/memory/migrations.js';

describe('compaction pipeline', () => {
  let db: Database.Database;
  let tmpDir: string;
  let mockLLM: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-compact-test-'));
    db = new Database(path.join(tmpDir, 'test.db'));
    runMigrations(db);
    mockLLM = vi.fn();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('L0→L1', () => {
    it('should extract key facts and mark by ID', async () => {
      for (let i = 0; i < 5; i++) {
        db.prepare(
          `INSERT INTO memory_l0_raw (id, session_id, role, content) VALUES (?, ?, ?, ?)`
        ).run(`r-${i}`, 's1', 'user', `message ${i}`);
      }

      mockLLM.mockResolvedValueOnce(
        JSON.stringify({
          summaries: [
            { summary: '用户技术栈偏好', tags: ['typescript', 'vitest'] },
          ],
        })
      );

      const result = await compactL0toL1(db, mockLLM, { sessionId: 's1' });
      expect(result.extracted).toBeGreaterThan(0);

      const allInSession = db.prepare(
        'SELECT id, compacted FROM memory_l0_raw WHERE session_id = ?'
      ).all('s1') as any[];
      expect(allInSession.every((m: any) => m.compacted === 1)).toBe(true);
    });

    it('should skip if no uncompacted messages', async () => {
      const result = await compactL0toL1(db, mockLLM, { sessionId: 's1' });
      expect(result.extracted).toBe(0);
      expect(mockLLM).not.toHaveBeenCalled();
    });

    it('should truncate prompt if it exceeds maxPromptTokens', async () => {
      const longContent = 'x'.repeat(50000);
      db.prepare(
        `INSERT INTO memory_l0_raw (id, session_id, role, content) VALUES (?, ?, ?, ?)`
      ).run('long-1', 's1', 'user', longContent);
      for (let i = 0; i < 6; i++) {
        db.prepare(
          `INSERT INTO memory_l0_raw (id, session_id, role, content) VALUES (?, ?, ?, ?)`
        ).run(`short-${i}`, 's1', 'user', `short message ${i}`);
      }

      mockLLM.mockResolvedValueOnce(
        JSON.stringify({ summaries: [{ summary: 'truncated test', tags: ['test'] }] })
      );

      const result = await compactL0toL1(db, mockLLM, { sessionId: 's1', maxPromptTokens: 8000 });
      expect(result.extracted).toBe(1);

      const callArg = mockLLM.mock.calls[0][0] as string;
      expect(callArg.length).toBeLessThan(50000);
    });
  });

  describe('L1→L2', () => {
    it('should group L1 summaries into scenarios', async () => {
      db.prepare(
        `INSERT INTO memory_l1_extracted (id, summary, tags) VALUES (?, ?, ?)`
      ).run('e1', '用户偏好TypeScript', '["typescript"]');
      db.prepare(
        `INSERT INTO memory_l1_extracted (id, summary, tags) VALUES (?, ?, ?)`
      ).run('e2', '用户偏好Vitest测试', '["vitest"]');
      db.prepare(
        `INSERT INTO memory_l1_extracted (id, summary, tags) VALUES (?, ?, ?)`
      ).run('e3', '用户偏好Docker部署', '["docker"]');

      mockLLM.mockResolvedValueOnce(
        JSON.stringify({
          scenarios: [
            { scenario: '开发环境偏好', key_facts: ['偏好TypeScript', '偏好Vitest'] },
            { scenario: '部署偏好', key_facts: ['偏好Docker'] },
          ],
        })
      );

      const result = await compactL1toL2(db, mockLLM);
      expect(result.scenarios).toBe(2);
    });
  });

  describe('L2→L3', () => {
    it('should extract persona traits from scenarios', async () => {
      db.prepare(
        `INSERT INTO memory_l2_scenario (id, scenario, key_facts) VALUES (?, ?, ?)`
      ).run('sc1', '开发环境偏好', '["偏好TypeScript", "偏好Vitest"]');
      db.prepare(
        `INSERT INTO memory_l2_scenario (id, scenario, key_facts) VALUES (?, ?, ?)`
      ).run('sc2', '代码风格偏好', '["偏好函数式编程", "偏好TypeScript"]');

      mockLLM.mockResolvedValueOnce(
        JSON.stringify({
          traits: [
            { trait: 'TypeScript优先', evidence: ['开发环境偏好', '代码风格偏好'], confidence: 0.95 },
            { trait: '函数式编程倾向', evidence: ['代码风格偏好'], confidence: 0.7 },
          ],
        })
      );

      const result = await compactL2toL3(db, mockLLM);
      expect(result.traits).toBe(2);
    });

    it('should merge duplicate traits with confidence boost', async () => {
      db.prepare(
        `INSERT INTO memory_l3_persona (id, trait, evidence, confidence) VALUES (?, ?, ?, ?)`
      ).run('p1', 'TypeScript优先', '["evidence1"]', 0.8);

      db.prepare(
        `INSERT INTO memory_l2_scenario (id, scenario, key_facts) VALUES (?, ?, ?)`
      ).run('sc1', '开发环境偏好', '["偏好TypeScript"]');
      db.prepare(
        `INSERT INTO memory_l2_scenario (id, scenario, key_facts) VALUES (?, ?, ?)`
      ).run('sc2', '另一个场景', '["其他"]');

      mockLLM.mockResolvedValueOnce(
        JSON.stringify({
          traits: [
            { trait: 'TypeScript优先', evidence: ['开发环境偏好'], confidence: 0.9 },
          ],
        })
      );

      await compactL2toL3(db, mockLLM);

      const l3Rows = db.prepare('SELECT * FROM memory_l3_persona').all() as any[];
      expect(l3Rows.length).toBe(1);
      expect(l3Rows[0].confidence).toBeGreaterThan(0.8);
    });
  });
});
