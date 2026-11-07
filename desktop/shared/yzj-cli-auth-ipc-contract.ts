import { z } from 'zod';
export const YZJ_CLI_AUTH_PHASES = ['idle', 'checking', 'signedOut', 'opening', 'waiting', 'authenticated', 'verificationFailed', 'failed', 'timedOut', 'cancelling', 'stopPending', 'cancelled', 'unavailable'] as const;
export const YZJ_CLI_CONNECTION_SCHEMA = z.object({
  name: z.string().min(1).max(200).optional(),
  department: z.string().min(1).max(300).optional(),
  openId: z.string().min(1).max(256).optional(),
  orgId: z.string().min(1).max(256).optional(),
  connectedAt: z.string().datetime().optional(),
  checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  tokenStatus: z.enum(['valid', 'needs_refresh', 'expired']).optional(),
}).strict();
export const YZJ_CLI_AUTH_STATE_SCHEMA = z.object({
  phase: z.enum(YZJ_CLI_AUTH_PHASES),
  revision: z.number().int().nonnegative(),
  connection: YZJ_CLI_CONNECTION_SCHEMA.optional(),
}).strict();
export type YzjCliConnection = z.infer<typeof YZJ_CLI_CONNECTION_SCHEMA>;
export const YZJ_CLI_AUTH_ACTION_SCHEMA = z.enum(['check', 'login', 'cancel']);
export type YzjCliAuthState = z.infer<typeof YZJ_CLI_AUTH_STATE_SCHEMA>;
export type YzjCliAuthAction = z.infer<typeof YZJ_CLI_AUTH_ACTION_SCHEMA>;
