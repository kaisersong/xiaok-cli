// One final-HEAD bundle graph; every resource is the original Main producer.
export {DesktopApplicationWindowOwner} from '../../../desktop/electron/desktop-application-window-owner.js';
export {createMainDshControlSource} from '../../../desktop/electron/main-dsh-control-source.js';
export {resolveDesktopServiceScope} from '../../../desktop/electron/desktop-service-scope.js';
export {createOriginalMainDshServiceSources,prepareOriginalMainDshServiceSources,readOriginalMainDshPreparedSources,closeOriginalMainDshStartupSources,prepareOriginalMainDshSourceKSwarmChild,prepareOriginalMainDshSourceBrokerChild} from '../../../desktop/electron/main-dsh-service-sources.js';
export {createKSwarmService,sealAndDrainKSwarmServiceInstance,readOriginalKSwarmServicePhysicalFate} from '../../../desktop/electron/kswarm-service.js';
export {createDesktopServices,readOriginalMainDshServicesBinding} from '../../../desktop/electron/desktop-services.js';
export {bindOriginalMainDshKSwarmService,readOptionalOriginalProtectedKSwarmServicePortFate} from '../../../desktop/electron/kswarm-protected-service-binding.js';
export {bindOriginalMainDshBrokerService,readOptionalOriginalProtectedBrokerServicePortFate} from '../../../desktop/electron/broker-protected-service-binding.js';
export {readOptionalOriginalProtectedKSwarmChildPortFate} from '../../../desktop/electron/kswarm-protected-child.js';
export {readOptionalOriginalProtectedBrokerChildPortFate} from '../../../desktop/electron/broker-protected-child.js';
export {getConfigDir} from '../../../src/utils/config.js';
