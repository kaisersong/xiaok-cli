import { extname } from 'node:path';

/**
 * Selects candidate System A artifacts for scoring.
 * Matching is by normalized kind and/or file extension — never by creator
 * (runtime creator values are 'agent'/'kswarm'/producerAgent and carry no
 * skill:/tool: provenance).
 */
export function selectArtifacts(signals, artifactMatch) {
  const artifacts = Array.isArray(signals?.artifacts) ? signals.artifacts : [];
  const kindAnyOf = artifactMatch?.kindAnyOf;
  const extensionAnyOf = artifactMatch?.extensionAnyOf;
  if (!kindAnyOf && !extensionAnyOf) return artifacts;
  return artifacts.filter(artifact => {
    const kindMatch = Array.isArray(kindAnyOf)
      && kindAnyOf.includes(artifact.kind);
    const ext = extname(artifact.filePath ?? '').toLowerCase();
    const extMatch = Array.isArray(extensionAnyOf)
      && extensionAnyOf.some(candidate => candidate.toLowerCase() === ext);
    return kindMatch || extMatch;
  });
}
