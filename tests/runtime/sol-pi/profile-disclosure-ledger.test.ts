import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createFullSendCounter } from '../../../src/runtime/sol-pi/full-send-counter.js';
import { createProfileDisclosureLedger, getProfileDisclosureAccountBinding } from '../../../src/runtime/sol-pi/profile-disclosure-ledger.js';
const destination = { provider: 'test', model: 'test', url: 'https://example.test/v1/chat/completions' };
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'profile-disclosure-')); cleanup.push(() => rmSync(root, { force: true, recursive: true }));
  const service = createObservationService({ profileRoot: root, profileId: 'p', reservedProfileBytes: 4 * 1024 * 1024, redactor: { version: 'fixture', redact: text => text } }); cleanup.push(() => service.dispose());
  const counter = createFullSendCounter({ root: join(root, 'shared-ledger'), sessionId: 'source-owner' }); cleanup.push(() => counter.dispose());
  const claims = { sessionId: 'parent', ownerAgentId: 'parent', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
  const user = service.bindCaller({ ...claims, requestSource: 'user' }); const caller = service.bindCaller({ ...claims, requestSource: 'agent' });
  service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'fixture', sourceDescriptors: ['source'], expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, destinations: [destination] } });
  const capture = service.begin({ requestSource: 'agent', caller, invocationId: 'native', toolName: 'read', sourceAdapterId: 'fixture', sourceDescriptor: 'source' });
  service.append({ requestSource: 'agent', caller, capture, text: 'protected' });
  const ref = service.finalize({ requestSource: 'agent', caller, capture, executionState: 'terminal', outcome: 'success' });
  const recipient = service.bindCaller({ ...claims, sessionId: 'child', ownerAgentId: 'child', requestSource: 'agent' });
  const grant = service.issueDelegation({ requestSource: 'user', caller: user, recipient, observationIds: [ref.id], destination, expiresAt: Date.now() + 30000 });
  const delegated = service.bindDelegatedCaller({ capability: grant, recipient });
  const ledger = createProfileDisclosureLedger({ service, counter }); cleanup.push(() => ledger.dispose());
  const parent = ledger.createAccount({ requestSource: 'user', caller, sessionId: 'parent', destination });
  const child = ledger.createAccount({ requestSource: 'user', caller: delegated, sessionId: 'child', destination });
  const attempt = { logicalInvocationId: 'same-local-id', serializedBody: '{"model":"test"}', observationIds: [ref.id] };
  return { root, service, counter, ledger, parent, child, caller, delegated, user, ref, grant, attempt };
}
it('shares source counts across consumers with independent logical invocation namespaces', () => {
  const f = fixture(); f.parent.registerNewObservation(f.ref.id);
  expect(f.child.read(f.ref.id)).toBe(0);
  f.parent.prepare(f.attempt); f.parent.confirm(f.attempt);
  expect(f.child.read(f.ref.id)).toBe(1);
  f.child.prepare(f.attempt); f.child.confirm(f.attempt);
  expect(f.parent.read(f.ref.id)).toBe(2); expect(f.counter.read(f.ref.id)).toBe(2);
  f.child.prepare(f.attempt); f.child.confirm(f.attempt);
  expect(f.counter.read(f.ref.id)).toBe(2);
  expect(f.parent.getStorageReservation().root).toBe(f.child.getStorageReservation().root);
  expect(f.child.getStorageReservation().sessionId).toBe('child');
});
it('never registers a delegated source as a new capture or resets an unknown count', () => {
  const f = fixture();
  expect(f.child.read(f.ref.id)).toBeNull();
  expect(() => f.child.registerNewObservation(f.ref.id)).toThrow();
  f.parent.registerNewObservation(f.ref.id); f.parent.prepare(f.attempt); f.parent.markUnknown(f.attempt);
  expect(f.child.read(f.ref.id)).toBeNull();
  expect(() => f.parent.registerNewObservation(f.ref.id)).toThrow();
});
it('binds opaque accounts to the actual service and session and rejects counterfeit or repeated allocation', () => {
  const f = fixture();
  expect(getProfileDisclosureAccountBinding(f.child, f.service, 'child')?.sourceCounter).toBe(f.counter);
  expect(getProfileDisclosureAccountBinding({}, f.service, 'child')).toBeUndefined();
  expect(() => getProfileDisclosureAccountBinding(f.child, f.service, 'parent')).toThrow();
  expect(() => f.ledger.createAccount({ requestSource: 'agent', caller: f.caller, sessionId: 'another', destination })).toThrow();
  expect(() => f.ledger.createAccount({ requestSource: 'user', caller: {}, sessionId: 'another', destination })).toThrow();
  expect(() => f.ledger.createAccount({ requestSource: 'user', caller: f.caller, sessionId: 'child', destination })).toThrow();
  expect(() => createProfileDisclosureLedger({ service: f.service, counter: f.counter })).toThrow();
});
it('rejects revoked consumers and disposal without closing another consumer source ledger', () => {
  const f = fixture(); f.parent.registerNewObservation(f.ref.id); f.child.dispose();
  expect(() => f.child.read(f.ref.id)).toThrow(); expect(f.parent.read(f.ref.id)).toBe(0);
  f.service.revokeDelegation({ requestSource: 'user', caller: f.user, capability: f.grant });
  expect(() => f.child.prepare(f.attempt)).toThrow();
  f.ledger.dispose(); expect(() => f.parent.read(f.ref.id)).toThrow();
  expect(f.counter.read(f.ref.id)).toBe(0);
});

it('settles an already dispatched unknown after revocation without authorizing another disclosure', () => {
  const f = fixture(); f.parent.registerNewObservation(f.ref.id);
  f.child.prepare(f.attempt); f.child.confirm(f.attempt); expect(f.counter.read(f.ref.id)).toBe(1);
  f.service.revokeDelegation({ requestSource: 'user', caller: f.user, capability: f.grant });
  expect(() => f.child.markUnknown(f.attempt)).not.toThrow(); expect(f.counter.read(f.ref.id)).toBeNull();
  expect(() => f.child.prepare({ ...f.attempt, logicalInvocationId: 'new' })).toThrow();
  expect(() => f.child.markUnknown({ ...f.attempt, serializedBody: 'changed' })).toThrow();
});
