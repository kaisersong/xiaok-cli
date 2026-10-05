import * as AgentModule from '../../../src/ai/agent.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner, createObservationReadTool, getObservationSessionOwnerHostBinding,capturePublishedClosureRead,getPublishedClosureReadBinding,restorePublishedClosureRead } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { createDelegatedObservationSessionOwner, assertDelegatedObservationOwner, getDelegatedObservationHandoff, createDelegatedObservationExecutionPlan, consumeDelegatedObservationExecutionPlan, suspendDelegatedObservationOwner, assertDelegatedObservationPaused, resumeDelegatedObservationOwner, publishDelegatedObservationResult } from '../../../src/runtime/sol-pi/delegated-session-owner.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { PermissionManager } from '../../../src/ai/permissions/manager.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { withObservationExecutionOwner, resolveObservationProviderDisclosure } from '../../../src/runtime/sol-pi/observation-execution-scope.js';
import { createProviderDisclosureFetch } from '../../../src/runtime/sol-pi/provider-disclosure.js';
import { isTransportAuthorizationError } from '../../../src/runtime/sol-pi/transport-lease.js';
import { createNamedSubAgentSession } from '../../../src/ai/agents/subagent-executor.js';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { createFullSendCounter } from '../../../src/runtime/sol-pi/full-send-counter.js';
import { createProfileDisclosureLedger, getProfileDisclosureAccountBinding } from '../../../src/runtime/sol-pi/profile-disclosure-ledger.js';
const destination = { provider: 'fixture', model: 'fixture', url: 'https://example.test/v1/chat/completions' };
const cleanups: (() => void)[] = [];
afterEach(() => { vi.unstubAllGlobals(); cleanups.splice(0).reverse().forEach(fn => fn()); });
async function fixture(sharedLedger = false, captureBody = 'protected child context', emptyParent = false) {
  const root = mkdtempSync(join(tmpdir(), 'delegated-owner-'));
  cleanups.push(() => rmSync(root, { force: true, recursive: true }));
  const service = createObservationService({ profileRoot: join(root, 'profile'), profileId: 'p', ...(sharedLedger ? { reservedProfileBytes: 4 * 1024 * 1024 } : {}), redactor: { version: 'test', redact: text => text } });
  cleanups.push(() => service.dispose());
  const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'parent' });
  const childSession = new AgentSessionState(); childSession.restoreSnapshot({ ...childSession.exportSnapshot(), sessionId: 'child' });
  const claims = { sessionId: 'parent', ownerAgentId: 'parent', scopeId: 'scope', permissionGeneration: 1, surface: 'ordinary-owner' as const };
  const user = service.bindCaller({ ...claims, requestSource: 'user' });
  const caller = service.bindCaller({ ...claims, requestSource: 'agent' });
  const recipient = service.bindCaller({ ...claims, sessionId: 'child', ownerAgentId: 'child', requestSource: 'agent' });
  service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 'scope', sourceAdapterId: 'native.bash.v1', sourceDescriptors: [JSON.stringify({ toolName: 'bash', command: 'fixture', workdir: root })], expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: false, destinations: [destination] } });
  const store = new FileSessionStore(join(root, 'sessions')); const capacityProfile = testOnlyCapacity(destination.url, destination.model);
  const sourceCounter = sharedLedger ? createFullSendCounter({ root: join(root, 'profile', 'shared-counter'), sessionId: 'parent' }) : undefined;
  if (sourceCounter) cleanups.push(() => sourceCounter.dispose());
  const disclosureLedger = sourceCounter ? createProfileDisclosureLedger({ service, counter: sourceCounter }) : undefined;
  if (disclosureLedger) cleanups.push(() => disclosureLedger.dispose());
  const parentAccount = disclosureLedger?.createAccount({ requestSource: 'user', caller, sessionId: 'parent', destination });
  const parentOwner = createObservationSessionOwner({ service, caller, session, destination, capacityProfile, fullSendCounter: parentAccount, persist: snapshot => store.save(snapshot) });
  cleanups.push(() => parentOwner.dispose());
  let preview = '';
  if (!emptyParent) {
    const capture = parentOwner.collectorFor('capture').begin({ toolName: 'bash', source: { command: 'fixture', workdir: root } });
    capture.append(captureBody); capture.finalize({ executionState: 'terminal', outcome: 'success' });
    preview = await parentOwner.projectToolResult('capture', captureBody);
  }
  const ids = session.getProtectedObservationClosure()?.observations.map(ref => ref.observationId) ?? [];
  const approval = emptyParent ? service.approveDelegation({ requestSource: 'user', caller: user, destination, maxDepth: 2, maxChildren: 4, expiresAt: Date.now() + 40000 }) : undefined;
  const capability = approval ? service.issueDelegationWithApproval({ requestSource: 'agent', caller, approval, recipient, observationIds: ids, destination, expiresAt: Date.now() + 30000 })
    : service.issueDelegation({ requestSource: 'user', caller: user, recipient, observationIds: ids, destination, expiresAt: Date.now() + 30000 });
  const permissions = new PermissionManager({ mode: 'auto' });
  const registry = new ToolRegistry({ permissionManager: permissions }, []); cleanups.push(() => registry.dispose());
  const persist = vi.fn(async snapshot => store.save(snapshot));
  const options = { parentOwner, service, capability, recipient, session: childSession, registry, destination, capacityProfile, persist, disclosureLedger, ...(approval ? { captureApproval: { approval, approver: user } } : {}) };
  return { root, service, parentOwner, session, childSession, registry, permissions, store, persist, options, ids, user, capability, approval, parentAccount, sourceCounter, preview };
}
it('publishes the whole parent closure and consumer pin durably before returning a usable branded owner', async () => {
  const f = await fixture();
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  expect(() => assertDelegatedObservationOwner(owner, f.childSession, f.registry)).not.toThrow();
  expect(await owner.read(f.ids[0], 0, 64)).toContain('protected child context');
  expect(f.childSession.getProtectedObservationClosure()).toEqual(f.session.getProtectedObservationClosure());
  const saved = await f.store.load('child'); expect(saved?.protectedObservationClosure).toEqual(f.session.getProtectedObservationClosure());
  const index = JSON.parse(readFileSync(join(f.root, 'profile', 'observations', `${f.ids[0]}.json`), 'utf8'));
  expect(index.pins).toContain('session:parent'); expect(index.pins).toContain('session:child'); expect(index.claims.sessionId).toBe('parent');
  expect(() => assertDelegatedObservationOwner(owner, new AgentSessionState(), f.registry)).toThrow();
  expect(() => assertDelegatedObservationOwner(owner, f.childSession, {} as ToolRegistry)).toThrow();
  expect(() => assertDelegatedObservationOwner(f.parentOwner, f.session, f.registry)).toThrow();
});
it('rejects failed durable publication and keeps its protective source pin', async () => {
  const f = await fixture();
  await expect(createDelegatedObservationSessionOwner({ ...f.options, persist: async () => { throw new Error('disk unavailable'); } })).rejects.toThrow();
  const index = JSON.parse(readFileSync(join(f.root, 'profile', 'observations', `${f.ids[0]}.json`), 'utf8'));
  expect(index.pins).toContain('session:child');
});
it('rejects forged parent, consumer identity drift, and grant destination drift', async () => {
  const f = await fixture();
  await expect(createDelegatedObservationSessionOwner({ ...f.options, parentOwner: {} as typeof f.parentOwner })).rejects.toThrow();
  const wrong = new AgentSessionState(); wrong.restoreSnapshot({ ...wrong.exportSnapshot(), sessionId: 'wrong' });
  await expect(createDelegatedObservationSessionOwner({ ...f.options, session: wrong })).rejects.toThrow();
  await expect(createDelegatedObservationSessionOwner({ ...f.options, destination: { ...destination, model: 'changed' } })).rejects.toThrow();
});
it('cannot keep its brand usable after the parent revokes the grant', async () => {
  const f = await fixture(); const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  f.service.revokeDelegation({ requestSource: 'user', caller: f.user, capability: f.capability });
  try { assertDelegatedObservationOwner(owner, f.childSession, f.registry); throw new Error('expected rejection'); }
  catch (error) { expect(isTransportAuthorizationError(error)).toBe(true); }
  await expect(owner.read(f.ids[0], 0, 64)).rejects.toThrow();
});

