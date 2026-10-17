import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
const MAX_BYTES = 16 * 1024 * 1024;
function fail(reason) { throw Error(`session_delete_compound_${reason}`); }
export function readCompoundDeletionBytes(file, remaining = MAX_BYTES) {
    const before = lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(remaining))
        fail('budget');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > remaining)
            fail('budget');
        const opened = fstatSync(fd, { bigint: true });
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs)
            fail('changed');
        const bytes = Buffer.alloc(stat.size + 1);
        let size = 0;
        while (size < bytes.length) {
            const n = readSync(fd, bytes, size, bytes.length - size, null);
            if (!n)
                break;
            size += n;
        }
        const after = fstatSync(fd, { bigint: true }), path = lstatSync(file, { bigint: true });
        if (size !== stat.size || size > remaining || after.size !== before.size || after.mtimeNs !== before.mtimeNs || path.dev !== before.dev || path.ino !== before.ino || path.size !== before.size || path.mtimeNs !== before.mtimeNs)
            fail('changed');
        return bytes.subarray(0, size);
    }
    finally {
        closeSync(fd);
    }
}
