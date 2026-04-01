import { describe, expect, it } from 'vitest';
import { formatErrorText } from '../../src/utils/ui.js';

describe('formatErrorText', () => {
  it('removes a duplicated Error prefix from thrown Error strings', () => {
    expect(formatErrorText('Error: boom')).toBe('boom');
  });

  it('preserves plain text messages', () => {
    expect(formatErrorText('请求失败 (502 Bad Gateway)')).toBe('请求失败 (502 Bad Gateway)');
  });
});
