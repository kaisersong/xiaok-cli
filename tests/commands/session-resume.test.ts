import { describe, it, expect } from 'vitest';
import { formatSubmittedInput } from '../../src/ui/render.js';

describe('session resume', () => {
  describe('formatSubmittedInput', () => {
    it('should format user input correctly', () => {
      const result = formatSubmittedInput('hello world');
      expect(result).toContain('hello world');
    });

    it('should handle empty input', () => {
      const result = formatSubmittedInput('');
      expect(result).toBeDefined();
    });

    it('should handle multiline input', () => {
      const result = formatSubmittedInput('line1\nline2\nline3');
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
    });
  });
});