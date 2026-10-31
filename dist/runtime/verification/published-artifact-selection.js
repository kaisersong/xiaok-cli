import { ownDataArrayIsArray, ownDataArrayPrototypeIncludes, ownDataArrayPrototypeJoin, ownDataArrayPrototypeSort, ownDataBufferByteLength, ownDataJSONParse, ownDataObjectFreeze, ownDataObjectKeys, ownDataRegExpPrototypeTest } from './application-native-intrinsics.js';
import { canonicalVerificationJson as json } from './protocol.js';
import { applicationDataDescriptors, readApplicationOwnDataField } from './application-value-data.js';
import { captureApplicationData } from './application-value-data.js';
const stringCharCodeAt = String.prototype.charCodeAt, apply = Reflect.apply;
function fields(value, keys) {
    if (!value || typeof value !== 'object' || ownDataArrayIsArray(value) || ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(ownDataObjectKeys(value)), ',') !== ownDataArrayPrototypeJoin(ownDataArrayPrototypeSort(keys), ','))
        throw Error('published_artifact_shape');
}
function identifier(value) {
    if (typeof value !== 'string' || !value || ownDataBufferByteLength(value) > 160 || ownDataRegExpPrototypeTest(/[\x00-\x1f\x7f]/, value))
        throw Error('published_artifact_identity');
}
export function assertPublishedArtifactOwner(value) {
    applicationDataDescriptors(value, 3, 'published_artifact_shape');
    fields(value, ['profileId', 'ownerKind', 'ownerId']);
    identifier(value.profileId);
    identifier(value.ownerId);
    if (!ownDataArrayPrototypeIncludes(['task', 'intent', 'goal', 'loop', 'project'], value.ownerKind))
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
    if (typeof value !== 'string' || !value || value.length > 4096)
        throw Error('published_artifact_path');
    let segmentLength = 0, segmentStart = 0;
    for (let index = 0; index <= value.length; index++) {
        const character = index === value.length ? '/' : value[index], code = apply(stringCharCodeAt, character, [0]);
        if (character === '\\' || code === 58 || code <= 31 || code === 127)
            throw Error('published_artifact_path');
        if (character === '/') {
            if (segmentLength === 0 || segmentLength === 1 && value[segmentStart] === '.' || segmentLength === 2 && value[segmentStart] === '.' && value[segmentStart + 1] === '.')
                throw Error('published_artifact_path');
            segmentLength = 0;
            segmentStart = index + 1;
        }
        else
            segmentLength++;
    }
}
/** A content selector only, never a material/archive grant or a filesystem path. */
export function parsePublishedArtifactSelection(raw) {
    const captured = ownDataJSONParse(json(captureApplicationData(raw, { maximumBytes: 65536, maximumNodes: 65536, invalid: 'published_artifact_shape', limit: 'published_artifact_shape' })));
    assertPublishedArtifactSelection(captured);
    const selection = captured;
    if (selection.kind === 'inherited')
        ownDataObjectFreeze(selection.originOwner);
    return ownDataObjectFreeze(selection);
}