it('permits only its host-bound parent to enter the delegated async scope and freezes its source view', async () => {
  const f = await fixture();
  f.session.appendUserText('original handoff');
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  f.session.appendUserText('later parent input');
  expect(JSON.stringify(getDelegatedObservationHandoff(owner))).toContain('original handoff');
  expect(JSON.stringify(getDelegatedObservationHandoff(owner))).not.toContain('later parent input');
  await withObservationExecutionOwner(f.parentOwner, async () => {
    const parentContext = resolveObservationProviderDisclosure();
    await withObservationExecutionOwner(owner, async () => {
      await Promise.resolve();
      expect(resolveObservationProviderDisclosure()).toBeDefined();
      expect(() => resolveObservationProviderDisclosure(parentContext)).toThrow();
    });
    expect(f.parentOwner.ownsDisclosure(resolveObservationProviderDisclosure()!)).toBe(true);
  });
  const other = await fixture();
  expect(() => withObservationExecutionOwner(other.parentOwner, () => withObservationExecutionOwner(owner, () => {}))).toThrow();
});

it('does not publish a parent view whose sticky closure exceeds the grant', async () => {
  const f = await fixture();
  const capture = f.parentOwner.collectorFor('second').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
  capture.append('second protected source'); capture.finalize({ executionState: 'terminal', outcome: 'success' });
  await f.parentOwner.projectToolResult('second', 'second protected source');
  await expect(createDelegatedObservationSessionOwner(f.options)).rejects.toThrow();
  expect(f.persist).not.toHaveBeenCalled();
});
it('rechecks revocation after the awaited consumer persistence barrier', async () => {
  const f = await fixture();
  await expect(createDelegatedObservationSessionOwner({ ...f.options, persist: async snapshot => {
    await f.store.save(snapshot);
    f.service.revokeDelegation({ requestSource: 'user', caller: f.user, capability: f.capability });
  } })).rejects.toThrow();
  expect((await f.store.load('child'))?.protectedObservationClosure).toBeDefined();
});

