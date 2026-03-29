import { describe, it, expect } from 'vitest';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';

describe('approval store', () => {
  it('stores an approval request and resolves it by action', () => {
    const store = new InMemoryApprovalStore();

    const request = store.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: 'Allow bash command?',
    });

    expect(store.resolve(request.approvalId, 'approve')).toBe('approve');
  });

  it('keeps request details available before resolution', () => {
    const store = new InMemoryApprovalStore();

    const request = store.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: 'Allow deploy?',
    });

    expect(store.get(request.approvalId)).toEqual(request);
  });

  it('returns undefined when resolving an unknown approval id', () => {
    const store = new InMemoryApprovalStore();

    expect(store.resolve('approval_missing', 'deny')).toBeUndefined();
  });
});
