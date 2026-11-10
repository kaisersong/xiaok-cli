import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import type { EnterpriseCliConnectorService } from './enterprise-cli-service.js';
import { ENTERPRISE_CLI_PROVIDERS, ENTERPRISE_CLI_ACTION_SCHEMA, ENTERPRISE_CLI_PROVIDER_SCHEMA, ENTERPRISE_CLI_STATE_SCHEMA, ENTERPRISE_CLI_STATES_SCHEMA, type EnterpriseCliProvider } from '../shared/enterprise-cli-ipc-contract.js';
export function registerEnterpriseCliIpc(ipc: IpcHandleRegistrar, services: Record<EnterpriseCliProvider, EnterpriseCliConnectorService>, authorize: (event: Electron.IpcMainInvokeEvent) => boolean): void {
  const beforeInput = (event: Electron.IpcMainInvokeEvent): undefined => { if (!authorize(event)) throw Error('enterprise_cli_sender_forbidden'); return undefined; };
  registerIpcHandler({ registrar: ipc, channel: 'desktop:getEnterpriseCliConnectors', input: z.tuple([]), output: ENTERPRISE_CLI_STATES_SCHEMA, payloadMode: 'tuple', rolloutRound: 37, riskTags: ['fs-read'], sourceFile: 'desktop/electron/enterprise-cli-typed-ipc.ts', beforeInput,
    handler: async () => ENTERPRISE_CLI_STATES_SCHEMA.parse(ENTERPRISE_CLI_PROVIDERS.map(provider => services[provider].getState())),
  });
  registerIpcHandler({ registrar: ipc, channel: 'desktop:controlEnterpriseCliConnector', input: z.tuple([ENTERPRISE_CLI_PROVIDER_SCHEMA, ENTERPRISE_CLI_ACTION_SCHEMA]), output: ENTERPRISE_CLI_STATE_SCHEMA, payloadMode: 'tuple', rolloutRound: 37, riskTags: ['external-process','shell-open','network','fs-write-userData'], sourceFile: 'desktop/electron/enterprise-cli-typed-ipc.ts', beforeInput,
    handler: async ([provider, action]) => ENTERPRISE_CLI_STATE_SCHEMA.parse(await services[provider].control(action, 'user')),
  });
}
