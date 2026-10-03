import type { ComputerUseBackend } from '../../ai/tools/computer-use.js';
import type { CuaConnectionManager } from '../mcp/cua-connection-manager.js';
import { WindowsCuaObservationStore } from './windows-cua-observation.js';
import { WINDOWS_CUA_ABI_PROFILE } from './windows-cua-profile.js';
import { validateNativeBrowserLaunch } from './windows-cua-url.js';

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
  let launchBarrier: Promise<unknown> = Promise.resolve();
  const enqueue = async (name: string, input: Record<string, unknown>, callOptions: Parameters<ComputerUseBackend['callToolResult']>[2], expected?: object) => {
    const key = input.pid && input.window_id ? `${input.pid}:${input.window_id}` : '<catalog>';
    const previous = queues.get(key) ?? Promise.resolve();
    const predecessors = name === 'launch_app' ? [...queues.values(), launchBarrier] : [previous, launchBarrier];
    const next = Promise.allSettled(predecessors).then(async () => {
      callOptions?.signal?.throwIfAborted(); synchronize();
      if (!['get_window_state', 'list_apps', 'list_windows', 'launch_app'].includes(name)
        && (!expected || store.identity(input) !== expected)) {
        throw Object.assign(new Error('COMPUTER_USE_REOBSERVE_REQUIRED'), { code: 'COMPUTER_USE_REOBSERVE_REQUIRED' });
      }
      return perform(name, input, callOptions);
    });
    queues.set(key, next);
    if (name === 'launch_app') launchBarrier = next;
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
  };
  const perform: ComputerUseBackend['callToolResult'] = async (name, input, callOptions) => {
    synchronize(); const current = manager.generation;
    const observation = ['get_window_state', 'list_apps', 'list_windows'].includes(name);
    if (name === 'launch_app') {
      const launchInput = validateNativeBrowserLaunch(input); store.reset();
      try {
        const result = await manager.callToolResult(name, launchInput, callOptions);
        callOptions?.signal?.throwIfAborted();
        if (current !== manager.generation) { synchronize(); throw reobserve(); }
        return result;
      } finally { store.reset(); }
    }
    try {
      // 0.31.0 background drag injects a pen, which does not select text in
      // Chromium Edit controls. Refuse before input rather than replaying an
      // ambiguous successful native mutation. Other controls keep their route.
      // Both native pixel and element middle-click routes may use a left UIA
      // Invoke in 0.31.0. Refuse before dispatch, never after its side effect.
      const middle = name === 'click' && input.button === 'middle' && input.delivery_mode === 'background';
      const textDrag = name === 'drag' && store.backgroundDragRequiresMouse(input);
      const nonWebGesture = store.backgroundGestureRequiresMouse(name, input);
      const text = middle
        ? 'Background middle click may invoke the primary action instead of the middle mouse button. No input was sent; capture again before explicitly choosing foreground middle click.'
        : nonWebGesture
        ? 'Background pen injection cannot reliably deliver this mouse gesture to a target without observed web content. No input was sent; capture again before explicitly choosing foreground mouse input.'
        : 'Background pen drag cannot reliably select text in this observed Edit. No input was sent; capture again before explicitly choosing foreground mouse drag.';
      const result = middle || textDrag || nonWebGesture
        ? { isError: true, text, summary: text, images: [], structuredContent: { code: 'background_unavailable',
          source: 'xiaok_host', inputSent: false, reason: middle ? 'middle_click_requires_mouse_input' : nonWebGesture ? 'non_web_gesture_requires_mouse_input' : 'text_selection_requires_mouse_input', escalation: { recommended: 'foreground' } } }
        : await manager.callToolResult(name, input, callOptions);
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
          if (!['capture', 'screenshot', 'list_apps', 'list_windows', 'open_url'].includes(action)) expected = store.identity(input);
          return result;
        },
        callToolResult: (name, input, options) => enqueue(name, input, options, expected),
      };
      return { generation: current, backend: invocation, isCurrent: () => current === manager.generation };
    },
  };
  return backend;
}
