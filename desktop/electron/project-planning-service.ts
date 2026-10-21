import { captureIpcData } from './ipc-data-snapshot.js';
import { PROJECT_PLANNING_INPUT } from '../shared/project-planning-ipc-contract.js';
export function captureProjectPlanningInput(raw: unknown) {
  const snapshot = captureIpcData(raw, 'project_planning_input_invalid');
  const parsed = PROJECT_PLANNING_INPUT.safeParse(snapshot);
  if (!parsed.success) throw Error('project_planning_input_invalid');
  return parsed.data;
}
