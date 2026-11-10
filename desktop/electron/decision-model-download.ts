import {withDecisionCleanup} from './decision-model-cleanup.js';
import { createHash, Hash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { DecisionModelFile } from '../shared/decision-model-types.js';
import { DecisionModelFiles } from './decision-model-files.js';
import { DecisionModelHttp } from './decision-model-http.js';
const apply = Reflect.apply, update = Hash.prototype.update, digest = Hash.prototype.digest;
const nativeHash = createHash;
function trustedDownload(url: string): string {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || !(u.hostname === 'huggingface.co' || u.hostname === 'cas-bridge.xethub.hf.co' || u.hostname.endsWith('.hf.co') || u.hostname === 'cdn-lfs.huggingface.co'))
        throw Error('download_host');
    return u.href;
}
function hashFor(file: DecisionModelFile) {
    const h = nativeHash(file.algorithm === 'sha256' ? 'sha256' : 'sha1');
    if (file.algorithm === 'git-blob-sha1')
        apply(update, h, [`blob ${file.size}\0`]);
    return h;
}
export async function verifyDecisionFile(path: string, file: DecisionModelFile, files: DecisionModelFiles, signal?: AbortSignal): Promise<boolean> {
    if (!files.exists(path))
        return false;
    const before = files.stamp(path);
    if (before.size !== BigInt(file.size))
        return false;
    const h = hashFor(file), buffer = Buffer.alloc(131072), fd = files.open(path);
    let total = 0, first: {
        raw: unknown;
    } | undefined;
    return await withDecisionCleanup(async () => {
        try {
            for (;;) {
                signal?.throwIfAborted();
                const n = files.read(fd, buffer);
                if (!n)
                    break;
                total += n;
                if (total > file.size)
                    return false;
                apply(update, h, [buffer.subarray(0, n)]);
                if (total % 1048576 === 0)
                    await setImmediate();
            }
            const after = files.stamp(path);
            return before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && total === file.size && apply(digest, h, ['hex']) === file.hash;
        }
        catch (raw) {
            first = { raw };
            throw raw;
        }
    }, async () => {
        try {
            files.close(fd);
        }
        catch (raw) {
            if (first)
                throw new AggregateError([first.raw, raw], 'decision_verify_close', { cause: first.raw });
            throw raw;
        }
    });
}
/** Fixed catalogue caller only. No caller-supplied transport or namespace. */
export async function downloadDecisionFile(url: string, path: string, file: DecisionModelFile, signal: AbortSignal, progress: (bytes: number) => void | Promise<void>, files: DecisionModelFiles): Promise<void> {
    let next = trustedDownload(url), first: {
        raw: unknown;
    } | undefined;
    // Old partial data may only be removed after the same manager's ownership
    // and exact tree/name checks; open never truncates or overwrites a foreign file.
    if (files.exists(path))
        files.unlink(path);
    const h = hashFor(file), fd = files.open(path, true);
    let total = 0, closed = false;
    await withDecisionCleanup(async () => {
        try {
            for (let redirects = 0;; redirects++) {
                signal.throwIfAborted();
                const http = new DecisionModelHttp();
                files.holdHttp(http);
                let requestError: {
                    raw: unknown;
                } | undefined;
                const result = await (async () => {
                    return await withDecisionCleanup(async () => {
                        try {
                            return await http.request(next, { signal, redirect: 'manual' }, file.size, async (bytes) => {
                                signal.throwIfAborted();
                                total += bytes.length;
                                if (total > file.size)
                                    throw Error('size_mismatch');
                                files.write(fd, bytes);
                                apply(update, h, [bytes]);
                                await progress(total);
                            });
                        }
                        catch (raw) {
                            requestError = { raw };
                            throw raw;
                        }
                    }, async () => {
                        try {
                            await files.closeHttp(http);
                        }
                        catch (raw) {
                            if (requestError)
                                throw new AggregateError([requestError.raw, raw], 'decision_redirect_cleanup', { cause: requestError.raw });
                            throw raw;
                        }
                    });
                })();
                if (result.status >= 300 && result.status < 400) {
                    if (!result.location || redirects >= 5)
                        throw Error('download_redirect');
                    next = trustedDownload(new URL(result.location, next).href);
                    continue;
                }
                if (result.status < 200 || result.status >= 300)
                    throw Error('download_failed');
                break;
            }
            if (total !== file.size)
                throw Error('size_mismatch');
            if (apply(digest, h, ['hex']) !== file.hash)
                throw Error('hash_mismatch');
            files.flush(fd);
        }
        catch (raw) {
            first = { raw };
            throw raw;
        }
    }, async () => {
        const failures: unknown[] = [];
        try {
            files.close(fd);
            closed = true;
        }
        catch (raw) {
            failures.push(raw);
        }
        try {
            await files.settle();
        }
        catch (raw) {
            failures.push(raw);
        }
        // An unknown close/HTTP stock retains the root and partial bytes for review.
        if (first && closed && !failures.length) {
            try {
                if (files.exists(path))
                    files.unlink(path);
            }
            catch (raw) {
                failures.push(raw);
            }
        }
        if (failures.length)
            throw new AggregateError(first ? [first.raw, ...failures] : failures, 'decision_download_cleanup', { cause: first ? first.raw : failures[0] });
    });
}
