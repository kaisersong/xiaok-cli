import { testOnlyCapacity } from '../../support/sol-pi-capacity.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentRuntime } from '../../../src/ai/runtime/agent-runtime.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { AgentRunController } from '../../../src/ai/runtime/controller.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { buildOpenAIHarnessContext, resolveKimiHarnessFeatureFlags } from '../../../src/ai/providers/model-harness-profile.js';
import { createObservationService } from '../../../src/runtime/sol-pi/observation-service.js';
import { createObservationSessionOwner, createObservationReadTool, describeObservationSource } from '../../../src/runtime/sol-pi/observation-session-owner.js';

function sse(tool?: { name: string; input: object; id: string }) {
  const delta = tool ? { tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] } : { content: 'verified tail' };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}

describe('real Runtime + registry + native collector + SDK transport + durable owner', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { vi.unstubAllGlobals(); for (const close of cleanup.splice(0).reverse()) close(); });
  async function run(tool: 'read' | 'bash', revoke = false, warning = '') {
    const root = mkdtempSync(join(tmpdir(), 'solpi-runtime-')); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const file = join(root, 'log.txt'); writeFileSync(file, 'x'.repeat(10000) + 'AUTHORIZED_TAIL');
    const command = "printf '%010000dAUTHORIZED_TAIL' 0";
    const session = new AgentSessionState(); session.restoreSnapshot({ ...session.exportSnapshot(), sessionId: 'runtime-owner', cwd: root });
    const service = createObservationService({ profileRoot: join(root, 'profile'), profileId: 'p', redactor: { version: 'test', redact: text => text } });
    cleanup.push(() => service.dispose());
    const claims = { sessionId: 'runtime-owner', ownerAgentId: 'a', scopeId: 's', permissionGeneration: 1, surface: 'ordinary-owner' as const };
    const caller = service.bindCaller({ ...claims, requestSource: 'agent' }); const user = service.bindCaller({ ...claims, requestSource: 'user' });
    const destination = { provider: 'test', model: 'model', url: 'https://example.test/v1/chat/completions' };
    const source = tool === 'read' ? { toolName: 'read' as const, source: { filePath: file, offset: 1 } }
      : { toolName: 'bash' as const, source: { command, workdir: root } };
    service.setArchivePolicy({ requestSource: 'user', caller: user, policy: { version: 1, id: 'p', revision: 1, scopeId: 's',
      sourceAdapterId: `native.${tool}.v1`, sourceDescriptors: [describeObservationSource(source)], expiresAt: Date.now() + 60000,
      localPersistence: true, allowUnclassifiedText: true, allowIncomplete: true, destinations: [destination] } });
    const store = new FileSessionStore(join(root, 'sessions'));
    const persist = vi.fn(async snapshot => { await store.save(snapshot); });
    const owner = createObservationSessionOwner({ service, caller, session, destination, persist, capacityProfile: testOnlyCapacity(destination.url, destination.model) }); cleanup.push(() => owner.dispose());
    const registry = new ToolRegistry({ autoMode: true, ...(warning ? { hooksRunner: { runPreHooks: async () => ({ ok: true }), runPostHooks: async () => [warning], runHooks: async () => ({ ok: true }) } } : {}) }, [createReadTool({ cwd: root }), bashTool, createObservationReadTool(owner)]);
    cleanup.push(() => registry.dispose());
    const execute = vi.spyOn(registry, 'executeTool'); const bodies: string[] = [];
    const raw = vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return sse({ name: tool, id: 'native-call', input: tool === 'read' ? { file_path: file, max_chars: 80 } : { command, workdir: root, max_chars: 80 } });
      expect(init?.redirect).toBe('error');
      expect(persist).toHaveBeenCalledOnce();
      const ref = session.getProtectedObservationClosure()!.observations[0];
      if (bodies.length === 2) {
        expect(bodies[1]).toContain(ref.observationId);
        if (revoke) {
          // The owner correctly rejects reentrant mutations inside admission.
          // Revoke after the fetch handoff, while the HTTP promise is in flight.
          await Promise.resolve();
          service.clear({ requestSource: 'user', caller: user, id: ref.observationId });
          return new Response('{}', { status: 500, headers: { 'retry-after-ms': '1' } });
        }
        return sse({ name: 'observation_read', id: 'recall-call', input: { id: ref.observationId, offset: 9500, maxBytes: 1024 } });
      }
      expect(bodies[2]).toContain('AUTHORIZED_TAIL'); return sse();
    }); vi.stubGlobal('fetch', raw);
    const adapter = new OpenAIAdapter({ apiKey: 'test', kimiCodingHeadersApplied: false, harnessContext: buildOpenAIHarnessContext({
      identity: { providerId: 'test', providerType: 'custom', protocol: 'openai_legacy', canonicalBaseUrl: 'https://example.test/v1', wireModel: 'model', capabilities: ['tools'] },
      flags: resolveKimiHarnessFeatureFlags({}),
    }) });
    const runtime = new AgentRuntime({ adapter, registry, session, controller: new AgentRunController(), systemPrompt: 'test', maxIterations: 5, observationOwner: owner });
    if (revoke) await expect(runtime.run('read evidence', () => {})).rejects.toThrow(/AUTHORIZATION/);
    else await runtime.run('read evidence and recall tail', () => {});
    return { bodies, raw, execute, session, owner };
  }
  it.each(['read', 'bash'] as const)('archives actual %s pre-cap output and recalls tail through actual model tool rounds', async tool => {
    const result = await run(tool);
    expect(result.raw).toHaveBeenCalledTimes(3);
    expect(result.execute.mock.calls.map(call => call[0])).toEqual([tool, 'observation_read']);
    expect(JSON.stringify(result.session.getMessages())).toContain('AUTHORIZED_TAIL');
    expect(result.owner.getFinalizedToolResult('native-call')).toBeDefined();
    expect(result.owner.getFinalizedToolResult('recall-call')).toBeUndefined();
  }, 15000);
  it('runtime final cap invalidates an otherwise intact native prefix when policy warning is cut', async () => {
    const result = await run('read', false, 'policy'.repeat(60000));
    expect(result.execute.mock.calls.map(call => call[0])).toEqual(['read', 'observation_read']);
    expect(result.owner.getFinalizedToolResult('native-call')).toBeUndefined();
    expect(JSON.stringify(result.session.getMessages())).toContain('observation');
  }, 15000);
  it('revocation in actual SDK transport blocks retry without re-executing completed native read', async () => {
    const result = await run('read', true);
    expect(result.raw).toHaveBeenCalledTimes(2); expect(result.execute).toHaveBeenCalledOnce();
  }, 15000);
});