it('runs actual CLI child Runtime, owner recall tool and OpenAI SDK fetch with the approved consumer', async () => {
  const f = await fixture(); const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  f.registry.registerTool(createObservationReadTool(owner));
  const bodies: string[] = [];
  const raw = vi.fn(async (_input: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body)); expect(init?.redirect).toBe('error');
    expect((await f.store.load('child'))?.protectedObservationClosure).toBeDefined();
    const delta = bodies.length === 1 ? { tool_calls: [{ index: 0, id: 'child-recall', type: 'function', function: { name: 'observation_read', arguments: JSON.stringify({ id: f.ids[0], offset: 0, maxBytes: 64 }) } }] } : { content: 'child completed' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }); vi.stubGlobal('fetch', raw);
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  const runtime = new AgentRuntime({ session: f.childSession, registry: f.registry, adapter, controller: new AgentRunController(),
    systemPrompt: 'test-only', providerSurfaceKind: 'cli-subagent', observationOwner: owner, maxIterations: 3 });
  await withObservationExecutionOwner(f.parentOwner, () => runtime.run('recall granted evidence', () => {}));
  expect(raw).toHaveBeenCalledTimes(2); expect(bodies[1]).toContain('protected child context');
  expect(JSON.stringify(f.childSession.getMessages())).toContain('child completed');
});

it('shares the real source ledger with the child without another directory or reservation', async () => {
  const f = await fixture(true);
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const binding = getObservationSessionOwnerHostBinding(owner);
  const account = binding.counter!;
  expect(getProfileDisclosureAccountBinding(account, f.service, 'child')?.sourceCounter).toBe(f.sourceCounter);
  const attempt = { logicalInvocationId: 'parent-full', serializedBody: '{"model":"fixture"}', observationIds: [f.ids[0]] };
  f.parentAccount!.prepare(attempt); f.parentAccount!.confirm(attempt);
  expect(account.read(f.ids[0])).toBe(1);
  account.prepare({ ...attempt, logicalInvocationId: 'child-full' }); account.confirm({ ...attempt, logicalInvocationId: 'child-full' });
  expect(f.parentAccount!.read(f.ids[0])).toBe(2);
  expect(account.getStorageReservation().root).toBe(f.parentAccount!.getStorageReservation().root);
});

it('does not reset the native full-send count when an exact parent tool result is handed to a real child SDK request', async () => {
  const f = await fixture(true, 'prefix' + 'x'.repeat(7000) + 'SHARED_SOURCE_MIDDLE' + 'y'.repeat(7000));
  const provenance = f.parentOwner.getResultProvenance('capture')!;
  const final = f.preview + '\nPOLICY_SUFFIX_KEEP'; provenance.appendSuffix('\nPOLICY_SUFFIX_KEEP'); provenance.sealRegistry(final);
  expect(f.parentOwner.finalizeToolResult('capture', final)).toBeDefined();
  f.session.appendAssistantBlocks([{ type: 'tool_use', id: 'capture', name: 'bash', input: { command: 'fixture' } }]);
  f.session.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'capture', content: final }]);
  const parentRegistry = new ToolRegistry({ autoMode: true }, [createObservationReadTool(f.parentOwner)]); cleanups.push(() => parentRegistry.dispose());
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }));
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  const parentRuntime = new AgentRuntime({ session: f.session, registry: parentRegistry, adapter, controller: new AgentRunController(), systemPrompt: 'test', observationOwner: f.parentOwner });
  await parentRuntime.run('first full', () => {});
  expect(f.parentAccount!.read(f.ids[0])).toBe(1);
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  f.childSession.replaceMessages(getDelegatedObservationHandoff(owner).messages);
  f.registry.registerTool(createObservationReadTool(owner));
  const childRuntime = new AgentRuntime({ session: f.childSession, registry: f.registry, adapter, controller: new AgentRunController(), systemPrompt: 'test', observationOwner: owner, providerSurfaceKind: 'cli-subagent' });
  await withObservationExecutionOwner(f.parentOwner, () => childRuntime.run('second shared full', () => {}));
  await withObservationExecutionOwner(f.parentOwner, () => childRuntime.run('use shared references', () => {}));
  expect(bodies).toHaveLength(3); expect(bodies[0]).toContain('SHARED_SOURCE_MIDDLE'); expect(bodies[1]).toContain('SHARED_SOURCE_MIDDLE');
  expect(bodies[2]).not.toContain('SHARED_SOURCE_MIDDLE');
  for (const body of bodies) expect(body).toContain('POLICY_SUFFIX_KEEP');
  expect(f.parentAccount!.read(f.ids[0])).toBe(2);
});

