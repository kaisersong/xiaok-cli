import { describe, it, expect } from 'vitest';
import { ModelTextRepetitionGuard } from '../../../src/ai/runtime/model-text-repetition.js';
const run = (text: string, size = 1) => {
  const guard = new ModelTextRepetitionGuard();
  for (let i = 0; i < text.length; i += size) guard.append(text.slice(i, i + size));
};
describe('structured repetition limits', () => {
  it.each(['| row | value |', 'INFO repeated log', '[WARNING] repeated log', '12:34:56 repeated log', '2026-10-25T12:34:56Z repeated log', '[2026-10-25 12:34:56] repeated log'])('exempts %s below backstop', line => {
    expect(() => run((line + '\n').repeat(49))).not.toThrow();
    expect(() => run((line + '\n').repeat(50))).toThrow('MODEL_TEXT_REPETITION_DETECTED');
  });
  it.each(['```', '~~~'])('tracks %s across deltas', fence => {
    expect(() => run(fence + '\n' + 'ordinary repeated line\n'.repeat(49))).not.toThrow();
    expect(() => run(fence + '\n' + 'ordinary repeated line\n'.repeat(50))).toThrow();
  });
  it.each([2, 20])('detects %s-line blocks at ten copies', count => {
    const block = Array.from({ length: count }, (_, i) => `| distinct row ${i} |\n`).join('');
    for (const prefix of ['', '```\n']) {
      expect(() => run(prefix + block.repeat(9))).not.toThrow();
      expect(() => run(prefix + block.repeat(10))).toThrow();
    }
  });
  it('caps visible characters strictly above 65536', () => {
    const guard = new ModelTextRepetitionGuard();
    expect(() => guard.append('0'.repeat(65535))).not.toThrow();
    expect(() => guard.append('0')).not.toThrow();
    expect(() => guard.append('0')).toThrow();
  });
  it('still detects ordinary prose without disclosing it', () => {
    expect(() => run('普通正文重复。'.repeat(100))).toThrow('MODEL_TEXT_REPETITION_DETECTED');
  });
});
it('closes only matching fences and resumes ordinary prose detection', () => {
  expect(() => run('````js\n```\n' + 'safe code line\n'.repeat(30) + '~~~~\n')).not.toThrow();
  expect(() => run('````js\n````\n' + '普通正文重复。'.repeat(100))).toThrow();
});
it('finds blocks after unrelated history and across arbitrary delta boundaries', () => {
  const block = '| first |\r\n| second |\r\n';
  for (const size of [1, 7, 131, 100000]) {
    expect(() => run('unrelated\n' + block.repeat(9), size)).not.toThrow();
    expect(() => run('unrelated\n' + block.repeat(10), size)).toThrow();
  }
});
