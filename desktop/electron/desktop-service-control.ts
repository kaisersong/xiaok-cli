import { captureIpcData } from './ipc-data-snapshot.js';
import { captureServiceControlOutput, resolveServiceControlOutput } from './service-control-snapshot.js';
import { RELATED_SERVICE_ID_SCHEMA, type RelatedServiceIdDto, type ServiceStatusSnapshotDto } from '../shared/service-control-ipc-contract.js';
type RequestSource = 'user' | 'agent' | 'scheduler';
/** Main's application UI facade; underlying SDK lifecycle and ingress remain its owners. */
export function createDesktopServiceControl(options: {
  getSdkSnapshot(): unknown;
  restartSdk(id: RelatedServiceIdDto): unknown;
  getRuntimeBridgeFacts(): { started: boolean; clients: number };
  getRuntimeBridgeRestart(): () => unknown;
}) {
  return {
    async getStatus(): Promise<ServiceStatusSnapshotDto> {
      const base = await resolveServiceControlOutput('getStatus', options.getSdkSnapshot()) as ServiceStatusSnapshotDto;
      const facts = captureIpcData(options.getRuntimeBridgeFacts(), 'service_projection_unavailable');
      if (!facts || typeof facts !== 'object' || typeof facts.started !== 'boolean' || !Number.isFinite(facts.clients)) throw Error('service_projection_unavailable');
      return captureServiceControlOutput('getStatus', { ...base, services: [...base.services, {
        id: 'runtime-bridge', label: 'Runtime Bridge', running: facts.started, reachable: facts.started,
        port: 0, pid: null, restartCount: 0, lastError: null,
        detail: facts.started ? `${facts.clients} client(s) registered` : 'not started',
      }] }) as ServiceStatusSnapshotDto;
    },
    async restart(id: unknown, requestSource?: RequestSource): Promise<void> {
      if (requestSource !== 'user') throw Error('service_request_source_forbidden');
      const parsed = RELATED_SERVICE_ID_SCHEMA.safeParse(captureIpcData(id, 'service_input_invalid'));
      if (!parsed.success) throw Error('service_input_invalid');
      const result = parsed.data === 'runtime-bridge' ? options.getRuntimeBridgeRestart()() : options.restartSdk(parsed.data);
      await resolveServiceControlOutput('restart', result);
    },
  };
}