it('revokes descendant actual transport and reads synchronously when the parent restores its session incarnation', async () => {
  const f = await fixture();
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  let actualSignal: AbortSignal | undefined;
  const raw = vi.fn(async (_input: unknown, init?: RequestInit) => {
    actualSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream({ start() {} }));
  });
  const guarded = createProviderDisclosureFetch(owner.prepareProviderDisclosure()!, raw as typeof fetch);
  const body = JSON.stringify({ model: destination.model, messages: [{ role: 'user', content: 'synthetic' }] });
  const response = await guarded(destination.url, { method: 'POST', body });
  expect(actualSignal?.aborted).toBe(false);
  f.session.restoreSnapshot(f.session.exportSnapshot());
  expect(actualSignal?.aborted).toBe(true);
  await expect(owner.read(f.ids[0], 0, 64)).rejects.toThrow();
  await expect(guarded(destination.url, { method: 'POST', body })).rejects.toThrow();
  expect(raw).toHaveBeenCalledTimes(1);
  await expect(response.body!.cancel()).rejects.toThrow();
});

it('cannot rebind the same caller generation to a replacement session object with the same id', async () => {
  const f = await fixture();
  const replacement = new AgentSessionState(); replacement.restoreSnapshot(f.session.exportSnapshot());
  const binding = getObservationSessionOwnerHostBinding(f.parentOwner);
  expect(() => f.service.bindConsumerIncarnation(binding.caller, replacement)).toThrow();
  expect(() => f.service.bindConsumerIncarnation(binding.caller, f.session)).not.toThrow();
});

it('revokes prepared descendant transport when its parent owner is disposed without denying host endSession', async () => {
  const f = await fixture();
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const raw = vi.fn(async () => new Response('ok'));
  const guarded = createProviderDisclosureFetch(owner.prepareProviderDisclosure()!, raw as typeof fetch);
  f.parentOwner.dispose();
  await expect(guarded(destination.url, { method: 'POST', body: JSON.stringify({ model: destination.model, messages: [] }) })).rejects.toThrow();
  expect(raw).not.toHaveBeenCalled();
  expect(() => f.service.endSession({ requestSource: 'user', caller: f.user })).not.toThrow();
});

it('uses the actual named CLI child executor with a single-use host plan and independent durable session', async () => {
  const f = await fixture(true);
  const { registry: _registry, ...planOptions } = f.options;
  const bindRegistry = vi.fn(async (_registry: ToolRegistry) => {});
  const disposeExecution = vi.fn(async () => {});
  const installChildExecution = vi.fn(async () => ({ dispose: disposeExecution, bindRegistry }));
  const plan = createDelegatedObservationExecutionPlan({ ...planOptions, installChildExecution });
  const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body));
    expect((await f.store.load('child'))?.protectedObservationClosure).toBeDefined();
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'named child completed' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }));
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  const options = { agentDef: { name: 'delegated', systemPrompt: 'child', maxIterations: 2 }, sessionId: 'parent', cwd: f.root,
    adapter: () => adapter, createRegistry: () => { const registry = new ToolRegistry({ permissionManager: f.permissions }, []); cleanups.push(() => registry.dispose()); return registry; }, buildSystemPrompt: async () => 'synthetic test', observationExecutionPlan: plan };
  const child = await withObservationExecutionOwner(f.parentOwner, () => createNamedSubAgentSession(options));
  await expect(withObservationExecutionOwner(f.parentOwner, () => child.run('complete synthetic task'))).resolves.toContain('named child completed');
  expect(installChildExecution).toHaveBeenCalledOnce();
  expect(bodies).toHaveLength(1); expect(f.childSession.exportSnapshot().sessionId).toBe('child');
  await child.suspend();
  await expect(withObservationExecutionOwner(f.parentOwner, () => child.run('continue without replay'))).resolves.toContain('named child completed');
  expect(bindRegistry).toHaveBeenCalledOnce();
  expect(bodies).toHaveLength(2);
  await child.suspend(); bindRegistry.mockRejectedValueOnce(new Error('new registry install denied'));
  await expect(withObservationExecutionOwner(f.parentOwner, () => child.run('must not dispatch'))).rejects.toThrow();
  expect(bodies).toHaveLength(2);
  await child.dispose();
  expect(disposeExecution).toHaveBeenCalledOnce();
  await expect(createNamedSubAgentSession(options)).rejects.toThrow();
});

it('awaits child execution installation and rejects a failed installation before exposing its owner', async () => {
  const f = await fixture(); const { registry, ...options } = f.options;
  let captured: ReturnType<typeof createObservationSessionOwner> | undefined;
  const installChildExecution = vi.fn(async ({ owner }: { owner: ReturnType<typeof createObservationSessionOwner> }) => {
    captured = owner; throw new Error('actual installation denied');
  });
  const plan = createDelegatedObservationExecutionPlan({ ...options, installChildExecution });
  await expect(consumeDelegatedObservationExecutionPlan(plan, registry)).rejects.toThrow('actual installation denied');
  expect(installChildExecution).toHaveBeenCalledOnce();
  expect(() => captured!.getMode()).toThrow();
});

it('rejects counterfeit child plans and stale parent material before creating a consumer', async () => {
  const f = await fixture();
  await expect(consumeDelegatedObservationExecutionPlan({ ...f.options }, f.registry)).rejects.toThrow();
  const { registry: _registry, ...options } = f.options;
  const plan = createDelegatedObservationExecutionPlan(options);
  f.session.appendUserText('different task material');
  await expect(consumeDelegatedObservationExecutionPlan(plan, f.registry)).rejects.toThrow();
  expect(f.persist).not.toHaveBeenCalled();
});

