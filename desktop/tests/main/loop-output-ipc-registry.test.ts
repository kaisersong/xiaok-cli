// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerLoopOutputIpc, LOOP_OUTPUT_CHANNELS } from '../../electron/loop-output-ipc.js';
import { createLoopOutputService, type LoopOutputService } from '../../electron/loop-output-service.js';
import { LoopStore } from '../../electron/loop-store.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { DesktopShutdownGate, type IpcHandleRegistrar, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';

afterEach(() => resetIpcSchemaRegistryForTests());
const event = {} as Parameters<IpcHandlerListener>[0];
const preview = LOOP_OUTPUT_CHANNELS.readOutputPreview;
const ordinary = () => ({ ok: true, loopId: 'loop', pathLabel: '/display/report.md', content: 'normal', sizeBytes: 6, truncated: false });
function registrar() {
  const handlers = new Map<string, IpcHandlerListener>();
  const ipc: IpcHandleRegistrar = { handle(channel, listener) { handlers.set(channel, listener); } };
  return { ipc, handlers };
}
const commonRisks = ['fs-read', 'network', 'capability-token', 'internal-mutation', 'external-process'];
it('registers exactly four original fixed tuple schemas and all downstream effect metadata', () => {
  const f = registrar(); registerLoopOutputIpc(f.ipc, {} as LoopOutputService, () => false);
  expect(f.handlers.size).toBe(4);
  const expected = { listPublishedArtifacts: commonRisks, readOutputPreview: commonRisks,
    readTaskResult: [...commonRisks, 'exec', 'fs-write-userData'], openOutputDirectory: [...commonRisks, 'fs-write', 'shell-open'] };
  for (const [key, channel] of Object.entries(LOOP_OUTPUT_CHANNELS)) {
    expect(IPC_SCHEMA_REGISTRY.get(channel)).toMatchObject({ sourceFile: 'desktop/electron/loop-output-ipc.ts', rolloutRound: 7, payloadMode: 'tuple' });
    expect(IPC_SCHEMA_REGISTRY.get(channel)!.riskTags).toEqual(expected[key as keyof typeof expected]);
  }
});
it('retains original frame/arity denial ahead of Proxy, getter and owner access', async () => {
  const f = registrar(), service = { readOutputPreview: vi.fn(), listPublishedArtifacts: vi.fn() } as unknown as LoopOutputService;
  let traps = 0; const page = new Proxy({}, { ownKeys() { traps++; throw Error('never'); } });
  registerLoopOutputIpc(f.ipc, service, e => e === event);
  await expect(Promise.resolve().then(() => f.handlers.get(preview)!({} as typeof event, page))).rejects.toThrow('loop_output_ipc_denied');
  await expect(Promise.resolve().then(() => f.handlers.get(preview)!(event, 'loop', page))).rejects.toThrow('loop_output_ipc_denied');
  await expect(Promise.resolve().then(() => f.handlers.get(LOOP_OUTPUT_CHANNELS.listPublishedArtifacts)!(event, 'loop', page))).rejects.toThrow('loop_output_ipc_input');
  expect(traps).toBe(0); expect(service.readOutputPreview).not.toHaveBeenCalled(); expect(service.listPublishedArtifacts).not.toHaveBeenCalled();
});
it('keeps actual original identity/page parser errors before owner calls', async () => {
  const f = registrar(), fn = vi.fn(); registerLoopOutputIpc(f.ipc, { listPublishedArtifacts: fn } as unknown as LoopOutputService, () => true);
  const call = (...args: unknown[]) => Promise.resolve().then(() => f.handlers.get(LOOP_OUTPUT_CHANNELS.listPublishedArtifacts)!(event, ...args));
  await expect(call('', { offset: 0, identity: null })).rejects.toThrow('loop_verification_execution_identity');
  await expect(call('loop', { offset: 0, identity: null, forged: true })).rejects.toThrow('loop_verification_execution_input');
  await expect(call('loop', { offset: 1, identity: null })).rejects.toThrow('loop_artifact_page'); expect(fn).not.toHaveBeenCalled();
});
it('captures one page before an async owner and preserves its original source injection', async () => {
  const f = registrar(); let entered!: () => void, release!: () => void;
  const enter = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
  const page = { offset: 20, identity: { runId: 'ORIGINAL', candidateId: 'candidate', candidateRevision: 1, payloadHash: 'a'.repeat(64) } };
  const fn = vi.fn(async (input: Parameters<LoopOutputService['listPublishedArtifacts']>[0]) => {
    entered(); await hold; return { identity: input.page.identity!, offset: 20, total: 21, nextOffset: null,
      items: [{ selection: { kind: 'local' as const, obligationId: 'o', path: 'file.md' }, path: 'file.md', sha256: 'a'.repeat(64), size: 1 }], loopId: input.loopId, checkedAt: 1 };
  });
  registerLoopOutputIpc(f.ipc, { listPublishedArtifacts: fn } as unknown as LoopOutputService, () => true);
  const work = f.handlers.get(LOOP_OUTPUT_CHANNELS.listPublishedArtifacts)!(event, 'loop', page); await enter;
  page.identity.runId = 'MUTATED'; release(); const result = await work as { identity: { runId: string } };
  expect(result.identity.runId).toBe('ORIGINAL'); expect(fn.mock.calls[0][0].page).not.toBe(page); expect(fn.mock.calls[0][0].requestSource).toBe('user');
});
for (const mode of ['development', 'production']) {
  it(`returns the same captured output value without a later producer alias in ${mode}`, async () => {
    vi.stubEnv('NODE_ENV', mode);
    try {
      const f = registrar(), output = ordinary(); registerLoopOutputIpc(f.ipc, { readOutputPreview: async () => output } as unknown as LoopOutputService, () => true);
      const result = await f.handlers.get(preview)!(event, 'loop') as typeof output;
      expect(result).not.toBe(output); output.content = 'MUTATED'; expect(result.content).toBe('normal');
    } finally { vi.unstubAllEnvs(); }
  });
}
it('rejects unknown output fields, missing success core fields and accessor/serializer/Proxy code without invoking them', async () => {
  let effects = 0;
  const accessor = ordinary(); Object.defineProperty(accessor, 'content', { enumerable: true, get() { effects++; return 'never'; } });
  const values = [{ ...ordinary(), forged: true }, { ok: true, loopId: 'loop' }, accessor,
    { ...ordinary(), toJSON() { effects++; return ordinary(); } }, new Proxy(ordinary(), { ownKeys() { effects++; throw Error('never'); } })];
  for (const value of values) {
    const f = registrar(); registerLoopOutputIpc(f.ipc, { readOutputPreview: async () => value } as unknown as LoopOutputService, () => true);
    await expect(f.handlers.get(preview)!(event, 'loop')).rejects.toThrow('loop_output_projection_unavailable');
  }
  expect(effects).toBe(0);
});
it('returns navigation unknown after the real ordinary service mkdir and a malformed OS port result exactly once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-loop4-unknown-')), store = new LoopStore(join(root, 'db.sqlite')),
    evidence = new CompletionEvidenceStore(join(root, 'db.sqlite')), gate = new DesktopShutdownGate();
  const shell = vi.fn(async () => ({ invalidOsResult: true } as unknown as string));
  store.createUserLoopTemplate({ loopId: 'loop', kind: 'markdown_file', title: 'Original', prompt: 'Original',
    outputDirectory: join(root, 'outputs'), outputFileName: 'report.md', now: 1 });
  const service = createLoopOutputService({ store, evidenceStore: evidence, gate, captureAdmission: () => () => {},
    taskPort: { recoverTask: async () => undefined }, openPath: shell });
  try {
    const f = registrar(); registerLoopOutputIpc(f.ipc, service, () => true);
    expect(await f.handlers.get(LOOP_OUTPUT_CHANNELS.openOutputDirectory)!(event, 'loop'))
      .toEqual({ ok: false, loopId: 'loop', error: 'open_output_directory_unknown' });
    expect(existsSync(join(root, 'outputs'))).toBe(true); expect(shell).toHaveBeenCalledOnce(); expect(gate.outstanding).toBe(0);
  } finally { await service.close(); evidence.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
it.each([0, 2])('keeps first owner and authorizer after a registrar failure with %s actual channels installed', async count => {
  const handlers = new Map<string, IpcHandlerListener>(); let registrations = 0;
  const ipc: IpcHandleRegistrar = { handle(channel, listener) {
    if (registrations++ === count) throw Error('actual registrar failure'); handlers.set(channel, listener);
  } };
  const service = { readOutputPreview: async () => ordinary() } as unknown as LoopOutputService, authorize = () => false;
  expect(() => registerLoopOutputIpc(ipc, service, authorize)).toThrow('actual registrar failure');
  expect(handlers.size).toBe(count);
  expect(() => registerLoopOutputIpc(ipc, service, () => true)).toThrow('loop_output_ipc_registrar_owner_conflict');
  for (const listener of handlers.values()) await expect(Promise.resolve().then(() => listener(event, 'loop'))).rejects.toThrow('loop_output_ipc_denied');
  expect(handlers.size).toBe(count);
});
