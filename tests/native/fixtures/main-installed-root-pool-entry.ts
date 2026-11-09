export {
 createMainDshBootstrapAuthority,
 prepareOriginalMainDshInstalledRootPool,
 openOriginalMainDshInstalledRootPool,
 closeOriginalMainDshInstalledRootPool,
 prepareOriginalMainDshCoreInfrastructure,
 startOriginalMainDshCoreInfrastructure,
 closeOriginalMainDshCoreInfrastructure,
 returnOriginalMainDshInstalledRootPool,
 readOriginalMainDshCoreBootstrap,
 readOriginalMainDshAdmissionDatabase,
} from '../../../desktop/electron/main-dsh-bootstrap-authority.js';
export {DesktopMultiAgentStore} from '../../../desktop/electron/desktop-multi-agent-store.js';
export {loadOriginalMainResourceAuthority} from '../../../src/runtime/verification/original-main-native-loader.js';
export {createHarnessOptimizationRuntime} from '../../../desktop/electron/harness-optimization-service.js';
