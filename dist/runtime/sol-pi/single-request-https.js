import { request as httpsRequest } from 'node:https';
const rejected = () => new Error('SEMANTIC_SINGLE_REQUEST_REJECTED');
/**
 * Low-level transport, not an authorization issuer. Product callers must first bind a
 * durable budget and disclosure capability. One instance permits one HTTP request.
 * Core HTTPS has no HTTP redirect/retry machinery; using global fetch here is unsafe.
 */
export function createSingleRequestHttpsFetch(options) {
    const { destination: destinationInput, expectedBody, method: configuredMethod, signal, timeoutMs, maxResponseBytes, certificateAuthority: ca, trackPhysicalDrain } = options;
    const destination = new URL(destinationInput);
    if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash
        || destination.href !== destinationInput || typeof expectedBody !== 'string'
        || Buffer.byteLength(expectedBody) > 16 * 1024 * 1024
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000
        || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1
        || maxResponseBytes > 16 * 1024 * 1024)
        throw rejected();
    const expectedMethod = configuredMethod ?? 'POST';
    if (!['POST', 'GET'].includes(expectedMethod) || expectedMethod === 'GET' && expectedBody !== '')
        throw rejected();
    let claimed = false;
    return async (input, init) => {
        if (claimed)
            throw rejected();
        // Claim synchronously. Request/stream bodies are never consumed by this transport.
        claimed = true;
        if (input instanceof Request)
            throw rejected();
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url !== destination.href || method !== expectedMethod)
            throw rejected();
        const inputSignal = init?.signal;
        const combined = AbortSignal.any([signal, inputSignal].filter((s) => !!s));
        combined.throwIfAborted();
        const body = expectedMethod === 'GET' && init?.body === undefined ? '' : init?.body;
        combined.throwIfAborted();
        if (typeof body !== 'string' || body !== expectedBody)
            throw rejected();
        const headers = new Headers(init?.headers);
        // Content length, Host, connection and compression are transport facts, not caller claims.
        for (const name of ['host', 'content-length', 'transfer-encoding', 'connection', 'expect', 'upgrade'])
            headers.delete(name);
        headers.set('content-length', String(Buffer.byteLength(body)));
        headers.set('accept-encoding', 'identity');
        headers.set('connection', 'close');
        return new Promise((resolve, reject) => {
            let request, response;
            let controller;
            let done = false, received = 0;
            let requestClosed = Promise.resolve();
            let socketClosed = Promise.resolve();
            let responseClosed = Promise.resolve();
            let completion;
            // Request close also fences a socket assigned after cancellation. The socket
            // and response promises are read afterwards, rather than frozen too early.
            const drain = async () => { await requestClosed; await socketClosed; await responseClosed; };
            const closed = (handle) => new Promise(resolveClose => handle.once('close', resolveClose));
            const clear = () => { clearTimeout(timer); combined.removeEventListener('abort', abort); };
            const fail = (error) => {
                if (done)
                    return completion;
                done = true;
                clear();
                request?.destroy();
                response?.destroy();
                completion = drain().then(() => {
                    try {
                        controller?.error(error);
                    }
                    catch { /* Reader may already have cancelled. */ }
                    reject(error);
                });
                return completion;
            };
            const abort = () => fail(new DOMException('Summary request aborted', 'AbortError'));
            const timer = setTimeout(() => fail(new Error('SEMANTIC_SINGLE_REQUEST_TIMEOUT')), timeoutMs);
            combined.addEventListener('abort', abort, { once: true });
            if (combined.aborted) {
                abort();
                return;
            }
            try {
                const requestOptions = {
                    method: expectedMethod, headers: Object.fromEntries(headers), agent: false,
                    // Fixed HTTP/1.1. No HTTP/2 upgrade, proxy agent, socket reuse, or retry path.
                    ALPNProtocols: ['http/1.1'], rejectUnauthorized: true,
                    ...(ca === undefined ? {} : { ca }),
                };
                request = httpsRequest(destination, requestOptions, incoming => {
                    response = incoming;
                    responseClosed = closed(incoming);
                    if (done) {
                        incoming.destroy();
                        return;
                    }
                    const status = incoming.statusCode ?? 0;
                    if (status < 200 || status > 599 || incoming.headers['content-encoding']
                        && incoming.headers['content-encoding'] !== 'identity') {
                        fail(rejected());
                        return;
                    }
                    const responseHeaders = new Headers();
                    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
                        responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
                    const stream = new ReadableStream({
                        start(c) { controller = c; },
                        cancel() { return fail(new DOMException('Summary response cancelled', 'AbortError')); },
                    });
                    incoming.on('data', (chunk) => {
                        if (done)
                            return;
                        received += chunk.byteLength;
                        if (received > maxResponseBytes) {
                            fail(new Error('SEMANTIC_SINGLE_RESPONSE_TOO_LARGE'));
                            return;
                        }
                        try {
                            controller.enqueue(new Uint8Array(chunk));
                        }
                        catch {
                            fail(rejected());
                        }
                    });
                    incoming.on('end', () => {
                        if (done)
                            return;
                        done = true;
                        clear();
                        request?.destroy();
                        incoming.destroy();
                        completion = drain().then(() => { try {
                            controller?.close();
                        }
                        catch { /* Cancelled reader. */ } });
                    });
                    incoming.on('error', () => fail(new Error('SEMANTIC_SINGLE_RESPONSE_INTERRUPTED')));
                    incoming.on('aborted', () => fail(new Error('SEMANTIC_SINGLE_RESPONSE_INTERRUPTED')));
                    try {
                        const noBody = [204, 205, 304].includes(status);
                        const result = new Response(noBody ? null : stream, { status, headers: responseHeaders });
                        if (noBody)
                            void drain().then(() => resolve(result));
                        else
                            resolve(result);
                    }
                    catch {
                        fail(rejected());
                    }
                });
                requestClosed = closed(request);
                request.on('socket', socket => { socketClosed = closed(socket); });
                request.on('error', () => fail(new Error('SEMANTIC_SINGLE_REQUEST_FAILED')));
                trackPhysicalDrain?.(drain());
                combined.throwIfAborted();
                request.end(body);
            }
            catch {
                fail(rejected());
            }
        });
    };
}
