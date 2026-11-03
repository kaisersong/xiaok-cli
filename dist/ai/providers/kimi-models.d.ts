/** Exact Coding Plan wires; profile IDs also separate signed histories on model switch. */
export declare const KIMI_CODING_PROFILES: Readonly<{
    readonly k3: "kimi-k3-coding-openai";
    readonly 'k3-256k': "kimi-k3-256k-coding-openai";
    readonly 'k3.1-pro': "kimi-k3.1-pro-coding-openai";
    readonly 'k3.1-pro-highspeed': "kimi-k3.1-pro-highspeed-coding-openai";
}>;
export type KimiCodingModel = keyof typeof KIMI_CODING_PROFILES;
export type StrictKimiK3ProfileId = typeof KIMI_CODING_PROFILES[KimiCodingModel];
export declare function isKimiCodingModel(model: string | undefined): model is KimiCodingModel;
export declare function isStrictKimiK3ProfileId(profileId: unknown): profileId is StrictKimiK3ProfileId;
