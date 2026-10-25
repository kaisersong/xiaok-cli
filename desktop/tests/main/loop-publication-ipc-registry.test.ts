// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { registerLoopPublicationIpc, LOOP_PUBLICATION_CHANNELS } from '../../electron/loop-publication-typed-ipc.js';
import type { DesktopLoopPublicationService } from '../../electron/loop-desktop-publication-service.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { LOOP_PUBLICATION_ACTION_SCHEMA, LOOP_PUBLICATION_CONFIGURATION_SCHEMA } from '../../shared/loop-publication-ipc-contract.js';

afterEach(() => resetIpcSchemaRegistryForTests());
const event = {} as Parameters<IpcHandlerListener>[0];
const perform = LOOP_PUBLICATION_CHANNELS.perform, stateChannel = LOOP_PUBLICATION_CHANNELS.getState;
function registrar() { const handlers = new Map<string, IpcHandlerListener>();
  const ipc: IpcHandleRegistrar = { handle(channel, fn) { handlers.set(channel, fn); } }; return { ipc, handlers }; }
const definition = { version: 1, obligations: [{ obligationId: 'o', predicateId: 'p', predicateVersion: '1', semantics: 'current-subject',
  recipe: { kind: 'artifact-content', checks: [{ id: 'check', path: 'report.md', sha256: 'a'.repeat(64), structure: 'bytes' }] } }] };
const configuration = () => JSON.parse(JSON.stringify({ version: 1, contract: { kind: 'user-template' },
  verificationDefinitions: { run: definition, stages: { execute: definition, verify: definition } } }));
const fullState = () => JSON.parse(JSON.stringify({ historyOnly: true, runId: 'run', loopId: 'loop', businessState: 'publication_pending',
  workspaceRoot: '/display/workspace', projection: null, candidates: [{ candidateId: 'candidate', stageKind: null, definition,
    natives: [{ id: 'native', kind: 'enrollment-and-application', revision: 1, phase: 'historical', sessions: [{ id: 'session',
      obligationId: 'o', phase: 'session_ready', executions: [{ id: 'execution', phase: 'verification_unknown',
        exactCommand: { argv: ['node', 'verify.js'], cwdRelative: '' }, expiresAt: 1 }] }] }],
    publications: [{ id: 'publication', nativeAttemptId: 'native', status: 'unknown' }] }] }));
