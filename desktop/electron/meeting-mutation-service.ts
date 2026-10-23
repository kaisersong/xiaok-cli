import { types } from 'node:util';
import { saveConfig } from '../../src/utils/config.js';
import { applyMeetingAsrConfigUpdate, createMeetingAsrConfigSnapshot } from './meeting-asr-config.js';
import { readMeetingAsrConfig } from './meeting-readonly-data.js';
import { createMeetingModelService, MEETING_TRANSCRIBER_MODEL_REGISTRY } from './meeting-model-service.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { MEETING_SAVE_INPUT_SCHEMA, MEETING_MUTATION_ASR_OUTPUT_SCHEMA } from '../shared/meeting-mutation-ipc-contract.js';
import type { MeetingAudioPermissionResult } from './meeting-audio-permission.js';
const nativeThen = Promise.prototype.then;
export function createMeetingMutationService(permission: { requestPermission(): Promise<MeetingAudioPermissionResult> }) {
  let models: ReturnType<typeof createMeetingModelService> | undefined;
  let pendingPermission: Promise<MeetingAudioPermissionResult> | undefined;
  const authorize = (source: unknown) => { if (source !== 'user') throw Error('meeting_mutation_request_source_forbidden'); };
  const modelId = (id: unknown): string => {
    if (typeof id !== 'string' || !MEETING_TRANSCRIBER_MODEL_REGISTRY.some(model => model.id === id)) throw Error('meeting_mutation_input_invalid');
    return id;
  };
  return {
    async requestMicrophonePermission(source?: 'user' | 'agent' | 'scheduler') {
      authorize(source);
      if (pendingPermission) return pendingPermission;
      const operation = permission.requestPermission();
      assertStandardIpcPromise(operation, 'meeting_mutation_projection_unavailable');
      pendingPermission = operation;
      try { return await operation; } finally { pendingPermission = undefined; }
    },
    async saveAsrConfig(input: unknown, source?: 'user' | 'agent' | 'scheduler') {
      authorize(source);
      const snapshot = captureIpcData(input ?? {}, 'meeting_mutation_input_invalid');
      const parsed = MEETING_SAVE_INPUT_SCHEMA.safeParse(snapshot);
      if (!parsed.success) throw Error('meeting_mutation_input_invalid');
      try {
        // No await between truthful read / semantic edit / synchronous saveConfig body.
        const config = applyMeetingAsrConfigUpdate(readMeetingAsrConfig(), parsed.data);
        const projected = captureIpcData(createMeetingAsrConfigSnapshot(config), 'meeting_mutation_save_failed');
        if (!MEETING_MUTATION_ASR_OUTPUT_SCHEMA.safeParse(projected).success) throw Error('meeting_mutation_save_failed');
        const result = saveConfig(config);
        assertStandardIpcPromise(result, 'meeting_mutation_save_failed');
        await new Promise<void>((resolve, reject) => Reflect.apply(nativeThen, result, [resolve, reject]));
        return projected;
      } catch { throw Error('meeting_mutation_save_failed'); }
    },
    async downloadModel(id: unknown, source?: 'user' | 'agent' | 'scheduler') {
      authorize(source); const known = modelId(id);
      return (models ??= createMeetingModelService()).downloadModel(known);
    },
    async uninstallModel(id: unknown, source?: 'user' | 'agent' | 'scheduler') {
      authorize(source); const known = modelId(id);
      return (models ??= createMeetingModelService()).uninstallModel(known);
    },
  };
}
// Only fixed domain codes can cross the error transport. Never access error.message.
export function meetingMutationError(error: unknown): Error {
  const descriptor = error && typeof error === 'object' && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
  const value = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  const allowed = ['meeting_mutation_input_invalid', 'meeting_mutation_request_source_forbidden', 'meeting_mutation_save_failed', 'meeting_mutation_projection_unavailable', 'meeting_model_busy', 'size_mismatch', 'hash_mismatch', 'model_package_incomplete'];
  return Error(typeof value === 'string' && allowed.includes(value) ? value : 'meeting_mutation_action_failed');
}
