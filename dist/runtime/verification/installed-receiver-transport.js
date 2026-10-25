import { createPublicKey } from 'node:crypto';
import { createReceiverUploadVerifier } from './receiver-upload-authentication.js';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertInstalledReceiverRegistration } from './installed-receiver-registration.js';
import { readControllerSocketAuditPeer } from './socket-peer.js';
import { createReceiverTransport } from './receiver-transport.js';
/** Private fixed installed factory. Neither endpoint nor peer identity comes from RPC. */
export function createInstalledReceiverTransport(lifetime, registration) {
    function current() { assertInstalledControllerLifetime(lifetime); assertInstalledReceiverRegistration(registration, lifetime); }
    current();
    return createReceiverTransport({ socketPath: registration.socketPath, receiverServiceUid: registration.definition.serviceUid, identity: registration.identity, verifier: registration.receiverVerifier, uploadVerifier: createReceiverUploadVerifier({ ...registration.identity, publicKey: createPublicKey(registration.definition.publicKeyPem) }), assertCurrent: current, readPeer: socket => readControllerSocketAuditPeer(socket, lifetime.peerHelper) });
}