const actions = () => [
  { kind: 'saveConfiguration', loopId: 'loop', expectedRevision: null, configuration: configuration() },
  { kind: 'reserveNative', candidateId: 'candidate', expectedLatestAttemptId: null },
  { kind: 'reauthorizeNative', attemptId: 'native', expectedRevision: 1 }, { kind: 'advanceNative', attemptId: 'native' },
  { kind: 'recoverNative', attemptId: 'native' }, { kind: 'prepareSession', nativeAttemptId: 'native', obligationId: 'o' },
  { kind: 'recoverSession', id: 'session' }, { kind: 'enrollSession', id: 'session' }, { kind: 'recoverEnrollment', id: 'session' },
  { kind: 'verify', id: 'session', exactCommand: { argv: ['node', 'verify.js'], cwdRelative: '' }, expiresAt: 1 },
  { kind: 'recoverVerification', id: 'execution' }, { kind: 'publish', nativeAttemptId: 'native', expectedLatestAttemptId: null },
  { kind: 'recoverPublication', attemptId: 'publication' }, { kind: 'project', runId: 'run' }, { kind: 'inspect', runId: 'run' },
];
it('registers all original three fixed tuples with full native/session/material/publish effects', () => {
  const f = registrar(); registerLoopPublicationIpc(f.ipc, {} as DesktopLoopPublicationService, () => false);
  expect(f.handlers.size).toBe(3);
  for (const channel of Object.values(LOOP_PUBLICATION_CHANNELS)) expect(IPC_SCHEMA_REGISTRY.get(channel))
    .toMatchObject({ sourceFile: 'desktop/electron/loop-publication-typed-ipc.ts', payloadMode: 'tuple', rolloutRound: 9 });
  expect(IPC_SCHEMA_REGISTRY.get(LOOP_PUBLICATION_CHANNELS.getConfiguration)!.riskTags).toEqual(['fs-read']);
  expect(IPC_SCHEMA_REGISTRY.get(stateChannel)!.riskTags).toEqual(['fs-read']);
  expect(IPC_SCHEMA_REGISTRY.get(perform)!.riskTags).toEqual(['fs-read', 'fs-write', 'fs-delete', 'fs-write-userData', 'network',
    'external-process', 'exec', 'capability-token', 'issues-token', 'internal-mutation', 'dialog']);
});
it('retains all fifteen original action schemas/null boundaries and fixed user injection without claiming native success', async () => {
  const f = registrar(), fn = vi.fn(async (input: Parameters<DesktopLoopPublicationService['perform']>[0]) =>
    input.kind === 'inspect' ? { kind: input.kind, inspection: { runId: input.runId, checkedAt: 1 } } : { kind: input.kind });
  registerLoopPublicationIpc(f.ipc, { perform: fn } as unknown as DesktopLoopPublicationService, () => true);
  const population = actions(); expect(population).toHaveLength(15);
  for (const action of population) {
    expect(LOOP_PUBLICATION_ACTION_SCHEMA.safeParse(action).success).toBe(true);
    expect(await f.handlers.get(perform)!(event, action)).toMatchObject({ kind: action.kind });
  }
  expect(fn).toHaveBeenCalledTimes(15); for (const [input] of fn.mock.calls) expect(input.requestSource).toBe('user');
});
it('keeps the complete three config contracts and exact full stage definitions rather than an empty criteria fallback', () => {
  for (const [contract, stages] of [
    [{ kind: 'builtin-diagnostic', scanner: 'kswarm-service-health', objective: 'Original', completionCriterion: 'Original' }, { scan: definition }],
    [{ kind: 'assistant', assistantKind: 'morning', objective: 'Original', completionCriterion: 'Original' }, {}],
    [{ kind: 'user-template' }, { execute: definition, verify: definition }],
  ]) expect(LOOP_PUBLICATION_CONFIGURATION_SCHEMA.safeParse({ version: 1, contract, verificationDefinitions: { run: definition, stages } }).success).toBe(true);
  expect(LOOP_PUBLICATION_CONFIGURATION_SCHEMA.safeParse({ ...configuration(), verificationDefinitions: { run: definition, stages: {} } }).success).toBe(false);
});
it('checks original auth then arity ahead of all wire code, with own source values always forbidden', async () => {
  const f = registrar(), fn = vi.fn(); let effects = 0; const proxy = new Proxy({}, { ownKeys() { effects++; throw Error('never'); } });
  registerLoopPublicationIpc(f.ipc, { perform: fn } as unknown as DesktopLoopPublicationService, e => e === event);
  expect(() => f.handlers.get(perform)!({} as typeof event, proxy, 'extra')).toThrow('loop_publication_ipc_denied');
  expect(() => f.handlers.get(perform)!(event, proxy, 'extra')).toThrow('loop_publication_ipc_input');
  await expect(f.handlers.get(perform)!(event, proxy)).rejects.toThrow('loop_publication_ipc_input');
  for (const requestSource of ['user', 'agent', 'scheduler', undefined])
    await expect(f.handlers.get(perform)!(event, { kind: 'inspect', runId: 'run', requestSource })).rejects.toThrow('loop_publication_ipc_input');
  expect(effects).toBe(0); expect(fn).not.toHaveBeenCalled();
});
it('makes the approved typed-malformed shape priority explicit while preserving original busy errors for legal shapes', async () => {
  const f = registrar(), busy = new Error('loop_desktop_publication_busy'), fn = vi.fn(async () => { throw busy; });
  registerLoopPublicationIpc(f.ipc, { perform: fn } as unknown as DesktopLoopPublicationService, () => true);
  await expect(f.handlers.get(perform)!(event, { kind: 'saveConfiguration', loopId: 'loop', expectedRevision: null,
    configuration: { ...configuration(), unexpected: true } })).rejects.toThrow('loop_publication_ipc_input'); expect(fn).not.toHaveBeenCalled();
  await expect(f.handlers.get(perform)!(event, actions()[0])).rejects.toBe(busy); expect(fn).toHaveBeenCalledOnce();
});
for (const mode of ['development', 'production']) {
  it(`captures the complete native/session/execution/recipe state before an async delivery alias mutation in ${mode}`, async () => {
    vi.stubEnv('NODE_ENV', mode);
    try {
      const original = fullState(); let delivery!: IpcHandlerListener;
      const ipc: IpcHandleRegistrar = { handle(channel, fn) { if (channel === stateChannel) delivery = async (event, ...args) => {
        const value = await fn(event, ...args); original.candidates[0].natives[0].sessions[0].executions[0].exactCommand.argv[0] = 'MUTATED'; return value;
      }; } };
      registerLoopPublicationIpc(ipc, { getState: () => original } as unknown as DesktopLoopPublicationService, () => true);
      const value = await delivery(event, 'run') as typeof original; expect(value).not.toBe(original);
      expect(value.candidates[0].natives[0].sessions[0].executions[0].exactCommand.argv[0]).toBe('node');
      expect(value.candidates[0].definition.obligations[0].recipe.checks).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });
}
it('refuses unknown nested state fields and unsafe getters/serializers without executing them', async () => {
  let effects = 0; const getter = fullState(); Object.defineProperty(getter.candidates[0], 'definition', { enumerable: true, get() { effects++; return definition; } });
  const unknown = fullState(); unknown.candidates[0].natives[0].sessions[0].executions[0].injectedScope = true;
  for (const value of [getter, unknown, { ...fullState(), toJSON() { effects++; return {}; } }, new Proxy(fullState(), { ownKeys() { effects++; throw Error('never'); } })]) {
    const f = registrar(); registerLoopPublicationIpc(f.ipc, { getState: () => value } as unknown as DesktopLoopPublicationService, () => true);
    await expect(f.handlers.get(stateChannel)!(event, 'run')).rejects.toThrow('loop_publication_projection_unavailable');
  }
  expect(effects).toBe(0);
});
it('reports unknown rather than a successful wrong-kind or missing inspection core after one actual owner dispatch', async () => {
  for (const value of [{ kind: 'inspect' }, { kind: 'project' }]) {
    const f = registrar(), fn = vi.fn(async () => value);
    registerLoopPublicationIpc(f.ipc, { perform: fn } as unknown as DesktopLoopPublicationService, () => true);
    await expect(f.handlers.get(perform)!(event, { kind: 'inspect', runId: 'run' })).rejects.toThrow('loop_publication_operation_unknown');
    expect(fn).toHaveBeenCalledOnce();
  }
});
it.each([0, 2])('does not replace the first real owner/auth after a registration failure with %s actual handlers', async count => {
  const handlers = new Map<string, IpcHandlerListener>(); let i = 0;
  const ipc: IpcHandleRegistrar = { handle(channel, fn) { if (i++ === count) throw Error('actual registration failure'); handlers.set(channel, fn); } };
  const service = {} as DesktopLoopPublicationService, authorize = () => false;
  expect(() => registerLoopPublicationIpc(ipc, service, authorize)).toThrow('actual registration failure'); expect(handlers.size).toBe(count);
  expect(() => registerLoopPublicationIpc(ipc, service, () => true)).toThrow('loop_publication_ipc_registrar_owner_conflict');
  for (const fn of handlers.values()) expect(() => fn(event, 'run')).toThrow('loop_publication_ipc_denied');
  expect(handlers.size).toBe(count);
});
