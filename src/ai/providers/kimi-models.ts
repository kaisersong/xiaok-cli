/** Exact Coding Plan wires; profile IDs also separate signed histories on model switch. */
export const KIMI_CODING_PROFILES = Object.freeze({
  'k3': 'kimi-k3-coding-openai',
  'k3-256k': 'kimi-k3-256k-coding-openai',
  'k3.1-pro': 'kimi-k3.1-pro-coding-openai',
  'k3.1-pro-highspeed': 'kimi-k3.1-pro-highspeed-coding-openai',
} as const);

export type KimiCodingModel = keyof typeof KIMI_CODING_PROFILES;
export type StrictKimiK3ProfileId = typeof KIMI_CODING_PROFILES[KimiCodingModel];

export function isKimiCodingModel(model: string | undefined): model is KimiCodingModel {
  return typeof model === 'string' && Object.hasOwn(KIMI_CODING_PROFILES, model);
}

export function isStrictKimiK3ProfileId(profileId: unknown): profileId is StrictKimiK3ProfileId {
  return Object.values(KIMI_CODING_PROFILES).some((id) => id === profileId);
}
