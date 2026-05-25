import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
});