it('fences old disclosure contexts before a live registry rotation and rejects ticket replay', async () => {
  const f = await fixture(); const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const oldContext = owner.prepareProviderDisclosure();
  const ticket = await suspendDelegatedObservationOwner(owner, f.registry);
  const raw = vi.fn(async () => new Response('ok'));
  await expect(createProviderDisclosureFetch(oldContext!, raw as typeof fetch)(destination.url, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [] }) })).rejects.toThrow();
  expect(() => owner.prepareProviderDisclosure()).toThrow();
  expect(() => resumeDelegatedObservationOwner({}, f.registry)).toThrow();
  const next = new ToolRegistry({ permissionManager: f.permissions }, []); cleanups.push(() => next.dispose());
  resumeDelegatedObservationOwner(ticket, next);
  expect(() => assertDelegatedObservationOwner(owner, f.childSession, f.registry)).toThrow();
  expect(() => owner.prepareProviderDisclosure()).not.toThrow();
  expect(() => resumeDelegatedObservationOwner(ticket, f.registry)).toThrow();
  expect(raw).not.toHaveBeenCalled();
});

it('checks the original unused rotation ticket against actual paused transport facts', async()=>{
  const f=await fixture();const owner=await createDelegatedObservationSessionOwner(f.options);cleanups.push(()=>owner.dispose());
  const ticket=await suspendDelegatedObservationOwner(owner,f.registry);
  expect(()=>assertDelegatedObservationPaused(owner,ticket)).not.toThrow();
  expect(()=>assertDelegatedObservationPaused(owner,{...ticket})).toThrow();
  expect(()=>assertDelegatedObservationPaused(f.parentOwner,ticket)).toThrow();
  getObservationSessionOwnerHostBinding(owner).resumeTransport();
  expect(()=>assertDelegatedObservationPaused(owner,ticket),'an unused ticket alone is not proof that transport is still paused').toThrow();
});

it.each(['different-authority', 'changed-revision', 'parent-disposed', 'parent-restored', 'grant-revoked'] as const)('rejects a live rotation ticket after %s', async change => {
  const f = await fixture(); const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const ticket = await suspendDelegatedObservationOwner(owner, f.registry);
  if (change === 'changed-revision') { f.permissions.setMode('default'); f.permissions.setMode('auto'); }
  if (change === 'parent-disposed') f.parentOwner.dispose();
  if (change === 'parent-restored') f.session.restoreSnapshot(f.session.exportSnapshot());
  if (change === 'grant-revoked') f.service.revokeDelegation({ requestSource: 'user', caller: f.user, capability: f.capability });
  const next = new ToolRegistry({ permissionManager: change === 'different-authority' ? new PermissionManager({ mode: 'auto' }) : f.permissions }, []);
  cleanups.push(() => next.dispose());
  expect(() => resumeDelegatedObservationOwner(ticket, next)).toThrow();
  expect(() => owner.prepareProviderDisclosure()).toThrow();
});

it('aborts an actual child transport when its live registry permission epoch changes', async () => {
  const f = await fixture(); const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  let signal: AbortSignal | undefined;
  const guarded = createProviderDisclosureFetch(owner.prepareProviderDisclosure()!, (async (_url, init) => {
    signal = init?.signal ?? undefined; return new Response(new ReadableStream({ start() {} }));
  }) as typeof fetch);
  const response = await guarded(destination.url, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [] }) });
  f.permissions.setMode('plan');
  expect(signal?.aborted).toBe(true);
  await expect(response.body!.cancel()).rejects.toThrow();
  expect(() => owner.prepareProviderDisclosure()).toThrow();
});

it('creates an authorized fresh child before any parent archive and captures its own native observation without changing source identity', async () => {
  const f = await fixture(true, '', true);
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const capture = owner.collectorFor('child-native').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
  capture.append('new child native result'); capture.finalize({ executionState: 'terminal', outcome: 'success' });
  expect(await owner.projectToolResult('child-native', 'new child native result')).toContain('new child native result');
  const closure = f.childSession.getProtectedObservationClosure()!;
  expect(closure.observations).toHaveLength(1); expect(closure.observations[0].sourceSessionId).toBe('child');
  expect(f.sourceCounter!.read(closure.observations[0].observationId)).toBe(0);
});
it('keeps an independently granted return readable after creator shutdown but fences all creator execution', async () => {
  const f = await fixture(true, '', true);
  const owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const capture = owner.collectorFor('finished-child').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
  capture.append('finished immutable result'); capture.finalize({ executionState: 'terminal', outcome: 'success' });
  await owner.projectToolResult('finished-child', 'finished immutable result');
  const id = f.childSession.getProtectedObservationClosure()!.observations[0].observationId;
  const child = getObservationSessionOwnerHostBinding(owner), parent = getObservationSessionOwnerHostBinding(f.parentOwner);
  const returned = f.service.issueDelegationReturn({ requestSource: 'agent', caller: child.caller, approval: f.approval!, recipient: parent.caller,
    observationIds: [id], destination, expiresAt: Date.now() + 10000 });
  f.service.attachDelegationReturn({ capability: returned, recipient: parent.caller });
  owner.dispose();
  expect(f.service.read({ caller: parent.caller, id, destination, offset: 0, maxBytes: 64 }).content).toBe('finished immutable result');
  expect(() => f.service.read({ caller: child.caller, id, destination, offset: 0, maxBytes: 64 })).toThrow();
  expect(() => f.service.begin({ requestSource: 'agent', caller: child.caller, invocationId: 'late', toolName: 'bash', sourceAdapterId: 'native.bash.v1', sourceDescriptor: JSON.stringify({ toolName: 'bash', command: 'fixture', workdir: f.root }) })).toThrow();
  expect(() => f.service.bindConsumerIncarnation(child.caller, f.childSession)).toThrow();
});

