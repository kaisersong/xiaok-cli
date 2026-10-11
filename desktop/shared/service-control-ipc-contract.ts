import { z } from 'zod';
export const RELATED_SERVICE_ID_SCHEMA = z.enum(['kswarm', 'intent-broker', 'runtime-bridge']);
export const RELATED_SERVICE_STATUS_SCHEMA = z.object({
  id: RELATED_SERVICE_ID_SCHEMA, label: z.string(), running: z.boolean(), reachable: z.boolean(),
  port: z.number().finite(), pid: z.number().finite().nullable(), restartCount: z.number().finite().optional(),
  lastError: z.string().nullable(), detail: z.string().optional(),
}).passthrough();
export const SERVICE_STATUS_SNAPSHOT_SCHEMA = z.object({ checkedAt: z.number().finite(), services: z.array(RELATED_SERVICE_STATUS_SCHEMA) }).passthrough();
export const SERVICE_CONTROL_INPUT_SCHEMAS = { getStatus: z.tuple([]), restart: z.tuple([RELATED_SERVICE_ID_SCHEMA]) } as const;
export const SERVICE_CONTROL_OUTPUT_SCHEMAS = { getStatus: SERVICE_STATUS_SNAPSHOT_SCHEMA, restart: z.void() } as const;
export type ServiceControlMethod = keyof typeof SERVICE_CONTROL_INPUT_SCHEMAS;
export type RelatedServiceIdDto = z.infer<typeof RELATED_SERVICE_ID_SCHEMA>;
export type RelatedServiceStatusDto = z.infer<typeof RELATED_SERVICE_STATUS_SCHEMA>;
export type ServiceStatusSnapshotDto = z.infer<typeof SERVICE_STATUS_SNAPSHOT_SCHEMA>;
