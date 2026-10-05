import type { DesktopShutdownCoordinator } from './desktop-shutdown-coordinator.js';
import { createKSwarmService, sealAndDrainKSwarmServiceInstance, type KSwarmService, type CreateKSwarmServiceOptions } from './kswarm-service.js';

/** Register immediately after construction, in the final phase after ordinary
 * producers/bridges. A quit deadline never turns an unconfirmed close into proof. */
export function registerKSwarmInstanceLifetime(
  service: KSwarmService,
  finalSteps: Array<{ name: string; run: () => Promise<void> }>,
): void {
  finalSteps.push({
    name: 'kswarm-instance',
    run: () => {
      const actualClose = sealAndDrainKSwarmServiceInstance(service);
      return new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(Error('kswarm_service_shutdown_deadline_unconfirmed')), 35_000);
        void actualClose.then(
          () => { clearTimeout(deadline); resolve(); },
          error => { clearTimeout(deadline); reject(error); },
        );
      });
    },
  });
}

/** No await between the real shutdown gate, constructor and registration. */
export function createDesktopKSwarmService(
  coordinator: DesktopShutdownCoordinator,
  finalSteps: Array<{ name: string; run: () => Promise<void> }>,
  options?: CreateKSwarmServiceOptions,
): KSwarmService | undefined {
  if (coordinator.isQuitting) return undefined;
  const service = createKSwarmService(options);
  registerKSwarmInstanceLifetime(service, finalSteps);
  return service;
}
