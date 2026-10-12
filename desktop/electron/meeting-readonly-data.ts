import { readFileSync } from 'node:fs';
import { types } from 'node:util';
import { z } from 'zod';
import { getConfigPath } from '../../src/utils/config.js';
import { DEFAULT_CONFIG, isValidLegacyProvider, type Config, type LegacyConfig } from '../../src/types.js';
import { normalizeConfig } from '../../src/ai/providers/normalize.js';
import { createMeetingAsrConfigSnapshot } from './meeting-asr-config.js';
import { captureIpcData } from './ipc-data-snapshot.js';
import { MEETING_ASR_OUTPUT_SCHEMA } from '../shared/meeting-readonly-ipc-contract.js';

const provider = z.object({
  appKey: z.string().optional(), accessKey: z.string().optional(), apiKey: z.string().optional(),
  endpoint: z.string().optional(), resourceId: z.string().optional(),
  baseUrl: z.string().optional(), model: z.string().optional(),
}).passthrough();
const storedMeeting = z.object({ asr: z.object({
  defaultProvider: MEETING_ASR_OUTPUT_SCHEMA.shape.defaultProvider.optional(),
  volcengine: provider.optional(), aliyun: provider.optional(),
}).passthrough().optional() }).passthrough();

export function readMeetingAsrReadonly() {
  let raw: string | undefined;
  try { raw = readFileSync(getConfigPath(), 'utf8'); }
  catch (error) {
    if (!(error && typeof error === 'object' && !types.isProxy(error)
      && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ENOENT')) throw error;
  }
  let config: Config;
  if (raw === undefined) config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  else {
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch { throw Error('meeting_readonly_projection_unavailable'); }
    const snapshot = captureIpcData(decoded, 'meeting_readonly_projection_unavailable', { preserveDataPrototype: true });
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Error('meeting_readonly_projection_unavailable');
    const obj = snapshot as Record<string, unknown>;
    if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) throw Error('meeting_readonly_projection_unavailable');
    if (obj.schemaVersion === 1 && obj.defaultModel !== undefined && !isValidLegacyProvider(obj.defaultModel)) throw Error('meeting_readonly_projection_unavailable');
    if (obj.meeting !== undefined && !storedMeeting.safeParse(obj.meeting).success) throw Error('meeting_readonly_projection_unavailable');
    config = normalizeConfig(obj as unknown as Config | LegacyConfig);
  }
  const dto = captureIpcData(createMeetingAsrConfigSnapshot(config), 'meeting_readonly_projection_unavailable');
  const parsed = MEETING_ASR_OUTPUT_SCHEMA.safeParse(dto);
  if (!parsed.success) throw Error('meeting_readonly_projection_unavailable');
  return parsed.data;
}