it('unions the actual child closure before a derived result and requires the real parent history persistence barrier', async () => {
  const f = await fixture(true, '', true), owner = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => owner.dispose());
  const capture = owner.collectorFor('returned-native').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
  capture.append('child complete native result'); capture.finalize({ executionState: 'terminal', outcome: 'success' });
  await owner.projectToolResult('returned-native', 'child complete native result');
  const result = await publishDelegatedObservationResult(owner, 'derived child answer', f.approval);
  expect(result).toBe('derived child answer');
  expect(f.session.getProtectedObservationClosure()).toEqual(f.childSession.getProtectedObservationClosure());
  expect(() => f.parentOwner.prepareProviderDisclosure()).toThrow();
  f.session.appendAssistantBlocks([{ type: 'tool_use', id: 'actual-child-call', name: 'subagent', input: {} }]);
  f.session.appendUserToolResults([{ type: 'tool_result', tool_use_id: 'actual-child-call', content: result }]);
  await f.parentOwner.publishCurrentHistory!({ strictPrivateProtocol: false });
  const saved = await f.store.load('parent'); expect(JSON.stringify(saved?.messages)).toContain('derived child answer');
  expect(saved?.protectedObservationClosure).toEqual(f.childSession.getProtectedObservationClosure());
  owner.dispose();
  const raw = vi.fn(async () => new Response('ok'));
  const fetch = createProviderDisclosureFetch(f.parentOwner.prepareProviderDisclosure()!, raw as typeof globalThis.fetch);
  const response = await fetch(destination.url, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: result }] }) });
  await response.text(); expect(raw).toHaveBeenCalledTimes(1);
});

it.each([false, true])('persists actual Runtime returned tool batch before SDK continuation (save failure=%s)', async failSave => {
  const f = await fixture(true, '', true), child = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => child.dispose());
  const originalSave = f.store.save.bind(f.store);
  vi.spyOn(f.store, 'save').mockImplementation(async snapshot => {
    if (failSave && snapshot.sessionId === 'parent' && JSON.stringify(snapshot.messages).includes('ACTUAL_DERIVED_CHILD_RESULT')) throw Error('test durable write failed');
    return originalSave(snapshot);
  });
  const registry = new ToolRegistry({ autoMode: true }, [{
    definition: { name: 'child_fixture', description: 'Trusted test host child execution', inputSchema: { type: 'object', properties: {} } }, permission: 'safe',
    async execute() {
      const capture = child.collectorFor('actual-return-native').begin({ toolName: 'bash', source: { command: 'fixture', workdir: f.root } });
      capture.append('actual child protected native bytes'); capture.finalize({ executionState: 'terminal', outcome: 'success' });
      await child.projectToolResult('actual-return-native', 'actual child protected native bytes');
      return publishDelegatedObservationResult(child, 'ACTUAL_DERIVED_CHILD_RESULT', f.approval);
    },
  }]); cleanups.push(() => registry.dispose());
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    calls++;
    if (calls === 2) {
      expect(String(init?.body)).toContain('ACTUAL_DERIVED_CHILD_RESULT');
      const saved = await f.store.load('parent');
      expect(JSON.stringify(saved?.messages)).toContain('ACTUAL_DERIVED_CHILD_RESULT');
      expect(saved?.protectedObservationClosure).toEqual(f.childSession.getProtectedObservationClosure());
    }
    const delta = calls === 1 ? { tool_calls: [{ index: 0, id: 'actual-return-call', type: 'function', function: { name: 'child_fixture', arguments: '{}' } }] } : { content: 'done' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: calls === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }));
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  const runtime = new AgentRuntime({ session: f.session, registry, adapter, controller: new AgentRunController(), systemPrompt: 'test', observationOwner: f.parentOwner });
  const run = runtime.run('run actual child', () => {});
  if (failSave) await expect(run).rejects.toThrow(); else await run;
  expect(calls).toBe(failSave ? 1 : 2);
  expect(f.session.getProtectedObservationClosure()).toEqual(f.childSession.getProtectedObservationClosure());
  expect(JSON.stringify(f.session.getMessages()).match(/ACTUAL_DERIVED_CHILD_RESULT/g)).toHaveLength(1);
});

