import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControllerDaemon, encodeControllerRequest } from '../../../src/runtime/verification/controller-daemon.js';
import { callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';

describe('actual private controller daemon and IPC authorization', () => {
  it('uses host-issued exact grants, rejects self-reported user source, and has one lifetime owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-daemon-'));
    const daemon = await createControllerDaemon({ root });
    try {
      await expect(createControllerDaemon({ root })).rejects.toThrow();
      const grant = daemon.issueGrant({ principalId: 'host-user', requestSource: 'user', method: 'controller.status', payload: {}, expiresAt: Date.now() + 10000 });
      const body = encodeControllerRequest({ requestId: 'r1', method: 'controller.status', payload: {}, grant });
      const response = JSON.parse((await callControllerIpc(daemon.socketPath, body)).toString());
      expect(response.result.protocolVersion).toBe(1);
      const replay = JSON.parse((await callControllerIpc(daemon.socketPath, body)).toString());
      expect(replay.error.code).toBe('controller_request_rejected');
      const revocable = daemon.issueGrant({ principalId: 'agent', requestSource: 'agent', method: 'controller.status', payload: {}, expiresAt: Date.now() + 10000 });
      daemon.revokePrincipal('agent');
      const revoked = JSON.parse((await callControllerIpc(daemon.socketPath, encodeControllerRequest({ requestId: 'revoked', method: 'controller.status', payload: {}, grant: revocable }))).toString());
      expect(revoked.error.code).toBe('controller_request_rejected');
      const forged = Buffer.from(JSON.stringify({ version: 1, requestId: 'r2', method: 'execution.reserve', payload: {}, requestSource: 'user', grant }));
      const denied = JSON.parse((await callControllerIpc(daemon.socketPath, forged)).toString());
      expect(denied.error.code).toBe('controller_request_rejected');
    } finally { await daemon.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
