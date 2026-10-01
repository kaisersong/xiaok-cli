import { findCatalogModel, getProviderProfile } from './registry.js';
import { isOfficialKimiK3OpenAIEndpoint } from './model-runtime-options.js';
import type { ModelReasoningEffort, ProtocolId } from './types.js';

export { getDefaultModelReasoningEffort } from './model-runtime-options.js';

interface ModelReasoningIdentity {
  providerId: string;
  providerType: 'first_party' | 'custom';
  protocol: ProtocolId;
  wireModel: string;
  baseUrl?: string;
}

function isCatalogEndpoint(baseUrl: string, officialUrl: string): boolean {
  try {
    const endpoint = new URL(baseUrl);
    const official = new URL(officialUrl);
    return endpoint.protocol === official.protocol
      && endpoint.host === official.host
      && endpoint.pathname.replace(/\/$/, '') === official.pathname.replace(/\/$/, '')
      && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash;
  } catch {
    return false;
  }
}

/** Only expose controls that the actual completion transport can send. */
export function getSupportedModelReasoningEfforts(identity: ModelReasoningIdentity): ModelReasoningEffort[] {
  if (identity.providerType !== 'first_party' || identity.protocol !== 'openai_legacy') return [];
  const profile = getProviderProfile(identity.providerId);
  if (!profile?.baseUrl) return [];
  const baseUrl = identity.baseUrl ?? profile.baseUrl;
  const endpointSupported = identity.providerId === 'kimi'
    ? isOfficialKimiK3OpenAIEndpoint(baseUrl)
    : isCatalogEndpoint(baseUrl, profile.baseUrl);
  if (!endpointSupported) return [];
  const variant = findCatalogModel(profile, identity.wireModel, identity.wireModel);
  return [...(variant?.runtimeConstraints?.reasoningEfforts ?? [])];
}