it('rejects a pre-created parent context while a returned history publication is pending', async () => {
  const f = await fixture(), child = await createDelegatedObservationSessionOwner(f.options); cleanups.push(() => child.dispose());
  const raw = vi.fn(async () => new Response('must not dispatch'));
  const guarded = createProviderDisclosureFetch(f.parentOwner.prepareProviderDisclosure()!, raw as typeof globalThis.fetch);
  await publishDelegatedObservationResult(child, 'derived same-source answer');
  await expect(guarded(destination.url, { method: 'POST', body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'derived same-source answer' }] }) })).rejects.toThrow();
  expect(raw).not.toHaveBeenCalled();
});

it('rejects a child registry exceeding its host-issued native tool ceiling before binding any grant', async () => {
  const f = await fixture(true, '', true);
  f.registry.registerTool({ definition: { name: 'bash', description: 'test host bash', inputSchema: {} }, permission: 'bash', async execute() { return ''; } });
  await expect(createDelegatedObservationSessionOwner({ ...f.options, allowedNativeToolNames: ['read'] } as any)).rejects.toThrow();
});

it.each(['pending', 'drain_failed', 'release_failed'] as const)('actual named worktree cleanup preserves drain ordering and owner cleanup: %s', async mode => {
  const f = await fixture(); const { registry: _registry, ...options } = f.options;
  let releaseDrain!: () => void;
  const drain = new Promise<void>(resolve => { releaseDrain = resolve; });
  const disposeExecution = vi.fn(async () => { if (mode === 'pending') await drain; if (mode === 'drain_failed') throw new Error('physical drain unknown'); });
  let childOwner: ReturnType<typeof createObservationSessionOwner> | undefined;
  const plan = createDelegatedObservationExecutionPlan({ ...options, installChildExecution: async ({ owner }) => {
    childOwner = owner; return { dispose: disposeExecution, bindRegistry: async () => {} };
  } });
  // Explicit allocation port fixture; this test asserts real named executor
  // sequencing, not Git isolation or OS physical quiescence qualification.
  const release = vi.fn(async () => { if (mode === 'release_failed') throw new Error('worktree release failed'); });
  const manager = { allocate: async () => ({ path: f.root, cleanup: 'delete' }), release } as any;
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}) }) });
  const child = await createNamedSubAgentSession({ agentDef: { name: 'isolated', systemPrompt: 'child', isolation: 'worktree', cleanup: 'delete' },
    sessionId: 'parent', cwd: f.root, adapter: () => adapter, worktreeManager: manager, createRegistry: () => f.registry,
    buildSystemPrompt: async () => 'synthetic', observationExecutionPlan: plan });
  const closing = child.dispose(); const outcome = closing.catch(error => error);
  try {
    if (mode === 'pending') {
      await vi.waitFor(() => expect(disposeExecution).toHaveBeenCalledOnce());
      expect(release).not.toHaveBeenCalled(); releaseDrain(); await closing; expect(release).toHaveBeenCalledOnce();
    } else {
      expect(await outcome).toBeInstanceOf(Error);
      expect(disposeExecution).toHaveBeenCalledOnce();
      if (mode === 'drain_failed') expect(release).not.toHaveBeenCalled();
      else expect(release).toHaveBeenCalledOnce();
    }
    expect(() => childOwner!.getMode()).toThrow();
  } finally { releaseDrain(); await outcome; }
});

it('installs one actual recall tool before the child execution classifier snapshots the registry',async()=>{
 const f=await fixture();const {registry,...options}=f.options;let classified:unknown;
 const plan=createDelegatedObservationExecutionPlan({...options,installChildExecution:async({registry:actual})=>{
  classified=actual.getRegisteredTool('observation_read');expect(classified).toBeDefined();
  return {dispose:async()=>{},bindRegistry:async next=>{expect(next.getRegisteredTool('observation_read')).toBe(classified);}};
 }});
 const child=await consumeDelegatedObservationExecutionPlan(plan,registry);
 try{expect(child.recallTool).toBe(classified);expect(registry.getRegisteredTool('observation_read')).toBe(classified);}
 finally{await child.execution?.dispose();child.owner.dispose();}
});

it('preserves fixed host turn hooks across the delegated installation wrapper and closes them on disposal',async()=>{
 const f=await fixture();const {registry,...options}=f.options;
 const prepare=vi.fn(async()=>{}),activate=vi.fn(async()=>{}),inputCheck=vi.fn(()=>{});
 const followupResult=Object.freeze({commitApplied:async()=>{},cancelBeforeApplied:async()=>{}}),followup=vi.fn(async()=>followupResult);
 const installed={dispose:vi.fn(async()=>{}),bindRegistry:async()=>{},prepareInitialTurn:prepare,activateInitialTurn:activate,assertTurnInput:inputCheck,prepareManagedFollowup:followup};
 const plan=createDelegatedObservationExecutionPlan({...options,installChildExecution:async()=>installed});
 const child=await consumeDelegatedObservationExecutionPlan(plan,registry);
 try{
  installed.prepareInitialTurn=vi.fn(async()=>{throw Error('replacement must not execute');});
  installed.activateInitialTurn=vi.fn(async()=>{throw Error('replacement must not execute');});
  await child.execution!.prepareInitialTurn!();await child.execution!.activateInitialTurn!();
  expect(prepare).toHaveBeenCalledOnce();expect(activate).toHaveBeenCalledOnce();
  child.execution!.assertTurnInput!();expect(inputCheck).toHaveBeenCalledOnce();
  expect(await child.execution!.prepareManagedFollowup!({preparation:{},pausedTicket:{}})).toBe(followupResult);
  await child.execution!.dispose();
  await expect(child.execution!.prepareInitialTurn!()).rejects.toThrow();
  await expect(child.execution!.activateInitialTurn!()).rejects.toThrow();
  await expect(child.execution!.prepareManagedFollowup!({preparation:{},pausedTicket:{}})).rejects.toThrow();
  expect(()=>child.execution!.assertTurnInput!()).toThrow();expect(followup).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledOnce();expect(activate).toHaveBeenCalledOnce();
 }finally{await child.execution?.dispose();child.owner.dispose();}
});

