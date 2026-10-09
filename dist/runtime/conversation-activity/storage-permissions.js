import { chmodSync, lstatSync, readdirSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve, parse } from 'node:path';
/** Bounds work on untrusted or unexpectedly large legacy storage trees. */
const MAX_STORAGE_ENTRIES = 100_000;
/** Tighten legacy storage before any persistent write; never follow links. */
export function secureActivityStorage(root, options = {}) {
    if ((options.platform ?? process.platform) === 'win32')
        return;
    try {
        // Ancestors above the activity tree (home, config dir, macOS /var -> /private/var)
        // belong to the user's environment and may legitimately be links. Only the
        // activity tree itself must be real, owned directories and files.
        root = resolve(root);
        const parent = dirname(root);
        const paths = basename(parent) === 'conversation-activity' ? [parent, root] : [root];
        const verified = [];
        let count = 0;
        while (paths.length) {
            const path = paths.pop();
            if (++count > (options.maxEntries ?? MAX_STORAGE_ENTRIES))
                throw new Error();
            const state = lstatSync(path);
            if (state.isSymbolicLink() || state.uid !== process.getuid?.())
                throw new Error();
            if (state.isSocket())
                continue;
            if (!state.isDirectory() && !state.isFile())
                throw new Error();
            const mode = state.isDirectory() ? 0o700 : 0o600;
            (options.chmodSync ?? chmodSync)(path, mode);
            verified.push([path, mode]);
            // The shared parent is secured without traversing other workspace owners.
            if (state.isDirectory() && path !== parent)
                for (const name of readdirSync(path))
                    paths.push(resolve(path, name));
        }
        for (const [path, mode] of verified) {
            const state = lstatSync(path);
            if (state.isSymbolicLink() || state.uid !== process.getuid?.() || (state.mode & 0o7777) !== mode)
                throw new Error();
        }
    }
    catch {
        throw new Error('activity_storage_not_private');
    }
}
/** Check existing ancestors before recursive mkdir can write through a link. */
export function createPrivateActivityDirectory(root) {
    try {
        if (process.platform !== 'win32') {
            // Refuse to create through a link inside the activity tree. Links above the
            // nearest `conversation-activity` directory are the user's own layout.
            const target = resolve(root);
            const segments = target.split(/[\\/]/);
            const index = segments.lastIndexOf('conversation-activity');
            const floor = index >= 0 ? segments.slice(0, index + 1).join('/') || '/' : target;
            for (let ancestor = target; ancestor.length >= floor.length && ancestor !== parse(ancestor).root; ancestor = dirname(ancestor)) {
                try {
                    if (lstatSync(ancestor).isSymbolicLink())
                        throw new Error('activity_storage_not_private');
                }
                catch (error) {
                    if (error.code !== 'ENOENT')
                        throw error;
                }
                if (ancestor === floor)
                    break;
            }
        }
        mkdirSync(root, { recursive: true, mode: 0o700 });
        secureActivityStorage(root);
    }
    catch {
        throw new Error('activity_storage_not_private');
    }
}
