import type { KSwarmService } from '../../electron/kswarm-service.js';

export function mockKSwarmService(): KSwarmService {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {},
    getDesktopMutationToken: () => 'desktop-token',
    // This legacy stub has no service/factory authority. Unsupported newer APIs fail closed.
    getServiceStatus: async () => { throw Error('fixture_unsupported_service_capability'); },
    getHealthDiagnosticInput: async () => { throw Error('fixture_unsupported_service_capability'); },
    restartRelatedService: async () => { throw Error('fixture_unsupported_service_capability'); },
    getIntentBrokerRoomToken: () => { throw Error('fixture_unsupported_service_capability'); },
    request: async (path: string, init?: RequestInit) => new Response('{"error":"mock"}', { status: 501 }),
  };
}
