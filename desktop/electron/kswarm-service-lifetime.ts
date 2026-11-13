import { withDesktopBootstrapWriter } from './desktop-bootstrap-writer.js';
import { ShuttingDownError, type DesktopShutdownGate } from './shutdown-aware-ipc-main.js';
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

/** Main composition only: retain actual startup across all owner awaits. */
export function startDesktopKSwarmService(
  gate: DesktopShutdownGate,
  service: KSwarmService,
  attachOwner?: (config: Awaited<ReturnType<NonNullable<KSwarmService['activityOwnerConfig']>>>) => Promise<void>,
  onOwnerUnavailable?: (error: unknown) => void,
): Promise<void> {
  return withDesktopBootstrapWriter(gate, async () => {
    const fresh = () => { if (!gate.isOpen) throw new ShuttingDownError('kswarm-activity-startup'); };
    fresh();
    if (attachOwner && service.activityOwnerConfig) {
      try {
        const config = await service.activityOwnerConfig();
        fresh();
        await attachOwner(config);
        fresh();
      } catch (error) {
        // Shutdown is never converted to fallback or a new background start.
        fresh();
        if (error instanceof Error && /activity_owner_(?:config|profile|discovery)_mismatch/.test(error.message)) throw error;
        if (!onOwnerUnavailable) throw error;
        service.releaseActivityOwnerDelegation?.();
        onOwnerUnavailable(error);
        fresh();
      }
    }
    await service.start();
  });
}

/** 1.6.2 parity (#235): when the services cannot start (for example a Windows
 * host whose loopback to the bundled runtime is filtered), Main keeps the
 * window and degrades. This never rejects and never opens a blocking dialog;
 * the caller only gets one code for a non-blocking notice. */
export function startDesktopKSwarmServiceDegrading(
  gate: DesktopShutdownGate,
  service: KSwarmService,
  attachOwner: Parameters<typeof startDesktopKSwarmService>[2],
  onOwnerUnavailable: Parameters<typeof startDesktopKSwarmService>[3],
  onDegraded: (code: string) => void,
): Promise<void> {
  return startDesktopKSwarmService(gate, service, attachOwner, onOwnerUnavailable).then(() => {
    const status = service.getStatus();
    if (!status.running || status.lastError) throw new Error(status.lastError ?? 'KSwarm service failed to start');
  }).catch(error => {
    const code = error instanceof Error ? error.message : 'service_bootstrap_failed';
    console.error('[main] Service bootstrap refused:', code);
    onDegraded(code);
  });
}

