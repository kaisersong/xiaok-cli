import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWorkspacePath } from '../../../src/ai/permissions/workspace.js';
import { createWriteTool } from '../../../src/ai/tools/write.js';

describe('workspace path guard', () => {
  it('rejects writes outside cwd by default', () => {
    expect(() =>
      assertWorkspacePath('D:/other/file.ts', 'D:/projects/workspace/xiaok-cli', 'write', false)
    ).toThrow(/outside workspace/i);
  });

  it('allows absolute artifact writes inside an explicit workspace cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-workspace-guard-'));
    try {
      const filePath = join(root, 'artifacts', 'report.md');
      const tool = createWriteTool({ cwd: root });

      await tool.execute({ file_path: filePath, content: '# Report' });

      expect(readFileSync(filePath, 'utf-8')).toBe('# Report');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('normalization and symlink escapes (P0-4)', () => {
    function setup() {
      const ws = mkdtempSync(join(tmpdir(), 'xiaok-ws-'));
      const out = mkdtempSync(join(tmpdir(), 'xiaok-out-'));
      writeFileSync(join(out, 'secret.txt'), 'x');
      symlinkSync(out, join(ws, 'link'));
      mkdirSync(join(ws, 'src'));
      return { ws, out };
    }

    it('rejects parent traversal for read and write', () => {
      const { ws } = setup();
      expect(() => assertWorkspacePath(join(ws, 'src', '..', '..', 'x'), ws, 'read')).toThrow(/outside workspace/i);
      expect(() => assertWorkspacePath(`${ws}/./../x`, ws, 'write')).toThrow(/outside workspace/i);
    });

    it('rejects in-workspace symlinks pointing outside, for read as well as write', () => {
      const { ws } = setup();
      expect(() => assertWorkspacePath(join(ws, 'link', 'secret.txt'), ws, 'read')).toThrow(/symlink/i);
      expect(() => assertWorkspacePath(join(ws, 'link', 'new.txt'), ws, 'write')).toThrow(/symlink/i);
    });

    it('with allowOutsideCwd, routes outside and symlink-escaping paths through the guard', () => {
      const { ws, out } = setup();
      const seen: string[] = [];
      const deny = (p: string) => { seen.push(p); return { allowed: false, reason: 'path is outside allowlist' }; };
      expect(() => assertWorkspacePath(join(ws, 'link', 'secret.txt'), ws, 'read', true, deny)).toThrow(/denied by sandbox/i);
      expect(() => assertWorkspacePath(join(ws, '..', 'x'), ws, 'write', true, deny)).toThrow(/denied by sandbox/i);
      expect(seen).toHaveLength(2);

      const allow = () => ({ allowed: true });
      expect(assertWorkspacePath(join(out, 'secret.txt'), ws, 'read', true, allow)).toBe(join(out, 'secret.txt'));
    });

    it('keeps legitimate in-workspace paths working without consulting the guard', () => {
      const { ws } = setup();
      const guard = () => { throw new Error('guard should not be called'); };
      expect(assertWorkspacePath(join(ws, 'src', 'a.ts'), ws, 'write', true, guard)).toBe(join(ws, 'src', 'a.ts'));
      expect(assertWorkspacePath(join(ws, 'src', '..', 'b.ts'), ws, 'read')).toBe(join(ws, 'b.ts'));
      expect(assertWorkspacePath(join(ws, 'new', 'deep', 'c.ts'), ws, 'write')).toBe(join(ws, 'new', 'deep', 'c.ts'));
    });
  });
});
