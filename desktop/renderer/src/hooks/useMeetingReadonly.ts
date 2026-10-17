import { getDesktopApi } from '../shared/desktop';
import { useDesktopReadonly } from './useSkillReadonly';
import { MEETING_ASR_OUTPUT_SCHEMA, MEETING_MODELS_OUTPUT_SCHEMA } from '../../../shared/meeting-readonly-ipc-contract';
const readModels = async () => {
  const desktop = getDesktopApi();
  if (!desktop?.meetingListModels) throw Error('meeting_readonly_runtime_unavailable');
  return desktop.meetingListModels();
};
const readAsr = async () => {
  const desktop = getDesktopApi();
  if (!desktop?.meetingGetAsrConfig) throw Error('meeting_readonly_runtime_unavailable');
  return desktop.meetingGetAsrConfig();
};
export function useMeetingModelsReadonly() { return useDesktopReadonly(readModels, MEETING_MODELS_OUTPUT_SCHEMA, false); }
export function useMeetingAsrReadonly() { return useDesktopReadonly(readAsr, MEETING_ASR_OUTPUT_SCHEMA, false); }
