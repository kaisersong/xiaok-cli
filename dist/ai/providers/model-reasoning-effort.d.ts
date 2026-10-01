import type { ModelReasoningEffort, ProtocolId } from './types.js';
export { getDefaultModelReasoningEffort } from './model-runtime-options.js';
interface ModelReasoningIdentity {
    providerId: string;
    providerType: 'first_party' | 'custom';
    protocol: ProtocolId;
    wireModel: string;
    baseUrl?: string;
}
/** Only expose controls that the actual completion transport can send. */
export declare function getSupportedModelReasoningEfforts(identity: ModelReasoningIdentity): ModelReasoningEffort[];
