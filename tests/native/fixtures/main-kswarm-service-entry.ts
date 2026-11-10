// One real bundle graph: fixed Sources/Services/Service/Core, no alternate owner.
export {DesktopApplicationWindowOwner} from '../../../desktop/electron/desktop-application-window-owner.js';
export {createMainDshControlSource} from '../../../desktop/electron/main-dsh-control-source.js';
export {resolveDesktopServiceScope} from '../../../desktop/electron/desktop-service-scope.js';
export {createOriginalMainDshServiceSources,prepareOriginalMainDshServiceSources,readOriginalMainDshPreparedSources,closeOriginalMainDshStartupSources} from '../../../desktop/electron/main-dsh-service-sources.js';
export {createKSwarmService,sealAndDrainKSwarmServiceInstance,readOriginalKSwarmServicePhysicalFate} from '../../../desktop/electron/kswarm-service.js';
export {createDesktopServices,readOriginalMainDshServicesBinding} from '../../../desktop/electron/desktop-services.js';
export {bindOriginalMainDshKSwarmService,readOptionalOriginalProtectedKSwarmServicePortFate} from '../../../desktop/electron/kswarm-protected-service-binding.js';
export {readOptionalOriginalProtectedKSwarmChildPortFate} from '../../../desktop/electron/kswarm-protected-child.js';
export {readOriginalMainDshStartedCore,prepareOriginalMainDshKSwarmChild} from '../../../desktop/electron/main-dsh-bootstrap-authority.js';
