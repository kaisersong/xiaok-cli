import type { ComputerUseBackend } from '../../ai/tools/computer-use.js';
import type { CuaConnectionManager } from '../mcp/cua-connection-manager.js';
import { WindowsCuaObservationStore } from './windows-cua-observation.js';
import { WINDOWS_CUA_ABI_PROFILE } from './windows-cua-profile.js';

export function isWindowsCuaReplaySafeCall(operation: string, input: Readonly<Record<string, unknown>>): boolean {
  if (!['list_apps', 'list_windows', 'get_window_state'].includes(operation)) return false;
  const contract = WINDOWS_CUA_ABI_PROFILE.contracts.find(c => c.backendOperation === operation);
  return Boolean(contract && Object.keys(input).every(field => contract.translatorAllowed.includes(field)));
}

export function createWindowsCuaBackend(manager: CuaConnectionManager, options: { onObserved?: () => void } = {}): ComputerUseBackend {
  const store = new WindowsCuaObservationStore();
  let generation = manager.generation;
  const synchronize = () => {
    if (generation !== manager.generation) { store.reset(); generation = manager.generation; }
  };
  const reobserve = () => Object.assign(new Error('COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED'), { code: 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED' });
  const queues = new Map<string, Promise<unknown>>();
  const enqueue = async (name: string, input: Record<string, unknown>, callOptions: Parameters<ComputerUseBackend['callToolResult']>[2], expected?: object) => {
    const key = input.pid && input.window_id ? `${input.pid}:${input.window_id}` : '<catalog>';
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      callOptions?.signal?.throwIfAborted(); synchronize();
      if (!['get_window_state', 'list_apps', 'list_windows'].includes(name)
        && (!expected || store.identity(input) !== expected)) {
        throw Object.assign(new Error('COMPUTER_USE_REOBSERVE_REQUIRED'), { code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
      }
      return perform(name, input, callOptions);
    });
    queues.set(key, next);
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
  };
  const perform: ComputerUseBackend['callToolResult'] = async (name, input, callOptions) => {
    synchronize(); const current = manager.generation;
    const observation = ['get_window_state', 'list_apps', 'list_windows'].includes(name);
    try {
      const result = await manager.callToolResult(name, input, callOptions);
      callOptions?.signal?.throwIfAborted();
      if (current !== manager.generation) { synchronize(); throw reobserve(); }
      if (name === 'get_window_state' && !result.isError) {
        const projected = store.record(input, result);
        options.onObserved?.(); return projected;
      }
      if (!observation) store.recordOutcome(name, input, result);
      if (!observation || (name === 'get_window_state' && result.isError)) store.consume(input);
      return result;
    } catch (error) {
      if (!observation || name === 'get_window_state') { try { store.consume(input); } catch { /* Invalid target was never observed. */ } }
      throw error;
    }
  };
  const backend: ComputerUseBackend = {
    abiProfile: WINDOWS_CUA_ABI_PROFILE, requiresImageInput: true,
    prepareActionInput: (action, input) => { synchronize(); return store.prepare(action, input); },
    callToolResult: (name, input, options) => enqueue(name, input, options),
    acquireInvocation: () => {
      synchronize(); const current = manager.generation;
      let expected: object | undefined;
      const invocation: ComputerUseBackend = {
        ...backend,
        prepareActionInput(action, input) {
          synchronize(); const result = store.prepare(action, input);
          if (!['capture', 'screenshot', 'list_apps', 'list_windows'].includes(action)) expected = store.identity(input);
          return result;
        },
        callToolResult: (name, input, options) => enqueue(name, input, options, expected),
      };
      return { generation: current, backend: invocation, isCurrent: () => current === manager.generation };
    },
  };
  return backend;
}
