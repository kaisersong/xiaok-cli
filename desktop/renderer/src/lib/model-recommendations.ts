import { getDesktopApi } from '../shared/desktop';

type CatalogProvider = {
  id: string;
  defaultModel: string;
  availableModels?: { model: string }[];
};

/** The main process owns the maintained catalog; external discoveries require a manual choice. */
export function currentRecommendedModelIds(providers: CatalogProvider[], providerId?: string): Set<string> {
  return new Set(providers.filter(profile => !providerId || profile.id === providerId)
    .flatMap(profile => [profile.defaultModel, ...(profile.availableModels ?? []).map(model => model.model)]));
}

export async function loadCurrentRecommendedModelIds(providerId?: string): Promise<Set<string>> {
  try {
    const snapshot = await getDesktopApi()?.getModelConfig();
    return snapshot ? currentRecommendedModelIds(snapshot.providerProfiles, providerId) : new Set();
  } catch {
    return new Set();
  }
}
