import { describe, expect, it } from 'vitest';
import { ContinuationArbiter } from '../../../src/runtime/goal/index.js';

describe('ContinuationArbiter', () => {
  it('gives queued user input priority over broker and Goal candidates', () => {
    const arbiter = new ContinuationArbiter();
    expect(arbiter.select({
      queuedUserInput: '用户新消息',
      brokerContinuation: 'broker',
      goalContinuation: 'goal',
    })).toEqual({ kind: 'user', input: '用户新消息' });
  });

  it('selects at most one automatic continuation in broker then Goal order', () => {
    const arbiter = new ContinuationArbiter();
    expect(arbiter.select({ brokerContinuation: 'broker', goalContinuation: 'goal' }))
      .toEqual({ kind: 'broker', input: 'broker' });
    expect(arbiter.select({ goalContinuation: 'goal' }))
      .toEqual({ kind: 'goal', input: 'goal' });
    expect(arbiter.select({})).toBeNull();
  });
});
