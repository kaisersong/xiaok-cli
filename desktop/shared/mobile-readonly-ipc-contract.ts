import { z } from 'zod';

export const MOBILE_RELAY_STATUS_SCHEMA = z.object({
  running: z.boolean(), connected: z.boolean(), relayUrl: z.string(), roomId: z.string(),
  lastError: z.string().nullable(), credentialState: z.enum(['ok', 'missing', 'expired', 'rejected', 'unparseable']),
  credentialExpiresAt: z.string().optional(), requiresUserReauth: z.boolean(),
}).passthrough();
export const MOBILE_PAIRING_INFO_SCHEMA = z.object({
  desktopId: z.string(), desktopName: z.string(), gatewayURL: z.string(), reachableURLs: z.array(z.string()),
  relayUrl: z.string().optional(), relayJwt: z.string().optional(), relayRoomSecret: z.string(), deepLink: z.string(),
}).passthrough();
export const MOBILE_READONLY_INPUT_SCHEMAS = { getRelayStatus: z.tuple([]), getPairingInfo: z.tuple([]) } as const;
export const MOBILE_READONLY_OUTPUT_SCHEMAS = { getRelayStatus: MOBILE_RELAY_STATUS_SCHEMA, getPairingInfo: MOBILE_PAIRING_INFO_SCHEMA } as const;
export type MobileReadonlyMethod = keyof typeof MOBILE_READONLY_INPUT_SCHEMAS;
export type MobileRelayStatusDto = z.infer<typeof MOBILE_RELAY_STATUS_SCHEMA>;
export type MobilePairingInfoDto = z.infer<typeof MOBILE_PAIRING_INFO_SCHEMA>;
