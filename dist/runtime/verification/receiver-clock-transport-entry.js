import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { parseInstalledDeploymentManifest } from './deployment-manifest.js';
import { parseInstalledReceiverRegistration } from './installed-receiver-registration.js';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { readControllerSocketPeer } from './socket-peer.js';
import { callControllerIpc } from './controller-ipc.js';
import { canonicalVerificationJson as json } from './protocol.js';
async function main() {
    if (process.argv.length !== 2 || process.platform !== 'darwin')
        throw Error('receiver_clock_platform');
    const base = '/Library/Application Support/xiaok-verification';
    function read(name) { const p = join(base, name); assertRootProtectedFile(p); if (lstatSync(p).size > 65536)
        throw Error('receiver_clock_config'); return readFileSync(p); }
    const db = read('deployment.json'), rb = read('receiver.json'), m = parseInstalledDeploymentManifest(JSON.parse(db.toString())), r = parseInstalledReceiverRegistration(JSON.parse(rb.toString()), { controllerPublicKey: createPublicKey(m.publicKeyPem), controllerServiceUid: m.serviceUid, interactiveUids: m.allowedUserIds });
    const helper = join(base, 'releases', m.packageHash, 'bin/socket-peer');
    assertRootProtectedExecutable(helper);
    function current() { if (process.getuid?.() !== r.serviceUid || process.geteuid?.() !== r.serviceUid || !read('deployment.json').equals(db) || !read('receiver.json').equals(rb))
        throw Error('receiver_clock_identity'); }
    current();
    const chunks = [];
    let total = 0;
    for await (const part of process.stdin) {
        const b = Buffer.from(part);
        if ((total += b.length) > 256)
            throw Error('receiver_clock_input');
        chunks.push(b);
    }
    const nonce = Buffer.concat(chunks).toString('ascii');
    if (!/^[a-f0-9]{64}$/.test(nonce))
        throw Error('receiver_clock_nonce');
    const socketPath = join(base, 'receiver-clock.sock');
    assertRootProtectedFile(join(base, 'deployment.json'));
    const stat = lstatSync(socketPath);
    if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== 0)
        throw Error('receiver_clock_socket');
    const result = await callControllerIpc(socketPath, Buffer.from(json({ version: 1, method: 'clock.sample', payload: { nonce } })), { timeoutMs: 5000, verifyServerPeer(socket) { current(); assertRootProtectedExecutable(helper); if (readControllerSocketPeer(socket, helper).uid !== 0)
            throw Error('receiver_clock_server'); } });
    current();
    process.stdout.write(result);
}
void main().catch(() => { process.stderr.write('receiver_clock_transport_unknown\n'); process.exitCode = 1; });
