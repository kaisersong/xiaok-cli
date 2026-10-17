// UNREVIEWED POST-APPLICATION controls. This imports new candidates at their
// production targets, so do NOT report missing-module baseline as a behavior RED.
// Copy to desktop/tests/main/meeting-mutation-candidate-controls.test.ts.
// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { registerMeetingMutationIpc } from '../../electron/meeting-mutation-typed-ipc.js';
import { createMeetingMutationService } from '../../electron/meeting-mutation-service.js';
import { createMeetingAudioPermissionService } from '../../electron/meeting-audio-permission.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
beforeEach(resetIpcSchemaRegistryForTests);
function boundary(producer: IpcHandlerListener) {
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const registrar = new ShutdownAwareIpcMain({ handle: (channel, listener) => listeners.set(channel, listener) }, gate);
  const producers = new Map([['desktop:meeting:requestMicrophonePermission', producer]]);
  registerMeetingMutationIpc(registrar, producers);
  return { gate, registrar, producers, invoke: () => listeners.get('desktop:meeting:requestMicrophonePermission')!({} as never) };
}
it('production typed boundary rejects output accessor without evaluating it', async () => {
  let reads = 0; const f = boundary(() => Object.defineProperty({}, 'status', { enumerable: true, get() { reads++; return 'granted'; } }));
  await expect(f.invoke()).rejects.toThrow('meeting_mutation_projection_unavailable'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each([undefined, null, { status: 'invented' }, { status: 'granted', secret: 'owned-private-marker' }, { ok: false, error: 'fake-ack' }])('production typed boundary rejects invalid output %j', async value => {
  const f = boundary(() => value); await expect(f.invoke()).rejects.toThrow('meeting_mutation_projection_unavailable');
});
it('unknown producer rejection is fixed and never evaluates the error getter', async () => {
  let reads = 0; const error = Object.defineProperty({}, 'message', { get() { reads++; return 'owned-private-marker'; } });
  const f = boundary(() => Promise.reject(error)); await expect(f.invoke()).rejects.toThrow('meeting_mutation_action_failed'); expect(reads).toBe(0);
});
it('a native pending producer holds physical token until actual rejection', async () => {
  let reject!: (error: unknown) => void; const f = boundary(() => new Promise((_r, j) => { reject = j; }));
  const operation = Promise.resolve(f.invoke()).catch(error => error); expect(f.gate.outstanding).toBe(1);
  f.gate.close(); const drained = f.gate.drain(1000); reject(Error('owned-private-marker'));
  expect(await operation).toMatchObject({ message: 'meeting_mutation_action_failed' }); expect(await drained).toBe(true); expect(f.gate.outstanding).toBe(0);
});
it('producer bindings detach and registrar owner identity is enforced', async () => {
  const f = boundary(() => ({ status: 'granted' })); f.producers.set('desktop:meeting:requestMicrophonePermission', () => ({ status: 'denied' }));
  expect(await f.invoke()).toEqual({ status: 'granted' }); registerMeetingMutationIpc(f.registrar, f.producers);
  expect(() => registerMeetingMutationIpc(f.registrar, new Map(f.producers))).toThrow('meeting_mutation_registrar_owner_conflict');
});
it.each([undefined, 'agent', 'scheduler'] as const)('actual facade denies %s before permission/config/model work', async source => {
  let asks = 0; const permission = createMeetingAudioPermissionService({ platform: 'darwin', getMediaAccessStatus: () => 'not-determined', askForMediaAccess: async () => { asks++; return true; } });
  const service = createMeetingMutationService(permission);
  let getters = 0; const payload = Object.defineProperty({}, 'aliyun', { enumerable: true, get() { getters++; return {}; } });
  for (const operation of [() => service.requestMicrophonePermission(source), () => service.saveAsrConfig(payload, source), () => service.downloadModel(payload, source), () => service.uninstallModel(payload, source)]) await expect(operation()).rejects.toThrow('meeting_mutation_request_source_forbidden');
  expect(asks).toBe(0); expect(getters).toBe(0);
});
it('actual permission owner coalesces a pending OS ask and permits the next request after settlement', async () => {
  let asks = 0, finish!: (value: boolean) => void;
  const permission = createMeetingAudioPermissionService({ platform: 'darwin', getMediaAccessStatus: () => 'not-determined', askForMediaAccess: async () => { asks++; return new Promise<boolean>(r => { finish = r; }); } });
  const service = createMeetingMutationService(permission); const a = service.requestMicrophonePermission('user'), b = service.requestMicrophonePermission('user');
  const before = asks; finish(true); expect(await a).toEqual({ status: 'granted' }); expect(await b).toEqual({ status: 'granted' }); expect(before).toBe(1);
  const c = service.requestMicrophonePermission('user'); finish(true); await c; expect(asks).toBe(2);
});
