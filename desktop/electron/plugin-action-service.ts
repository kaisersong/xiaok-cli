import { types } from 'node:util';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { PLUGIN_ACTION_INPUTS, PLUGIN_ACTION_OUTPUTS, type PluginActionMethod } from '../shared/plugin-action-ipc-contract.js';
const NativePromise = Promise, nativeThen = Promise.prototype.then, apply = Reflect.apply;
// Private fulfilled witness checks intrinsic integrity before starting a producer.
const environmentWitness = new NativePromise<void>(resolve => resolve());
const codes = new Set(['request_source_user_required', 'invalid_plugin_name', 'plugin_dependency_not_found', 'unsupported_platform', 'confirmation_required',
  'plugin_dependency_install_not_available', 'plugin_dependency_update_not_available', 'release_not_allowed', 'external_driver_update_not_allowed',
  'installer_source_not_allowed', 'plugin_dependency_binary_missing', 'plugin_dependency_diagnose_not_available', 'dependency_task_busy',
  'dependency_cancelled', 'dependency_timeout', 'dependency_output_limit', 'plugin_install_failed', 'plugin_dependency_operation_failed',
  'plugin_diagnose_failed', 'unsupported_action', 'invalid_permission', 'plugin_permission_settings_failed', 'plugin_action_input_invalid',
  'plugin_action_projection_unavailable', 'plugin_action_runtime_unavailable', 'plugin_action_failed']);
export function pluginActionCode(error: unknown, fallback = 'plugin_action_failed'): string {
  let value: unknown = typeof error === 'string' ? error : undefined;
  if (error && typeof error === 'object' && !types.isProxy(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor && 'value' in descriptor) value = descriptor.value;
  }
  return typeof value === 'string' && codes.has(value) ? value : fallback;
}
export function capturePluginActionRequest<T>(raw: T): T {
  const value = captureIpcData(raw, 'plugin_action_input_invalid');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('plugin_action_input_invalid');
  return value;
}
export function assertPluginActionSource(source: unknown): void {
  if (source !== 'user') throw Error('request_source_user_required');
}
export function capturePluginActionInput(method: PluginActionMethod, raw: unknown[]): unknown[] {
  const snapshot = captureIpcData(raw, 'plugin_action_input_invalid');
  if (!PLUGIN_ACTION_INPUTS[method].safeParse(snapshot).success) throw Error('plugin_action_input_invalid');
  return snapshot;
}
export function capturePluginActionOutput(method: PluginActionMethod, raw: unknown): unknown {
  const snapshot = captureIpcData(raw, 'plugin_action_projection_unavailable');
  if (!PLUGIN_ACTION_OUTPUTS[method].safeParse(snapshot).success) throw Error('plugin_action_projection_unavailable');
  // Error fields are fixed domain codes. Success metadata/output stays the original ABI.
  if (snapshot && !Array.isArray(snapshot) && typeof snapshot === 'object' && Object.hasOwn(snapshot, 'error')) {
    const value = snapshot as { error?: string };
    if (value.error !== undefined) value.error = pluginActionCode(value.error, method === 'installPlugin' ? 'plugin_install_failed' : method === 'diagnosePluginDependency' ? 'plugin_diagnose_failed' : 'plugin_dependency_operation_failed');
  }
  return snapshot;
}
export async function openPluginPermissionSettings(rawInput: unknown, source: unknown, openExternal: (url: string) => unknown): Promise<void> {
  assertPluginActionSource(source);
  const [input] = capturePluginActionInput('openPluginDependencyPermissionSettings', [rawInput]) as [{ permission: 'screen' | 'accessibility' }];
  if (process.platform !== 'darwin') throw Error('unsupported_action');
  const pane = input.permission === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility';
  assertStandardIpcPromise(environmentWitness, 'plugin_action_projection_unavailable');
  let operation: unknown;
  try { operation = openExternal('x-apple.systempreferences:com.apple.preference.security?' + pane); }
  catch { throw Error('plugin_permission_settings_failed'); }
  assertStandardIpcPromise(operation, 'plugin_action_projection_unavailable');
  await new NativePromise<void>((resolve, reject) => apply(nativeThen, operation, [(value: unknown) => {
    if (value !== undefined) reject(Error('plugin_action_projection_unavailable')); else resolve();
  }, () => reject(Error('plugin_permission_settings_failed'))]));
}
