import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner, createObservationReadTool, composeCompoundObservationResult, describeObservationSource } from '../../../src/runtime/sol-pi/observation-session-owner.js';
import { createFullSendCounter } from '../../../src/runtime/sol-pi/full-send-counter.js';
import { createTestOnlyCapacityProfile } from '../../../src/runtime/sol-pi/capacity-admission.js';
import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
function sse(tool: string | false = false, twoReads = false) {
  const delta = tool ? { tool_calls: (twoReads ? ['native-one', 'native-two'] : ['native-one']).map((id, index) => ({ index, id, type: 'function', function: { name: 'read', arguments: JSON.stringify({ file_path: tool, max_chars: 80 }) } })) } : { content: 'done' };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('P1B pre-open projection through actual Runtime, shared builder and SDK fetch', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { vi.unstubAllGlobals(); for (const close of cleanup.splice(0).reverse()) close(); });
  function fixture(retryFull = false, reservation = 4 * 1024 * 1024, longSystem = false, twoReads = false, counterSession = 'projection-session') {
    const root = mkdtempSync(join(tmpdir(), 'solpi-projection-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'log.txt'); writeFileSync(file, 'x'.repeat(7000) + 'ARCHIVED_MIDDLE_SENTINEL' + 'y'.repeat(7000));
    const profileRoot = join(root, 'profile');
    const service = createObservationService({ profileRoot, profileId: 'p', reservedProfileBytes: reservation, redactor: { version: 'v', redact: text => text } }); cleanup.push(() => service.dispose());
    const counter = createFullSendCounter({ root: join(profileRoot, 'counter'), sessionId: counterSession }); cleanup.push(() => counter.dispose());
    const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'projection-session', cwd: root });
    const claims = { sessionId: 'projection-session', ownerAgentId: 'a', scopeId: 's', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const caller = service.bindCaller({ ...claims, requestSource: 'agent' }), user = service.bindCaller({ ...claims, requestSource: 'user' });
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/v1/chat/completions' };
    service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 's', sourceAdapterId: 'native.read.v1',
      sourceDescriptors: [describeObservationSource({ toolName: 'read', source: { filePath: file, offset: 1 } })], expiresAt: Date.now() + 60000, localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
    const store = new FileSessionStore(join(root, 'sessions'));
    const ownerOptions = { service, caller, session, destination, fullSendCounter: counter, capacityProfile: longSystem || twoReads ? createTestOnlyCapacityProfile({ destination: destination.url, model: destination.model, windowTokens: twoReads ? 35000 : 25000, outputLimitField: 'max_tokens', defaultOutputTokens: 8192, safetyMarginTokens: 1024, countSerializedInput: body => Buffer.byteLength(body) }) : testOnlyCapacity(destination.url, destination.model), persist: (snapshot: ReturnType<AgentSessionState['exportSnapshot']>) => store.save(snapshot) };
    const owner = createObservationSessionOwner(ownerOptions); cleanup.push(() => owner.dispose());
    const registry = new ToolRegistry({ autoMode: true, hookInputMode: 'direct-callback', hooksRunner: { runPreHooks: async () => ({ ok: true, additionalContext: 'HOST_POLICY_KEEP' }), runPostHooks: async () => [], runHooks: async () => ({ ok: true }) } }, [createReadTool({ cwd: root }), createObservationReadTool(owner)]); cleanup.push(() => registry.dispose());
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return sse(file, twoReads);
      if (retryFull && bodies.length === 2) return new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } });
      return sse();
    }));
    const adapter = new OpenAIAdapter({ apiKey: 'test', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({ identity: { providerId: 'test', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'model', capabilities: ['tools'] }, flags: resolveKimiHarnessFeatureFlags({}) }) });
    const runtime = new AgentRuntime({ adapter, registry, session, controller: new AgentRunController(), systemPrompt: 'SYSTEM_KEEP' + (longSystem ? 's'.repeat(10000) : ''), maxIterations: 5, observationOwner: owner });
    return { root, owner, runtime, session, bodies, counter, service, user, adapter, registry, ownerOptions };
  }
  it('sends authorized full archive twice then reference/head-tail, preserving durable history and hook context', async () => {
    const f = fixture(); await f.runtime.run('read', () => {}); await f.runtime.run('again', () => {}); await f.runtime.run('again', () => {});
    expect(f.bodies).toHaveLength(4); expect(f.bodies[1]).toContain('ARCHIVED_MIDDLE_SENTINEL'); expect(f.bodies[2]).toContain('ARCHIVED_MIDDLE_SENTINEL'); expect(f.bodies[3]).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    for (const body of f.bodies.slice(1)) { expect(body).toContain('HOST_POLICY_KEEP'); expect(body).toContain('SYSTEM_KEEP'); expect(body).toContain('observation_read'); }
    expect(JSON.stringify(f.session.getMessages())).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    const id = f.session.getProtectedObservationClosure()!.observations[0].observationId; expect(f.counter.read(id)).toBe(2);
    expect(f.owner.getProjectionDiagnostics()).toMatchObject({ projectedRequests: 3, fullObservationViews: 2, referenceObservationViews: 1, unknownFullObservationViews: 0 });
  });
  it('compound host edit facts survive the actual two-full-then-reference request sequence',async()=>{
    const f=fixture(),execute=f.registry.executeTool.bind(f.registry);
    vi.spyOn(f.registry,'executeTool').mockImplementation(async(name,input,context)=>{
      const native=await execute(name,input,context);
      return composeCompoundObservationResult(f.owner,context!.toolInvocationId!,'[compound edit=succeeded]\n',native,'\n[validation completed]');
    });
    await f.runtime.run('read',()=>{});await f.runtime.run('again',()=>{});await f.runtime.run('again',()=>{});
    expect(f.bodies).toHaveLength(4);expect(f.bodies[1]).toContain('ARCHIVED_MIDDLE_SENTINEL');expect(f.bodies[2]).toContain('ARCHIVED_MIDDLE_SENTINEL');expect(f.bodies[3]).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    for(const body of f.bodies.slice(1)){expect(body).toContain('compound edit=succeeded');expect(body).toContain('validation completed');expect(body).toContain('HOST_POLICY_KEEP');}
    expect(f.owner.getProjectionDiagnostics()).toMatchObject({fullObservationViews:2,referenceObservationViews:1});
  });
  it('SDK retry reuses identical projected bytes and preserves unknown count without tool replay', async () => {
    const f = fixture(true); await f.runtime.run('read', () => {}); expect(f.bodies).toHaveLength(3); expect(f.bodies[1]).toBe(f.bodies[2]);
    const id = f.session.getProtectedObservationClosure()!.observations[0].observationId; expect(f.counter.read(id)).toBeNull();
    await f.runtime.run('again', () => {}); expect(f.bodies[3]).toContain('ARCHIVED_MIDDLE_SENTINEL');
    expect(f.owner.getProjectionDiagnostics().unknownFullObservationViews).toBe(1);
  });
  it('budgets the real system/schema/history and chooses a bounded preview on first send', async () => {
    const f = fixture(false, 4 * 1024 * 1024, true); await f.runtime.run('read', () => {});
    expect(f.bodies[1]).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    expect(Buffer.byteLength(f.bodies[1]) + 8192 + 1024).toBeLessThanOrEqual(25000);
    expect(f.owner.getProjectionDiagnostics()).toMatchObject({ fullObservationViews: 0, referenceObservationViews: 1 });
  });
  it('missing shared preview keeps the protected capped path rather than dropping disclosure context', async () => {
    const f = fixture(); Object.defineProperty(f.adapter, 'getObservationRequestPreview', { value: undefined });
    await f.runtime.run('read', () => {}); expect(f.bodies[1]).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    expect(f.session.getProtectedObservationClosure()).toBeDefined(); expect(f.owner.getProjectionDiagnostics().projectedRequests).toBe(0);
  });
  it('revocation during preparation prevents another actual fetch without replaying the native tool', async () => {
    const f = fixture(); const original = f.adapter.getObservationRequestPreview.bind(f.adapter);
    vi.spyOn(f.adapter, 'getObservationRequestPreview').mockImplementation((...args) => {
      const ref = f.session.getProtectedObservationClosure()?.observations[0];
      if (ref) f.service.clear({ requestSource: 'user', caller: f.user, id: ref.observationId });
      return original(...args);
    });
    await expect(f.runtime.run('read', () => {})).rejects.toThrow(); expect(f.bodies).toHaveLength(1);
  });
  it('a same-name replacement recall tool does not qualify native projection', async () => {
    const f = fixture(); f.registry.registerTool({ permission: 'safe', definition: { name: 'observation_read', description: 'not the owner recall', inputSchema: {} }, execute: async () => 'not available' });
    await f.runtime.run('read', () => {}); expect(f.bodies[1]).not.toContain('ARCHIVED_MIDDLE_SENTINEL');
    expect(f.owner.getProjectionDiagnostics().reasons.recall_unavailable).toBeGreaterThan(0);
  });
  it('outer recovery builds a new logical view without counting an undispatched preparation or replaying read', async () => {
    const f = fixture(); const original = f.adapter.stream.bind(f.adapter); let opens = 0;
    vi.spyOn(f.adapter, 'stream').mockImplementation(async function* (...args) {
      if (opens++ === 1) throw new Error('ECONNRESET before SDK handoff');
      yield* original(...args);
    });
    await f.runtime.run('read', () => {}); expect(f.bodies).toHaveLength(2);
    const id = f.session.getProtectedObservationClosure()!.observations[0].observationId; expect(f.counter.read(id)).toBe(1);
    const ledger = JSON.parse(readFileSync(join(f.counter.getStorageReservation().root, 'full-send.json'), 'utf8'));
    expect(Object.keys(ledger.invocations)).toHaveLength(1); expect(Object.keys(ledger.invocations)[0]).toContain('recovery-1');
    expect(f.owner.getProjectionDiagnostics().projectedRequests).toBe(2);
  }, 10000);
  it('multiple native observations share one actual whole-request budget', async () => {
    const f = fixture(false, 4 * 1024 * 1024, false, true); await f.runtime.run('read', () => {});
    expect(f.session.getProtectedObservationClosure()!.observations).toHaveLength(2);
    expect(Buffer.byteLength(f.bodies[1]) + 8192 + 1024).toBeLessThanOrEqual(35000);
    expect(f.owner.getProjectionDiagnostics()).toMatchObject({ fullObservationViews: 1, referenceObservationViews: 1 });
  });
  it('does not allocate the same service counter reserve to a second live owner', () => {
    const f = fixture(); expect(() => createObservationSessionOwner(f.ownerOptions)).toThrow(/COUNTER|RESERV/);
  });
  it('rejects a different session ledger even when its directory and budget are valid', () => {
    expect(() => fixture(false, 4 * 1024 * 1024, false, false, 'other-session')).toThrow(/COUNTER|RESERV/);
  });
  it('rejects counter with no real reserved storage budget', () => { expect(() => fixture(false, 0)).toThrow(/COUNTER|RESERV/); });
});
