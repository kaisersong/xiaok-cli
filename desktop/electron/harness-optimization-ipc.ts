import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import type { HarnessOptimizationState, HarnessUserContext } from '../shared/harness-optimization-contract.js';
interface Services {
  getHarnessOptimizationConfig(): Promise<HarnessOptimizationState>;
  saveHarnessOptimizationConfig(input: unknown, actor: HarnessUserContext): Promise<unknown>;
  setHarnessOptimizationEnabled(input: boolean, actor: HarnessUserContext): Promise<unknown>;
  revokeHarnessOptimizationGrants(input: { scope: 'all' | 'research'; manifestId?: string }, actor: HarnessUserContext): Promise<unknown>;
  resetOptimizationClockGuard(input: { expectedHighWaterMark: number; correctionEventId?: string }, actor: HarnessUserContext): Promise<unknown>;
}
export function registerHarnessOptimizationIpc(registrar: IpcHandleRegistrar, services: Services,
  actorForEvent: (event: IpcMainInvokeEvent) => HarnessUserContext | null): void {
  const actor = (event: IpcMainInvokeEvent) => { const value = actorForEvent(event); if (!value) throw new Error('actor_forbidden'); return value; };
  registrar.handle('desktop:getHarnessOptimizationConfig', async event => { actor(event); return services.getHarnessOptimizationConfig(); });
  registrar.handle('desktop:saveHarnessOptimizationConfig', async (event, input) => services.saveHarnessOptimizationConfig(input, actor(event)));
  registrar.handle('desktop:setHarnessOptimizationEnabled', async (event, input) => services.setHarnessOptimizationEnabled(input, actor(event)));
  registrar.handle('desktop:revokeHarnessOptimizationGrants', async (event, input) => services.revokeHarnessOptimizationGrants(input, actor(event)));
  registrar.handle('desktop:resetOptimizationClockGuard', async (event, input) => services.resetOptimizationClockGuard(input, actor(event)));
}
