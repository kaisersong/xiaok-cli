import { z } from 'zod';
export const UPDATE_STATUS_SCHEMA = z.object({ checking: z.boolean(), available: z.boolean(), downloading: z.boolean(), downloaded: z.boolean(), installing: z.boolean().optional(), progress: z.number().finite(), version: z.string().optional(), error: z.string().optional() }).strict();
export const UPDATE_IPC_STATUS_SCHEMA = UPDATE_STATUS_SCHEMA.extend({ currentVersion: z.string() }).strict();
export const UPDATE_PROJECTION_SCHEMA = z.object({ status: z.enum(['idle', 'install_handoff_pending', 'install_failed', 'install_handed_off']), diagnostic: z.string().optional() }).strict();
export const UPDATE_INSTALL_SCHEMA = z.object({ status: z.enum(['pending', 'rejected_sync', 'pending_error_sticky', 'already_pending', 'already_handed_off']), diagnostic: z.string().optional(), projection: UPDATE_PROJECTION_SCHEMA }).strict();
export const UPDATER_INPUT_SCHEMAS = { getUpdateStatus: z.tuple([]), checkForUpdates: z.tuple([]), quitAndInstall: z.tuple([]) } as const;
export const UPDATER_OUTPUT_SCHEMAS = { getUpdateStatus: UPDATE_IPC_STATUS_SCHEMA, checkForUpdates: z.undefined(), quitAndInstall: UPDATE_INSTALL_SCHEMA } as const;
export type UpdaterIpcMethod = keyof typeof UPDATER_INPUT_SCHEMAS;
export type UpdateStatusDto = z.infer<typeof UPDATE_STATUS_SCHEMA>;
export type UpdateIpcStatusDto = z.infer<typeof UPDATE_IPC_STATUS_SCHEMA>;
export type UpdateInstallDto = z.infer<typeof UPDATE_INSTALL_SCHEMA>;
export interface UpdaterRequestContext { requestSource: 'user' | 'agent' | 'scheduler' }
