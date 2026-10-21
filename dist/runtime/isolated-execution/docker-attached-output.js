import { request } from 'node:http';
/** Raw untrusted output only. EOF is not a physical tree receipt. */
export async function attachDockerOutput(socketPath, id, options = {}) {
    const { timeoutMs = 300000, maximumBytes = 4 * 1024 ** 2, signal, stdin: sourceInput } = options;
    if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900000 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 ** 2)
        throw Error('docker_attach_arguments');
    if (sourceInput !== undefined && (!Buffer.isBuffer(sourceInput) || sourceInput.length > 2 * 1024 ** 2))
        throw Error('docker_attach_stdin_limit');
    const stdin = sourceInput === undefined ? undefined : Buffer.from(sourceInput);
    let stdinComplete = stdin === undefined;
    signal?.throwIfAborted();
    const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1000000n;
    let readyResolve, readyReject, resolve;
    const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; }), completed = new Promise(yes => { resolve = yes; });
    let attached = false, ended = false, settled = false, source, pending = Buffer.alloc(0), total = 0, frames = 0;
    const stdout = [], stderr = [];
    const finish = (reason) => {
        if (settled)
            return;
        if (!reason && process.hrtime.bigint() >= deadline)
            reason = 'deadline';
        if (!reason && !stdinComplete)
            reason = 'stdin';
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        source?.destroy();
        req.destroy();
        if (!attached)
            readyReject(Error('docker_attach_' + (reason ?? 'transport')));
        resolve(Object.freeze({ complete: reason === undefined, truncated: reason === 'limit', ...(reason ? { reason } : {}), stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    };
    const data = (bytes) => {
        if (settled)
            return;
        if (process.hrtime.bigint() >= deadline) {
            finish('deadline');
            return;
        }
        // Pending is bounded by one allowed body plus its header; oversized announced
        // lengths are rejected before accumulating their body.
        let offset = 0;
        while (offset < bytes.length && !settled) {
            const need = pending.length < 8 ? 8 - pending.length : 8 + pending.readUInt32BE(4) - pending.length;
            const count = Math.min(need, bytes.length - offset);
            pending = Buffer.concat([pending, bytes.subarray(offset, offset + count)]);
            offset += count;
            if (pending.length < 8)
                continue;
            if (![1, 2].includes(pending[0]) || pending[1] !== 0 || pending[2] !== 0 || pending[3] !== 0) {
                finish('frame');
                return;
            }
            const length = pending.readUInt32BE(4);
            if (length > maximumBytes - total || frames >= 4096) {
                finish('limit');
                return;
            }
            if (pending.length === 8 + length) {
                (pending[0] === 1 ? stdout : stderr).push(Buffer.from(pending.subarray(8)));
                total += length;
                frames++;
                pending = Buffer.alloc(0);
            }
        }
    };
    const abort = () => finish('aborted');
    const req = request({ socketPath, path: '/v1.45/containers/' + id + '/attach?stream=1&stdout=1&stderr=1&stdin=' + (stdin === undefined ? '0' : '1'), method: 'POST', headers: { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Length': 0 } });
    const timer = setTimeout(() => finish('deadline'), Math.max(0, Number(deadline - process.hrtime.bigint()) / 1000000));
    function accept(stream, head) {
        if (settled) {
            stream.destroy();
            return;
        }
        source = stream;
        if (stdin !== undefined && typeof stream.write !== 'function') {
            finish('stdin');
            return;
        }
        attached = true;
        stream.on('data', data);
        stream.once('error', () => finish('transport'));
        stream.once('end', () => { ended = true; finish(pending.length ? 'frame' : undefined); });
        stream.once('close', () => { if (!ended)
            finish('transport'); });
        readyResolve();
        if (head?.length)
            data(head);
        if (stdin !== undefined && !settled) {
            try {
                stream.end(stdin, () => { stdinComplete = true; });
            }
            catch {
                finish('stdin');
            }
        }
    }
    req.once('upgrade', (response, socket, head) => { if (response.statusCode !== 101) {
        socket.destroy();
        finish('transport');
        return;
    } accept(socket, head); });
    req.once('response', response => { if (response.statusCode !== 200) {
        response.destroy();
        finish('transport');
        return;
    } accept(response); });
    req.once('error', () => finish('transport'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted)
        abort();
    else
        req.end();
    await ready;
    return Object.freeze({ completed, cancel: abort });
}