it('keeps an exact published read independent of later source history and rejects copied or revoked authority',async()=>{
 const f=await fixture(true,'',true),owner=await createDelegatedObservationSessionOwner(f.options);cleanups.push(()=>owner.dispose());
 const capture=owner.collectorFor('anchored-return').begin({toolName:'bash',source:{command:'fixture',workdir:f.root}});
 capture.append('anchored immutable archive');capture.finalize({executionState:'terminal',outcome:'success'});
 await owner.projectToolResult('anchored-return','anchored immutable archive');
 await publishDelegatedObservationResult(owner,'original published result',f.approval);
 const anchor=capturePublishedClosureRead(owner,f.parentOwner),binding=getPublishedClosureReadBinding(anchor),facts=binding.facts;
 f.childSession.appendAssistantBlocks([{type:'text',text:'later source iteration'}]);
 expect(()=>binding.validate()).not.toThrow();
 expect(()=>getPublishedClosureReadBinding({...anchor})).toThrow();
 expect(()=>restorePublishedClosureRead(owner,f.parentOwner,{...facts,recipientSessionId:'foreign'})).toThrow();
 const restored=restorePublishedClosureRead(owner,f.parentOwner,JSON.parse(JSON.stringify(facts)));
 expect(()=>getPublishedClosureReadBinding(restored).validate()).not.toThrow();
 f.service.revokeDelegation({requestSource:'user',caller:f.user,capability:f.capability});
 expect(()=>binding.validate()).toThrow();
 expect(()=>restorePublishedClosureRead(owner,f.parentOwner,facts)).toThrow();
});


it('disposal during successful actual named registry rebind never creates a replacement Agent', async () => {
  const f = await fixture(true); const { registry: _registry, ...planOptions } = f.options;
  let entered!: () => void, release!: () => void, releaseRegistry!: () => void; let closingPhase = false;
  const bindingEntered = new Promise<void>(resolve => { entered = resolve; });
  const bindingGate = new Promise<void>(resolve => { release = resolve; });
  const registryReleaseGate = new Promise<void>(resolve => { releaseRegistry = resolve; });
  const disposeExecution = vi.fn(async () => {});
  const bindRegistry = vi.fn(async () => { entered(); await bindingGate; });
  const plan = createDelegatedObservationExecutionPlan({ ...planOptions, installChildExecution: async () => ({ dispose: disposeExecution, bindRegistry }) });
  const ActualAgent = AgentModule.Agent; let constructors = 0;
  const spy = vi.spyOn(AgentModule, 'Agent').mockImplementation(function(...args: ConstructorParameters<typeof ActualAgent>) {
    constructors++; return new ActualAgent(...args);
  } as unknown as typeof ActualAgent);
  const fetch = vi.fn(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'actual named child completed' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const adapter = new OpenAIAdapter({ apiKey: 'test-only', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
    identity: { providerId: 'fixture', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'fixture', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}),
  }) });
  const child = await withObservationExecutionOwner(f.parentOwner, () => createNamedSubAgentSession({
    agentDef: { name: 'real-rebinding', systemPrompt: 'child', maxIterations: 2 }, sessionId: 'parent', cwd: f.root,
    adapter: () => adapter, createRegistry: () => { const registry = new ToolRegistry({ permissionManager: f.permissions }, []); cleanups.push(() => registry.dispose()); return registry; },
    buildSystemPrompt: async () => 'synthetic test', observationExecutionPlan: plan,
    releaseRegistry: async registry => { if (closingPhase) await registryReleaseGate; registry.dispose(); },
  }));
  let followup: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
  try {
    await withObservationExecutionOwner(f.parentOwner, () => child.run('complete first actual turn'));
    await child.suspend(); expect(constructors).toBe(1);
    followup = withObservationExecutionOwner(f.parentOwner, () => child.run('followup must not allocate after close')).catch(error => error);
    await bindingEntered; closingPhase = true; closing = child.dispose().catch(error => error); release();
    expect(await followup).toBeInstanceOf(Error); releaseRegistry(); await closing;
    expect(constructors).toBe(1); expect(fetch).toHaveBeenCalledTimes(1); expect(disposeExecution).toHaveBeenCalledOnce();
  } finally { release(); releaseRegistry(); await followup; await (closing ?? child.dispose().catch(error => error)); spy.mockRestore(); }
});
