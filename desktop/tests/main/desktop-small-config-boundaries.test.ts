// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { registerDesktopSmallConfigIpc } from '../../electron/desktop-small-config-typed-ipc.js';
import type { IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';

function fixture() {
  const handlers = new Map<string, IpcHandlerListener>();
  const service = {
    getSkillDebugConfig: vi.fn(async () => ({ enabled: false })),
    saveSkillDebugConfig: vi.fn(async () => ({ enabled: true })),
    getKswarmConfig: vi.fn(async () => ({ maxConcurrentTasks: 3 })),
    saveKswarmConfig: vi.fn(async () => ({ maxConcurrentTasks: 4 })),
  };
  const registrar = { handle(channel: string, listener: IpcHandlerListener) { handlers.set(channel, listener); } };
  registerDesktopSmallConfigIpc(registrar, service);
  return { service, registrar, handlers, call: (name: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(`desktop:${name}`)!({} as never, ...args)) };
}
it('rejects excess transport arguments and nonfinite concurrency before a service call', async () => {
  const f = fixture();
  await expect(f.call('getSkillDebugConfig', {})).rejects.toThrow('desktop_config_input_invalid');
  await expect(f.call('saveSkillDebugConfig', { enabled: true }, 'agent')).rejects.toThrow('desktop_config_input_invalid');
  await expect(f.call('saveKswarmConfig', { maxConcurrentTasks: Infinity })).rejects.toThrow('desktop_config_input_invalid');
  expect(f.service.getSkillDebugConfig).not.toHaveBeenCalled();
  expect(f.service.saveSkillDebugConfig).not.toHaveBeenCalled();
  expect(f.service.saveKswarmConfig).not.toHaveBeenCalled();
});
it('reports a mutation with an unsafe reply as unknown without reading getters or retrying', async () => {
  const f = fixture(); let reads = 0;
  f.service.saveSkillDebugConfig.mockResolvedValue(Object.defineProperty({}, 'enabled', { enumerable: true, get() { reads++; return true; } }) as { enabled: boolean });
  await expect(f.call('saveSkillDebugConfig', { enabled: true })).rejects.toThrow('desktop_config_operation_unknown');
  expect(reads).toBe(0); expect(f.service.saveSkillDebugConfig).toHaveBeenCalledExactlyOnceWith({ enabled: true }, 'user');
});
it('keeps the first registrar owner and resumes a partial registration without duplicates', () => {
  const f = fixture();
  registerDesktopSmallConfigIpc(f.registrar, f.service);
  expect(f.handlers.size).toBe(4);
  expect(() => registerDesktopSmallConfigIpc(f.registrar, { ...f.service })).toThrow('desktop_config_ipc_registrar_owner_conflict');
  let calls = 0; const installed: string[] = [];
  const partial = { handle(channel: string) { if (++calls === 2) throw Error('registration interrupted'); installed.push(channel); } };
  expect(() => registerDesktopSmallConfigIpc(partial, f.service)).toThrow('registration interrupted');
  registerDesktopSmallConfigIpc(partial, f.service);
  expect(installed).toHaveLength(4); expect(new Set(installed).size).toBe(4);
});
it('does not read caller payload when the first registrar owner has no runtime', async () => {
  const handlers = new Map<string, IpcHandlerListener>();
  registerDesktopSmallConfigIpc({ handle(channel, listener) { handlers.set(channel, listener); } });
  let reads = 0; const payload = Object.defineProperty({}, 'enabled', { get() { reads++; return true; } });
  await expect(Promise.resolve().then(() => handlers.get('desktop:saveSkillDebugConfig')!({} as never, payload))).rejects.toThrow('desktop_config_runtime_unavailable');
  expect(reads).toBe(0);
});
it('preserves the service failure and captures a genuine Promise without reading its own then accessor', async () => {
  const f = fixture(); const failure = Error('actual config read failed');
  f.service.getSkillDebugConfig.mockRejectedValueOnce(failure);
  await expect(f.call('getSkillDebugConfig')).rejects.toBe(failure);
  let reads = 0; const promise = Promise.resolve({ maxConcurrentTasks: 3 });
  Object.defineProperty(promise, 'then', { get() { reads++; throw Error('unsafe own then'); } });
  // A plain service method avoids Vitest's mock result tracker assimilating the Promise.
  Object.defineProperty(f.service, 'getKswarmConfig', { value: () => promise });
  await expect(f.call('getKswarmConfig')).resolves.toEqual({ maxConcurrentTasks: 3 });
  expect(reads).toBe(0);
});
