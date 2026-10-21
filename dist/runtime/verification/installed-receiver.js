import { join } from 'node:path';
import { createInstalledReceiverLifetime, assertInstalledReceiverLifetime } from './installed-receiver-lifetime.js';
import { createInstalledReceiverClock } from './installed-receiver-clock.js';
import { VerificationReceiverStore } from './receiver-store.js';
import { startReceiverService } from './receiver-service.js';
import { readControllerSocketAuditPeer } from './socket-peer.js';
const unresolvedReceivers = new Set();
/** Fixed independent receiver owner. Listener is last, and unknown construction
 * or drain never authorizes releasing this service's original lifetime lock. */
export async function startInstalledVerificationReceiver() {
    if (arguments.length)
        throw Error('receiver_entry_arguments');
    const lifetime = createInstalledReceiverLifetime();
    let clock, store, server, closing, constructing = true;
    function close() {
        if (closing)
            return closing;
        closing = Promise.resolve().then(async () => {
            try {
                if (constructing)
                    throw Error('receiver_construction_unknown');
                await server?.close();
                store?.close();
                clock?.close();
                lifetime.close();
            }
            catch (error) {
                unresolvedReceivers.add({ lifetime, clock, store, server });
                throw new AggregateError([error], 'receiver_shutdown_unknown');
            }
        });
        return closing;
    }
    try {
        clock = createInstalledReceiverClock(lifetime);
        const actualClock = clock;
        store = new VerificationReceiverStore({ root: lifetime.state, receiverId: lifetime.definition.receiverId, receiverInstanceEpoch: lifetime.definition.receiverInstanceEpoch, clock: () => actualClock.sample() });
        server = await startReceiverService({ socketPath: join(lifetime.base, 'receiver', 'receiver.sock'), controllerServiceUid: lifetime.manifest.serviceUid, identity: lifetime.definition, privateKey: lifetime.privateKey, store, assertCurrent: () => assertInstalledReceiverLifetime(lifetime), readPeer: socket => readControllerSocketAuditPeer(socket, lifetime.peerHelper) });
        constructing = false;
        return Object.freeze({ close });
    }
    catch (error) {
        try {
            await close();
        }
        catch (cleanup) {
            throw new AggregateError([error, cleanup], 'receiver_start_unknown');
        }
        throw error;
    }
}
