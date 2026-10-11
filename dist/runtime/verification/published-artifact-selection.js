import { canonicalVerificationJson as json } from './protocol.js';
import { applicationDataDescriptors, readApplicationOwnDataField } from './application-value-data.js';
import { captureApplicationData } from './application-value-data.js';
function fields(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('published_artifact_shape'); }
function identifier(value) { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value))
    throw Error('published_artifact_identity'); }
export function assertPublishedArtifactOwner(value) {
    applicationDataDescriptors(value, 3, 'published_artifact_shape');
    fields(value, ['profileId', 'ownerKind', 'ownerId']);
    identifier(value.profileId);
    identifier(value.ownerId);
    if (!['task', 'intent', 'goal', 'loop', 'project'].includes(value.ownerKind))
        throw Error('published_artifact_owner');
}
export function assertPublishedArtifactSelection(value) {
    applicationDataDescriptors(value, 5, 'published_artifact_shape');
    const kind = readApplicationOwnDataField(value, 'kind', 'published_artifact_shape');
    if (kind.kind !== 'data')
        throw Error('published_artifact_shape');
    const selection = value;
    fields(selection, kind.value === 'local' ? ['kind', 'obligationId', 'path'] : kind.value === 'inherited' ? ['kind', 'obligationId', 'path', 'originOwner', 'originalObligationId'] : []);
    if (kind.value !== 'local' && kind.value !== 'inherited')
        throw Error('published_artifact_selection');
    identifier(selection.obligationId);
    assertPublishedArtifactPath(selection.path);
    if (kind.value === 'inherited') {
        assertPublishedArtifactOwner(selection.originOwner);
        identifier(selection.originalObligationId);
    }
}
export function assertPublishedArtifactPath(value) {
    if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part)))
        throw Error('published_artifact_path');
}
/** A content selector only, never a material/archive grant or a filesystem path. */
export function parsePublishedArtifactSelection(raw) {
    const captured = JSON.parse(json(captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'published_artifact_shape', limit: 'published_artifact_shape' })));
    assertPublishedArtifactSelection(captured);
    const selection = captured;
    if (selection.kind === 'inherited')
        Object.freeze(selection.originOwner);
    return Object.freeze(selection);
}
