import { z } from 'zod';
import { registerIpcHandler } from './ipc-runtime.js';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import type { YzjCliAuthService } from './yzj-cli-auth-service.js';
import { YZJ_CLI_AUTH_ACTION_SCHEMA, YZJ_CLI_AUTH_STATE_SCHEMA } from '../shared/yzj-cli-auth-ipc-contract.js';
import { isTrustedDesktopRendererUrl } from './security.js';

export function isYzjCliAuthSenderAllowed(event: Electron.IpcMainInvokeEvent, window: Electron.BrowserWindow | null, options: { rendererFile: string; devServer?: string }): boolean {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && isTrustedDesktopRendererUrl(window.webContents.mainFrame.url, options));
}

export function registerYzjCliAuthIpc(ipc: IpcHandleRegistrar, service: Pick<YzjCliAuthService, 'getState' | 'control'>, authorize: (event: Electron.IpcMainInvokeEvent) => boolean): void {
  const beforeInput = (event: Electron.IpcMainInvokeEvent): undefined => {
    if (!authorize(event)) throw Error('yzj_cli_auth_sender_forbidden');
    return undefined;
  };
  registerIpcHandler({ registrar: ipc, channel: 'desktop:getYzjCliAuthState', input: z.tuple([]),
    output: YZJ_CLI_AUTH_STATE_SCHEMA, payloadMode: 'tuple', rolloutRound: 37, riskTags: ['fs-read'],
    sourceFile: 'desktop/electron/yzj-cli-auth-typed-ipc.ts', beforeInput,
    handler: async () => YZJ_CLI_AUTH_STATE_SCHEMA.parse(service.getState()),
  });
  registerIpcHandler({ registrar: ipc, channel: 'desktop:controlYzjCliAuth', input: z.tuple([YZJ_CLI_AUTH_ACTION_SCHEMA]),
    output: YZJ_CLI_AUTH_STATE_SCHEMA, payloadMode: 'tuple', rolloutRound: 37,
    riskTags: ['external-process', 'shell-open', 'network', 'fs-write-userData'],
    sourceFile: 'desktop/electron/yzj-cli-auth-typed-ipc.ts', beforeInput,
    handler: async ([action]) => YZJ_CLI_AUTH_STATE_SCHEMA.parse(await service.control(action, 'user')),
  });
}
