// @vitest-environment node
import { it, expect } from 'vitest';
import { registerComputerUseCapabilityReadonlyIpc, registerKswarmStatusReadonlyIpc } from '../../electron/runtime-status-readonly-typed-ipc.js';
import { registerSkillMutationIpc } from '../../electron/skill-mutation-typed-ipc.js';
import { registerChannelMcpMutationIpc } from '../../electron/channel-mcp-mutation-typed-ipc.js';
import { registerMeetingMutationIpc } from '../../electron/meeting-mutation-typed-ipc.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
type Case = { channel: string; args: unknown[]; value: unknown; error: string; meeting?: boolean; register(ipc: IpcHandleRegistrar, producer: IpcHandlerListener): void };
const channelValue = { id: 'owned', type: 'owned', name: 'Owned', enabled: true, createdAt: 1, updatedAt: 1 };
const mcpValue = { id: 'owned', name: 'Owned', source: 'local', command: 'owned', args: [], enabled: true, createdAt: 1 };
const asrValue = { defaultProvider: 'whisper', volcengine: { configured: false, appKeyConfigured: false, accessKeyConfigured: false, resourceId: 'owned' }, aliyun: { configured: false, apiKeyConfigured: false, baseUrl: 'https://owned.invalid', model: 'owned' } };
const modelValue = { ok: true, model: { id: 'owned', fileName: 'owned', sizeBytes: 1, sizeLabel: '1B', cacheDir: 'owned', path: 'owned', downloaded: false, status: 'not_downloaded', capability: 'asr', engineId: 'owned', packageId: 'owned', packageType: 'single-file', packageState: 'missing', manifestTrusted: false, runtimeAutoDownloadAllowed: false } };
const cases: Case[] = [
  { channel: 'desktop:getComputerUseCapabilityStatus', args: [], value: { state: 'future-state', mcpConnected: false, wrapperReady: false, future: true }, error: 'runtime_status_projection_unavailable', register: registerComputerUseCapabilityReadonlyIpc },
  { channel: 'desktop:kswarm:getStatus', args: [], value: { running: false, port: 4400, pid: null, restartCount: 0, lastError: null, terminalDegraded: true, persistenceFailStopCount: 2, lastPersistenceFailStop: 'owned' }, error: 'runtime_status_projection_unavailable', register: registerKswarmStatusReadonlyIpc },
  ...['installSkill', 'uninstallSkill'].map(method => ({ channel: 'desktop:' + method, args: ['owned-skill'], value: { success: true, message: 'owned' }, error: 'skill_mutation_output_invalid', register: (ipc: IpcHandleRegistrar, producer: IpcHandlerListener) => registerSkillMutationIpc(ipc, new Map([['desktop:' + method, producer]])) })),
  ...[
    { method: 'createChannel', args: [{ type: 'owned', name: 'Owned' }], value: channelValue },
    { method: 'updateChannel', args: ['owned', { enabled: false }], value: channelValue },
    { method: 'deleteChannel', args: ['owned'], value: undefined },
    { method: 'testChannel', args: ['owned'], value: { success: true, latencyMs: 1 } },
    { method: 'createMCPInstall', args: [{ name: 'Owned', source: 'local', command: 'owned' }], value: mcpValue },
    { method: 'updateMCPInstall', args: ['owned', { enabled: false }], value: mcpValue },
    { method: 'deleteMCPInstall', args: ['owned'], value: undefined },
  ].map(row => ({ channel: 'desktop:' + row.method, args: row.args, value: row.value, error: 'channel_mcp_mutation_projection_unavailable', register: (ipc: IpcHandleRegistrar, producer: IpcHandlerListener) => registerChannelMcpMutationIpc(ipc, new Map([['desktop:' + row.method, producer]])) })),
  ...[
    { method: 'requestMicrophonePermission', args: [], value: { status: 'unsupported' } },
    { method: 'saveAsrConfig', args: [{}], value: asrValue },
    { method: 'downloadModel', args: ['owned'], value: modelValue },
    { method: 'uninstallModel', args: ['owned'], value: modelValue },
  ].map(row => ({ channel: 'desktop:meeting:' + row.method, args: row.args, value: row.value, meeting: true, error: 'meeting_mutation_projection_unavailable', register: (ipc: IpcHandleRegistrar, producer: IpcHandlerListener) => registerMeetingMutationIpc(ipc, new Map([['desktop:meeting:' + row.method, producer]])) })),
];
function handler(row: Case, producer: IpcHandlerListener) {
  const listeners = new Map<string, IpcHandlerListener>();
  row.register({ handle: (name, listener) => listeners.set(name, listener) }, producer);
  return () => listeners.get(row.channel)!({} as never, ...row.args);
}
it('keeps exactly the original fifteen new batch channels', () => { expect(cases).toHaveLength(15); expect(new Set(cases.map(row => row.channel)).size).toBe(15); });
for (const row of cases) {
  for (const kind of ['constructor', 'species']) it(row.channel + ' rejects ' + kind + ' before getters without retry', async () => {
    let calls = 0, reads = 0;
    const raw = Promise.resolve(row.value);
    if (kind === 'constructor') Object.defineProperty(raw, 'constructor', { configurable: true, get() { reads++; return Promise; } });
    const invoke = handler(row, () => { calls++; return raw; });
    const species = Object.getOwnPropertyDescriptor(Promise, Symbol.species)!;
    let pending: unknown;
    try {
      if (kind === 'species') Object.defineProperty(Promise, Symbol.species, { configurable: true, get() { reads++; return Promise; } });
      pending = invoke();
    } finally { Object.defineProperty(Promise, Symbol.species, species); }
    await expect(pending).rejects.toThrow(row.error);
    expect(calls).toBe(1); expect(reads).toBe(0);
  });
  for (const kind of ['normal', 'ownThen', 'ownConstructor', 'rejection']) it(row.channel + ' preserves ' + kind + ' with one producer call', async () => {
    let calls = 0, reads = 0;
    const business = Error('actual-producer-business-error');
    const raw = kind === 'rejection' ? Promise.reject(business) : Promise.resolve(row.value);
    if (kind === 'ownThen') Object.defineProperty(raw, 'then', { configurable: true, get() { reads++; throw Error('own then executed'); } });
    if (kind === 'ownConstructor') Object.defineProperty(raw, 'constructor', { configurable: true, value: Promise });
    const invoke = handler(row, () => { calls++; return raw; });
    if (kind === 'rejection') {
      if (row.meeting) await expect(invoke()).rejects.toThrow('meeting_mutation_action_failed');
      else await expect(invoke()).rejects.toBe(business);
    } else expect(await invoke()).toEqual(row.value);
    expect(calls).toBe(1); expect(reads).toBe(0);
  });
  it(row.channel + ' uses captured native then without reading its call accessor', async () => {
    let calls = 0, reads = 0;
    const raw = Promise.resolve(row.value), invoke = handler(row, () => { calls++; return raw; });
    const then = Promise.prototype.then, original = Object.getOwnPropertyDescriptor(then, 'call'), nativeCall = Function.prototype.call;
    let pending: unknown;
    try { Object.defineProperty(then, 'call', { configurable: true, get() { reads++; return nativeCall; } }); pending = invoke(); }
    finally { if (original) Object.defineProperty(then, 'call', original); else Reflect.deleteProperty(then, 'call'); }
    expect(await pending).toEqual(row.value); expect(reads).toBe(0); expect(calls).toBe(1);
  });
}
