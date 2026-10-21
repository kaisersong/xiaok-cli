import { createObservationService } from '../../src/runtime/sol-pi/observation-service.js';
import { AgentSessionState } from '../../src/ai/runtime/session.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root = mkdtempSync(join(tmpdir(), 'solpi-real-gc-'));
const destination = { provider: 'test', model: 'test', url: 'https://example.test/v1/chat/completions' };
const service = createObservationService({ profileRoot: root, profileId: 'test', now: () => 1000, redactor: { version: 'test', redact: value => value } });
try {
  const claims = { sessionId: 'root', ownerAgentId: 'root', scopeId: 'root', permissionGeneration: 1, surface: 'ordinary-owner' as const };
  const user = service.bindCaller({ ...claims, requestSource: 'user' }), parent = service.bindCaller({ ...claims, requestSource: 'agent' });
  service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 'root', sourceAdapterId: 'fixture', sourceDescriptors: ['exact'], expiresAt: 100000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, destinations: [destination] } });
  const approval = service.approveDelegation({ requestSource: 'user', caller: user, destination, maxDepth: 2, maxChildren: 4, expiresAt: 90000 });
  const recipient = service.bindCaller({ ...claims, sessionId: 'child', ownerAgentId: 'child', scopeId: 'child', requestSource: 'agent' });
  const capability = service.issueDelegationWithApproval({ requestSource: 'agent', caller: parent, approval, recipient, observationIds: [], destination, expiresAt: 80000 });
  const child = service.bindDelegatedCaller({ capability, recipient });
  let session: AgentSessionState | undefined = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'child' });
  service.bindConsumerIncarnation(child, session); const weak = new WeakRef(session);
  service.inheritDelegatedArchivePolicies({ requestSource: 'user', caller: user, approval, capability, recipient: child });
  const capture = service.begin({ requestSource: 'agent', caller: child, invocationId: 'own', toolName: 'read', sourceAdapterId: 'fixture', sourceDescriptor: 'exact' });
  service.append({ requestSource: 'agent', caller: child, capture, text: 'immutable child output' });
  const ref = service.finalize({ requestSource: 'agent', caller: child, capture, executionState: 'terminal', outcome: 'success' });
  const returned = service.issueDelegationReturn({ requestSource: 'agent', caller: child, approval, recipient: parent, observationIds: [ref.id], destination, expiresAt: 70000 });
  service.attachDelegationReturn({ capability: returned, recipient: parent }); service.endConsumerExecution(child); session = undefined;
  if (!global.gc) throw Error('gc_not_enabled');
  for (let n = 0; n < 10; n++) { await new Promise<void>(resolve => setImmediate(resolve)); global.gc(); }
  const collected = weak.deref() === undefined;
  const readable = service.read({ caller: parent, id: ref.id, destination, offset: 0, maxBytes: 64 }).content === 'immutable child output';
  const rejects = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  const replacement = new AgentSessionState(); replacement.restoreSnapshot({ ...replacement.exportSnapshot(), sessionId: 'child' });
  const rebindDenied = rejects(() => service.bindConsumerIncarnation(child, replacement));
  const newCaptureDenied = rejects(() => service.begin({ requestSource: 'agent', caller: child, invocationId: 'late', toolName: 'read', sourceAdapterId: 'fixture', sourceDescriptor: 'exact' }));
  const newDelegationDenied = rejects(() => service.issueDelegationWithApproval({ requestSource: 'agent', caller: child, approval, recipient: parent, observationIds: [ref.id], destination, expiresAt: 60000 }));
  service.revokePolicy({ requestSource: 'user', caller: user, policyId: 'p' });
  const revocationDenied = rejects(() => service.read({ caller: parent, id: ref.id, destination, offset: 0, maxBytes: 64 }));
  process.stdout.write(JSON.stringify({ collected, readable, rebindDenied, newCaptureDenied, newDelegationDenied, revocationDenied }));
} finally { service.dispose(); rmSync(root, { recursive: true, force: true }); }
