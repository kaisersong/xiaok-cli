import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { IntentArtifactSelection } from '../runtime/intent-delegation/publication-candidate-journal.js';
export type IntentPublicationCommand = {
    kind: 'draft' | 'status' | 'recover' | 'parent';
} | {
    kind: 'approve';
    path: string;
} | {
    kind: 'retry';
    candidateId: string;
};
const id = (v: unknown): v is string => typeof v === 'string' && !!v && Buffer.byteLength(v) <= 160 && !/[\x00-\x1f\x7f]/.test(v);
export function parseIntentPublicationCommand(input: string): IntentPublicationCommand | null {
    const match = /^\/intent\s+publish(?:\s+(.*))?$/u.exec(input.trim());
    if (!match)
        return null;
    const text = match[1] ?? '';
    if (['draft', 'status', 'recover', 'parent'].includes(text))
        return { kind: text as 'draft' | 'status' | 'recover' | 'parent' };
    const action = /^(approve|retry)\s+(.+)$/u.exec(text);
    if (!action)
        throw Error('intent_publication_command');
    const argument = action[2].startsWith('"') ? JSON.parse(action[2]) : action[2];
    if (typeof argument !== 'string' || !argument || /[\x00-\x1f\x7f]/.test(argument))
        throw Error('intent_publication_command');
    if (action[1] === 'retry') {
        if (!id(argument))
            throw Error('intent_publication_command');
        return { kind: 'retry', candidateId: argument };
    }
    return { kind: 'approve', path: argument };
}
/** Explicit selectors only. Actual membership and original recipe paths are checked by the fixed host/store. */
export function readIntentPublicationSelectionFile(path: string): Readonly<{
    artifactSelections: IntentArtifactSelection[];
}> {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > 65536)
            throw Error('intent_publication_selection_file');
        const bytes = Buffer.alloc(65537);
        let size = 0, count: number;
        do {
            count = readSync(fd, bytes, size, bytes.length - size, null);
            size += count;
        } while (count && size < bytes.length);
        const after = fstatSync(fd);
        if (size > 65536 || after.size !== before.size || size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
            throw Error('intent_publication_selection_file');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
        if (!value || Object.keys(value).join(',') !== 'artifactSelections' || !Array.isArray(value.artifactSelections))
            throw Error('intent_publication_selection');
        const ids = new Set<string>();
        for (const selection of value.artifactSelections) {
            if (!selection || Object.keys(selection).sort().join(',') !== 'artifactId,obligationId,path' || !id(selection.artifactId) || !id(selection.obligationId) || typeof selection.path !== 'string' || !selection.path || /[\x00-\x1f\x7f]/.test(selection.path) || ids.has(selection.artifactId))
                throw Error('intent_publication_selection');
            ids.add(selection.artifactId);
            Object.freeze(selection);
        }
        Object.freeze(value.artifactSelections);
        return Object.freeze(value);
    }
    finally {
        closeSync(fd);
    }
}
