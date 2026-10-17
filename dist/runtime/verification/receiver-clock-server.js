import { startControllerIpc } from './controller-ipc.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Private root composition only; authenticateReceiver revalidates the fixed
 * registration on every accept and dispatch. This never extends broker.sock. */
export function startReceiverClockServer(input) {
    const { socketPath, authenticateReceiver, assertReceiver, sample } = input;
    function check(uid) { const result = assertReceiver(uid); if (result !== undefined) {
        if (result && typeof result.then === 'function')
            void Promise.resolve(result).catch(() => { });
        throw Error('receiver_clock_async_authority');
    } }
    return startControllerIpc({ socketPath, requestTimeoutMs: 5000, publicPeerAuthenticated: true, acceptPeer(socket) { const uid = authenticateReceiver(socket); if (!Number.isSafeInteger(uid) || uid < 1)
            throw Error('receiver_clock_peer'); check(uid); return uid; }, async dispatch(body, _signal, peer) {
            check(peer);
            const r = JSON.parse(body.toString());
            if (!r || Object.keys(r).sort().join(',') !== 'method,payload,version' || r.version !== 1 || r.method !== 'clock.sample' || !r.payload || Object.keys(r.payload).join(',') !== 'nonce' || typeof r.payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(r.payload.nonce) || !Buffer.from(json(r)).equals(body))
                throw Error('receiver_clock_request');
            const value = sample();
            check(peer);
            return Buffer.from(json({ version: 1, nonce: r.payload.nonce, sample: value }));
        } });
}
