export * from './room-root-composition-entry.js';
export {
  bindOriginalMainRoomProjectAdmission,
  readOriginalMainRoomProjectAdmission,
} from '../../../desktop/electron/main-room-root-admission.js';
export {
  createKSwarmService,
  sealAndDrainKSwarmServiceInstance,
} from '../../../desktop/electron/kswarm-service.js';
export { prepareWorkspaceRoot } from '../../../desktop/electron/room-workspace-local.js';
export { readCurrentOriginalRootExecutionContext } from '../../../src/runtime/verification/original-root-execution-context.js';

export { createKSwarmRuntimeBridge } from '../../../desktop/electron/kswarm-runtime-bridge.js';
export { bindOriginalMainDirectAdmission } from '../../../desktop/electron/main-room-root-admission.js';
