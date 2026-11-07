export * from './room-root-composition-entry.js';
export {
  bindOriginalMainDirectAdmission,
  bindOriginalMainRoomProjectAdmission,
  readOriginalMainDirectAdmission,
  readOriginalMainRoomProjectAdmission,
} from '../../../desktop/electron/main-room-root-admission.js';
export {
  createKSwarmService,
  readOriginalKSwarmServiceIdentity,
  sealAndDrainKSwarmServiceInstance,
} from '../../../desktop/electron/kswarm-service.js';
export { createKSwarmRuntimeBridge } from '../../../desktop/electron/kswarm-runtime-bridge.js';
export {
  cacheOriginalMainAcceptedAdmission,
  readOptionalOriginalMainAcceptedAdmission,
} from '../../../desktop/electron/main-accepted-root-binding.js';
export { readCurrentOriginalRootExecutionContext } from '../../../src/runtime/verification/original-root-execution-context.js';

export {hasOriginalMainSdkBridgeInstallation} from '../../../src/runtime/verification/original-main-sdk-bridge.js';
