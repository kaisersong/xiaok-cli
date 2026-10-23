import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerObservationCommands, deleteObservationSession } from '../../src/commands/observation.js';
import { FileSessionStore } from '../../src/ai/runtime/session-store/file-store.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('explicit observation CLI deletion', () => {
  it('rejects agent/scheduler requests and unsupported platform before native work', async () => {
    for (const requestSource of ['agent', 'scheduler'] as const) await expect(deleteObservationSession({ requestSource, sessionId: 's' })).rejects.toThrow('REQUEST_SOURCE');
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    await expect(deleteObservationSession({ requestSource: 'user', sessionId: 's' })).rejects.toThrow('PLATFORM_NOT_READY');
  });
  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('rejects a dangling owner-lock symlink before opening a native database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'solpi-lock-link-')); vi.stubEnv('XIAOK_CONFIG_DIR', root);
    try {
      mkdirSync(join(root, 'observation-profile'), { mode: 0o700 });
      symlinkSync(join(root, 'missing-target'), join(root, 'observation-profile', '.observation-owner.sqlite'));
      await expect(deleteObservationSession({ requestSource: 'user', sessionId: 's' })).rejects.toThrow('UNSAFE_PROFILE');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')('refuses an actual live observation owner even when snapshot ownership metadata is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'solpi-live-delete-')); vi.stubEnv('XIAOK_CONFIG_DIR', root);
    const { createObservationService } = await import('../../src/runtime/sol-pi/observation-service.js');
    const active = createObservationService({ profileRoot: join(root, 'observation-profile'), profileId: 'product-sol-pi-v1', redactor: { version: 'v1', redact: text => text } });
    try {
      const store = new FileSessionStore(join(root, 'sessions')); const snapshot = { ...new AgentSessionState().exportSnapshot(), sessionId: 'sess_live', protectedObservationClosure: { version: 1 as const, requiresReauthorization: true as const, observations: [{ authorityId: active.authorityId, profileId: 'product-sol-pi-v1', sourceSessionId: 'sess_live', ownerAgentId: 'o', scopeId: 's', permissionGeneration: 1, observationId: 'obs', contentHash: 'a'.repeat(64), revision: 1, policyId: 'p', policyRevision: 1 }] } };
      await store.save(snapshot);
      await expect(deleteObservationSession({ requestSource: 'user', sessionId: 'sess_live' })).rejects.toThrow('OWNER_ACTIVE');
      expect(await store.load('sess_live')).not.toBeNull();
    } finally { active.dispose(); rmSync(root, { recursive: true, force: true }); }
  });
  it.runIf(process.platform === 'darwin' && process.arch === 'arm64').each(['sessions','compound-sessions'])('runs the registered user command against the real %s file store and receipt database', async (sessionRoot) => {
    const root = mkdtempSync(join(tmpdir(), 'solpi-command-delete-')); vi.stubEnv('XIAOK_CONFIG_DIR', root);
    try {
      const store = new FileSessionStore(join(root, sessionRoot)); const state = new AgentSessionState();
      const snapshot = { ...state.exportSnapshot(), sessionId: 'sess_command', protectedObservationClosure: { version: 1 as const, requiresReauthorization: true as const, observations: [{ authorityId: '00000000-0000-4000-8000-000000000000', profileId: 'p', sourceSessionId: 'sess_command', ownerAgentId: 'o', scopeId: 's', permissionGeneration: 1, observationId: 'obs', contentHash: 'a'.repeat(64), revision: 1, policyId: 'p', policyRevision: 1 }] } };
      await store.save(snapshot);
      if(sessionRoot==='compound-sessions'){
        const ordinary=new FileSessionStore(join(root,'sessions'));await ordinary.save(snapshot);
        await expect(deleteObservationSession({requestSource:'user',sessionId:snapshot.sessionId})).rejects.toThrow('AMBIGUOUS_SESSION_ROOT');
        expect(await store.load(snapshot.sessionId)).not.toBeNull();expect(await ordinary.load(snapshot.sessionId)).not.toBeNull();
        rmSync(join(root,'sessions'),{recursive:true,force:true});
      }
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = new Command(); registerObservationCommands(program);
      await program.parseAsync(['observation', 'delete-session', 'sess_command'], { from: 'user' });
      expect(await store.load('sess_command')).toBeNull(); await expect(store.save(snapshot)).rejects.toThrow('session_deleted');
      expect(log).toHaveBeenCalled();
      await expect(deleteObservationSession({requestSource:'user',sessionId:snapshot.sessionId})).resolves.toMatchObject({sessionId:snapshot.sessionId});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
