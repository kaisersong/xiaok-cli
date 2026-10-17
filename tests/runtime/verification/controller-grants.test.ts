import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ControllerGrantStore } from '../../../src/runtime/verification/controller-grants.js';

describe('service-private exact-operation capability ledger', () => {
  it('rejects altered operation and replay across restart; caller source comes from the issued grant', () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-grants-'));
    let store = new ControllerGrantStore(root);
    try {
      const grant = store.issue({ principalId: 'host-user', requestSource: 'user', method: 'execution.reserve', payload: { commandDigest: 'a'.repeat(64) }, expiresAt: 2000 }, 1000);
      expect(() => store.consume(grant, 'execution.reserve', { commandDigest: 'b'.repeat(64) }, 1001)).toThrow('controller_grant_mismatch');
      const caller = store.consume(grant, 'execution.reserve', { commandDigest: 'a'.repeat(64) }, 1001);
      expect(caller.requestSource).toBe('user');
      store.close(); store = new ControllerGrantStore(root);
      expect(() => store.consume(grant, 'execution.reserve', { commandDigest: 'a'.repeat(64) }, 1002)).toThrow('controller_grant_consumed');
      expect(() => store.consume({ ...grant, secret: '0'.repeat(64) }, 'execution.reserve', { commandDigest: 'a'.repeat(64) }, 1002)).toThrow('controller_grant_mismatch');
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('revokes unused grants durably and rejects expiry without restoring permission', () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-grants-'));
    const store = new ControllerGrantStore(root);
    try {
      const grant = store.issue({ principalId: 'agent', requestSource: 'agent', method: 'execution.reserve', payload: {}, expiresAt: 2000 }, 1000);
      store.revokePrincipal('agent');
      expect(() => store.consume(grant, 'execution.reserve', {}, 1001)).toThrow('controller_grant_revoked');
      const expired = store.issue({ principalId: 'other', requestSource: 'scheduler', method: 'execution.reserve', payload: {}, expiresAt: 2000 }, 1001);
      expect(() => store.consume(expired, 'execution.reserve', {}, 2000)).toThrow('controller_grant_expired');
      expect(() => store.consume(expired, 'execution.reserve', {}, 1500)).toThrow('controller_clock_regressed');
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  });  it('reclaims expired capability slots while preserving immutable audit and denying replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-grants-'));
    const store = new ControllerGrantStore(root);
    const NativeDatabase = createRequire(import.meta.url)('better-sqlite3');
    const db = new NativeDatabase(join(root, 'authority.sqlite'));
    try {
      const old = store.issue({ principalId: 'host', requestSource: 'user', method: 'controller.status', payload: {}, expiresAt: 2000 }, 1000);
      db.transaction(() => {
        const copy = db.prepare('INSERT INTO controller_grants SELECT ?,secret_hash,principal_id,request_source,method,payload_hash,expires_at,state FROM controller_grants WHERE id=?');
        for (let i = 0; i < 4095; i++) copy.run('fixture-' + i, old.id);
      })();
      expect(() => store.issue({ principalId: 'host', requestSource: 'user', method: 'controller.status', payload: {}, expiresAt: 3000 }, 1001)).toThrow('verification_capacity_exhausted');
      const next = store.issue({ principalId: 'host', requestSource: 'user', method: 'controller.status', payload: {}, expiresAt: 3000 }, 2000);
      expect(next.id).not.toBe(old.id);
      expect(db.prepare('SELECT COUNT(*) AS n FROM controller_grant_audit').get().n).toBe(4096);
      expect(() => store.consume(old, 'controller.status', {}, 2001)).toThrow('controller_grant_mismatch');
    } finally { db.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
  });

});
