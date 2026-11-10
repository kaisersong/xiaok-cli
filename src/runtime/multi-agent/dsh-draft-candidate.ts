import { createHash, Hash } from 'node:crypto';
import { captureDispatchBusinessData } from '../conversation-activity/dispatch-business-data.js';
import { dshAFields, dshAHash, type DshARecord } from './dsh-admission-data.js';
const apply = Reflect.apply, keys = Reflect.ownKeys, define = Object.defineProperty, create = Object.create;
const byteLength = Buffer.byteLength, charCodeAt = String.prototype.charCodeAt;
const update = Hash.prototype.update, digest = Hash.prototype.digest, nativeHash = createHash;
const inputFields = ['schemaVersion', 'scope', 'thread', 'bindingId', 'generation', 'ownerWorkId', 'draftCommitKey', 'artifactId', 'draftInvocationId', 'attemptId', 'expectedOwnerVersion', 'authority', 'manifest', 'budgetCommitProof', 'content'] as const;
export interface DshDraftCandidate extends Readonly<DshARecord> {
    readonly content: Readonly<{
        kind: 'dsh_model_text_v1';
        text: string;
        contentHash: string;
    }>;
    readonly payloadHash: string;
    readonly attemptPayloadHash: string;
}
function data(target: object, key: PropertyKey, value: unknown): void {
    define(target, key, { __proto__: null, value, enumerable: true } as PropertyDescriptor);
}
function omit(value: DshARecord, excluded: readonly string[]): DshARecord {
    const out = create(null) as DshARecord, names = keys(value);
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        let skip = false;
        for (let j = 0; j < excluded.length; j++)
            if (name === excluded[j])
                skip = true;
        if (!skip)
            data(out, name, value[name as string]);
    }
    return out;
}
function contentHash(text: unknown): string {
    if (typeof text !== 'string' || apply(byteLength, Buffer, [text, 'utf8']) > 65536)
        throw Error('DSH_DRAFT_CONTENT_INVALID');
    for (let i = 0; i < text.length; i++) {
        const code = apply(charCodeAt, text, [i]) as number;
        if (code === 0)
            throw Error('DSH_DRAFT_CONTENT_INVALID');
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = apply(charCodeAt, text, [++i]) as number;
            if (!(next >= 0xdc00 && next <= 0xdfff))
                throw Error('DSH_DRAFT_CONTENT_INVALID');
        }
        else if (code >= 0xdc00 && code <= 0xdfff)
            throw Error('DSH_DRAFT_CONTENT_INVALID');
    }
    const hash = nativeHash('sha256');
    apply(update, hash, [text, 'utf8']);
    return apply(digest, hash, ['hex']) as string;
}
/** Pure wire bytes only. The original Source must separately authenticate the
 * accepted slot, exact model output and original finalized ledger receipt. */
export function buildDshDraftCandidate(raw: unknown): DshDraftCandidate {
    const value = captureDispatchBusinessData(raw) as DshARecord;
    dshAFields(value, inputFields);
    const content = value.content as DshARecord;
    dshAFields(content, ['kind', 'text']);
    if (content.kind !== 'dsh_model_text_v1')
        throw Error('DSH_DRAFT_CONTENT_INVALID');
    const actualHash = contentHash(content.text), candidate = omit(value, ['content']);
    data(candidate, 'content', { kind: content.kind, text: content.text, contentHash: actualHash });
    const semantic = omit(candidate, ['attemptId', 'expectedOwnerVersion', 'authority', 'content']);
    data(semantic, 'content', { kind: content.kind, contentHash: actualHash, contentRef: 'dsh-content:' + dshAHash(value.draftCommitKey) });
    data(semantic, 'authority', omit(value.authority as DshARecord, ['commandId', 'expectedOwnerVersion', 'attemptPayloadHash']));
    const payloadHash = dshAHash(['dsh-draft-payload-v1', semantic]);
    data(candidate, 'payloadHash', payloadHash);
    data(candidate, 'attemptPayloadHash', dshAHash(['dsh-draft-attempt-v1', candidate]));
    return captureDispatchBusinessData(candidate) as unknown as DshDraftCandidate;
}
