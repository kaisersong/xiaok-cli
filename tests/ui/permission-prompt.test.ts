import { describe, it, expect } from 'vitest';
import { deriveRule } from '../../src/ui/permission-prompt.js';

describe('permission-prompt', () => {
  describe('deriveRule', () => {
    it('derives bash rule from command', () => {
      expect(deriveRule('bash', { command: 'npm install express' })).toBe('bash(npm *)');
    });

    it('derives bash rule from single-word command', () => {
      expect(deriveRule('bash', { command: 'ls' })).toBe('bash(ls *)');
    });

    it('derives write rule from file_path', () => {
      expect(deriveRule('write', { file_path: 'src/utils/config.ts' })).toBe('write(src/utils/*)');
    });

    it('derives edit rule from file_path', () => {
      expect(deriveRule('edit', { file_path: 'src/index.ts' })).toBe('edit(src/*)');
    });

    it('falls back to bare tool name when no target', () => {
      expect(deriveRule('bash', {})).toBe('bash');
    });

    it('derives from path parameter', () => {
      expect(deriveRule('glob', { path: '/Users/song/projects/foo/bar.ts' })).toBe('glob(/Users/song/projects/foo/*)');
    });
  });
});
