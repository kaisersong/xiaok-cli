import { captureIpcData } from './ipc-data-snapshot.js';
import { UPDATE_STATUS_SCHEMA, type UpdateStatusDto } from '../shared/updater-ipc-contract.js';
export function assertUpdaterSource(raw: unknown, allowed: 'user' | 'scheduler'): void {
  let context: unknown;
  try { context = captureIpcData(raw, 'updater_request_source_invalid'); } catch { throw Error('updater_request_source_invalid'); }
  if (!context || typeof context !== 'object' || !Object.hasOwn(context, 'requestSource')) throw Error('updater_request_source_required');
  const source = (context as Record<string, unknown>).requestSource;
  if (typeof source !== 'string' || !['user', 'agent', 'scheduler'].includes(source)) throw Error('updater_request_source_invalid');
  if (source !== allowed) throw Error('updater_request_source_forbidden');
}
export function captureUpdateStatus(raw: unknown): UpdateStatusDto {
  const snapshot = captureIpcData(raw, 'updater_projection_unavailable');
  if (!UPDATE_STATUS_SCHEMA.safeParse(snapshot).success) throw Error('updater_projection_unavailable');
  return snapshot as UpdateStatusDto;
}
