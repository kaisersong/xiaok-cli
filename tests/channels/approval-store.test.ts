import { describe, it, expect } from 'vitest';
import { InMemoryApprovalStore } from '../../src/channels/approval-store.js';

describe('approval store', () => {
  it('stores an approval request and resolves it by action', async () => {
    const store = new InMemoryApprovalStore();

    const request = store.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: 'Allow bash command?',
    });

    const waited = store.waitForDecision(request.approvalId);
    expect(store.resolve(request.approvalId, 'approve')).toBe('approve');
    await expect(waited).resolves.toBe('approve');
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

  it('expires approvals that are not answered in time', async () => {
    const store = new InMemoryApprovalStore();

    const request = store.create({
      sessionId: 'sess_1',
      turnId: 'turn_1',
      summary: 'Allow deploy?',
      timeoutMs: 5,
    });

    await expect(store.waitForDecision(request.approvalId)).resolves.toBe('expired');
    expect(store.get(request.approvalId)).toBeUndefined();
  });
});
