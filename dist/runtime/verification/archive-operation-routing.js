/** Fixed private composition adapter. Caller supplies the kernel peer; payload
 * source is passed unchanged to the actual native-authorization service. */
export function createArchiveOperationRouting(operations, ensureQualified) {
    const renew = ensureQualified;
    const list = operations.list.bind(operations), deleteArchive = operations.deleteArchive.bind(operations);
    const prepare = operations.prepare.bind(operations), authorize = operations.authorize.bind(operations), read = operations.read.bind(operations), close = operations.closeHandle.bind(operations);
    return Object.freeze({ async invoke(method, payload, peer, signal) {
            signal.throwIfAborted();
            if (!['archive.list', 'archive.prepare', 'archive.authorize', 'archive.read', 'archive.delete', 'archive.close'].includes(method))
                throw Error('controller_archive_method');
            await renew(signal);
            signal.throwIfAborted();
            if (method === 'archive.list')
                return list(payload, peer, signal);
            if (method === 'archive.prepare')
                return prepare(payload, peer, signal);
            if (method === 'archive.authorize')
                return authorize(payload, peer, signal);
            if (method === 'archive.read')
                return read(payload, peer, signal);
            if (method === 'archive.delete')
                return deleteArchive(payload, peer, signal);
            if (method === 'archive.close') {
                close(payload, peer);
                return Object.freeze({ closed: true });
            }
            throw Error('controller_archive_method');
        } });
}
