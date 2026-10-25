import { createPublishedArtifactIndex, publishedArtifactLookupKeys, assertPublishedArtifactIndexOwner, findIndexedPublishedArtifacts, verifyIndexedPublishedArtifact } from './published-artifact-index.js';
import { parseIntentApplicationBinding } from './intent-application-binding.js';
import { intentHostSubjectOwner } from './intent-host-subject.js';
import { assertPublishedArtifactOwner } from './published-artifact-selection.js';
/** Compare declared candidate artifacts with actual exported verification bytes.
 * This content check grants neither read access nor completion authority. */
export function assertIntentApplicationArtifacts(applicationOwner, raw, payloadOwner, sections) {
    const binding = parseIntentApplicationBinding(raw), keys = new Set();
    for (const descriptor of binding.body.artifacts)
        for (const key of publishedArtifactLookupKeys(applicationOwner, descriptor.selection, true))
            keys.add(key);
    assertIndexedIntentApplicationArtifacts(applicationOwner, binding, payloadOwner, createPublishedArtifactIndex(payloadOwner, sections, keys));
}
export function assertIndexedIntentApplicationArtifacts(applicationOwner, raw, payloadOwner, index) {
    assertPublishedArtifactOwner(applicationOwner);
    assertPublishedArtifactOwner(payloadOwner);
    const binding = parseIntentApplicationBinding(raw), mapped = intentHostSubjectOwner(binding.subject);
    if (applicationOwner.ownerKind !== mapped.ownerKind || applicationOwner.ownerId !== mapped.ownerId)
        throw Error('intent_application_artifact_owner');
    assertPublishedArtifactIndexOwner(index, payloadOwner);
    for (const descriptor of binding.body.artifacts) {
        const selection = descriptor.selection, target = selection.kind === 'local' ? applicationOwner : selection.originOwner;
        if (target.profileId !== applicationOwner.profileId)
            throw Error('intent_application_artifact_owner');
        const matches = findIndexedPublishedArtifacts(index, applicationOwner, selection, true);
        if (matches.length !== 1)
            throw Error('intent_application_artifact_not_unique');
        const artifact = matches[0];
        if (artifact.sha256 !== descriptor.sha256 || artifact.size !== descriptor.size || typeof artifact.bytesBase64 !== 'string'
            || artifact.bytesBase64.length !== 4 * Math.ceil(descriptor.size / 3))
            throw Error('intent_application_artifact_content');
        try {
            verifyIndexedPublishedArtifact(index, artifact);
        }
        catch {
            throw Error('intent_application_artifact_content');
        }
    }
}
