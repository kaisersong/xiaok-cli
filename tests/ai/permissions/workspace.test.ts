import { describe, it, expect } from 'vitest';
import { assertWorkspacePath } from '../../../src/ai/permissions/workspace.js';

describe('workspace path guard', () => {
  it('rejects writes outside cwd by default', () => {
    expect(() =>
      assertWorkspacePath('D:/other/file.ts', 'D:/projects/workspace/xiaok-cli', 'write', false)
    ).toThrow(/outside workspace/i);
  });
});
