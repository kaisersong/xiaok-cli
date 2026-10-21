// UNREVIEWED delta controls. Copy to desktop/tests/main/meeting-actions10-error-code-delta.test.ts.
// POST-APPLICATION: imports the real R2 production registrar. Missing module is
// a staging failure, never a source-before behavior RED. No helper is reimplemented.
// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import { registerMeetingActions10Ipc } from '../../electron/meeting-actions10-typed-ipc.js';
import { resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
beforeEach(resetIpcSchemaRegistryForTests);
function actualBoundary(producer: IpcHandlerListener) {
  const listeners = new Map<string, IpcHandlerListener>();
  const gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle: (channel, handler) => listeners.set(channel, handler) }, gate);
  registerMeetingActions10Ipc(ipc, new Map([['desktop:meeting:live:start', producer]]));
  return { gate, invoke: () => listeners.get('desktop:meeting:live:start')!({} as never, { engine: 'aliyun-asr', sampleRate: 16000 }) };
}
// Producer evidence: aliyun :230/:355-357 and volcengine :219/:442-443.
// The sanitized suffix preserves case, punctuation and at most 80 characters.
const families = ['aliyun_live_task_failed', 'volcengine_live_service_failed'] as const;
const emittedSuffixes = ['unknown', 'InvalidApiKey', 'Service.Error_42-retry', '429', 'A'.repeat(80)];
it.each(families.flatMap(family => emittedSuffixes.map(suffix => [family, suffix] as const)))('actual registrar preserves %s:%s false DTO and original native Error identity', async (family, suffix) => {
  const code = `${family}:${suffix}`;
  const dto = actualBoundary(() => Promise.resolve({ ok: false, error: code }));
  expect(await dto.invoke()).toEqual({ ok: false, error: code });
  expect(dto.gate.outstanding).toBe(0);
  resetIpcSchemaRegistryForTests();
  const error = Error(code);
  const rejection = actualBoundary(() => Promise.reject(error));
  await expect(rejection.invoke()).rejects.toBe(error);
  expect(rejection.gate.outstanding).toBe(0);
});
it.each([
  'aliyun_live_task_failed:' + 'A'.repeat(81),
  'aliyun_live_task_failed:private/token',
  'volcengine_live_service_failed:private token',
  'aliyun_asr_http_failed:unknown',
  'aliyun_asr_upload_failed:InvalidApiKey',
  'volcengine_asr_failed:Service.Error',
  'unrecognized_live_failed:unknown',
])('actual registrar still masks a nonproducer code shape %s', async code => {
  const dto = actualBoundary(() => Promise.resolve({ ok: false, error: code }));
  expect(await dto.invoke()).toEqual({ ok: false, error: 'meeting_live_failed' });
  resetIpcSchemaRegistryForTests();
  const error = Error(code), rejection = actualBoundary(() => Promise.reject(error));
  await expect(rejection.invoke()).rejects.toThrow('meeting_actions10_operation_failed');
  expect(rejection.gate.outstanding).toBe(0);
});
it.each(['volcengine_asr_failed:503', 'aliyun_asr_upload_failed:403', 'aliyun_asr_http_failed:429'])('actual registrar retains numeric HTTP/ASR family %s', async code => {
  const f = actualBoundary(() => Promise.resolve({ ok: false, error: code }));
  expect(await f.invoke()).toEqual({ ok: false, error: code });
});
