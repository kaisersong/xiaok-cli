import { z } from 'zod';
const number = z.custom<number>(value => typeof value === 'number');
export const RUNTIME_STATUS_INPUT_SCHEMA = z.tuple([]);
export const COMPUTER_USE_STATUS_SCHEMA = z.object({
  state: z.string(), mcpConnected: z.boolean(), wrapperReady: z.boolean(), lastError: z.string().optional(),
}).passthrough();
export const KSWARM_STATUS_SCHEMA = z.object({
  running: z.boolean(), port: number, pid: number.nullable(), restartCount: number, lastError: z.string().nullable(),
  terminalDegraded: z.boolean().optional(), persistenceFailStopCount: number.optional(), lastPersistenceFailStop: z.string().nullable().optional(),
}).passthrough();
export type ComputerUseReadonlyStatus = z.infer<typeof COMPUTER_USE_STATUS_SCHEMA>;
export type KswarmReadonlyStatus = z.infer<typeof KSWARM_STATUS_SCHEMA>;
