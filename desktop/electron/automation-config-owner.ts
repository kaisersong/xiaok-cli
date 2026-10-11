import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { AUTOMATION_CONFIG_SET_SCHEMA, type AutomationConfigDto } from '../shared/automation-config-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply, isPromise = types.isPromise;
/** Confirms this Main runtime's flag; other whole-config writers remain separate owners. */
export function createAutomationConfigOwner(options: { getEnabled(): boolean; onCommitted(enabled: boolean): void; persist(enabled: boolean, source: 'user'): unknown }) {
  let tail: Promise<void> = NativePromise.resolve();
  const getConfig = (): AutomationConfigDto => ({ globalBackgroundAutoRunEnabled: options.getEnabled() });
  return {
    getConfig,
    setEnabled(raw: unknown, requestSource?: 'user' | 'agent' | 'scheduler'): Promise<AutomationConfigDto> {
      if (requestSource !== 'user') return NativePromise.reject(Error('automation_config_request_source_forbidden'));
      let enabled: boolean;
      try {
        const parsed = AUTOMATION_CONFIG_SET_SCHEMA.safeParse(captureIpcData(raw, 'automation_config_input_invalid'));
        if (!parsed.success) throw Error('automation_config_input_invalid');
        enabled = parsed.data.enabled;
      } catch { return NativePromise.reject(Error('automation_config_input_invalid')); }
      const operation = new NativePromise<AutomationConfigDto>((resolve, reject) => {
        const fail = () => reject(Error('automation_config_operation_unknown'));
        apply(nativeThen, tail, [() => {
          const confirm = (value: unknown) => {
            if (value !== undefined) { fail(); return; }
            try { options.onCommitted(enabled); resolve(getConfig()); } catch { fail(); }
          };
          try {
            const completion = options.persist(enabled, 'user');
            if (!isPromise(completion)) { confirm(completion); return; }
            assertStandardIpcPromise(completion, 'automation_config_operation_unknown');
            apply(nativeThen, completion, [confirm, fail]);
          } catch { fail(); }
        }, fail]);
      });
      // Each queued operation comes from a separate explicit call, never an automatic retry.
      tail = new NativePromise(resolve => apply(nativeThen, operation, [() => resolve(), () => resolve()]));
      return operation;
    },
  };
}
