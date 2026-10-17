import { z } from 'zod';
export const MOBILE_SIGNIN_INPUT_SCHEMA = z.tuple([]);
export const MOBILE_SIGNIN_OUTPUT_SCHEMA = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), url: z.string().min(1) }).passthrough(),
  z.object({ ok: z.literal(false), error: z.enum(['relay_url_unknown', 'relay_url_invalid']) }).passthrough(),
]);
export type MobileRelaySignInResult = z.infer<typeof MOBILE_SIGNIN_OUTPUT_SCHEMA>;
