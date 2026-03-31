import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileApprovalStore, InMemoryApprovalStore } from '../../src/channels/approval-store.js';

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

  it('persists pending approvals across store instances', () => {
    const root = join(tmpdir(), `xiaok-approval-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'approvals.json');

    try {
      const store = new FileApprovalStore(filePath);
      const request = store.create({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        summary: 'Allow deploy?',
        timeoutMs: 60_000,
      });

      const reloaded = new FileApprovalStore(filePath);
      expect(reloaded.get(request.approvalId)).toMatchObject({
        approvalId: request.approvalId,
        sessionId: 'sess_1',
      });

      expect(reloaded.expire(request.approvalId)).toBe('expired');
      expect(new FileApprovalStore(filePath).get(request.approvalId)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
