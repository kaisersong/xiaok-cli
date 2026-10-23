import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompositeEgressDispatch } from './composite-egress-dispatch.js';
import { createRoomParticipantDispatch } from './room-participant-service.js';
import { createInstalledCompositeLifetime } from '../verification/installed-composite-lifetime.js';
import { readInstalledEgressConfiguration } from '../verification/deployment-egress-configuration.js';
import { startControllerIpc } from '../verification/controller-ipc.js';
import { readControllerSocketAuditPeer } from '../verification/socket-peer.js';
import { createCompositeEgressService } from './composite-egress-service.js';
const unresolved = new Set();
async function listen(lifetime, dispatch) { return startControllerIpc({ socketPath: join(lifetime.base, lifetime.definition.kind, lifetime.definition.kind + '.sock'), publicPeerAuthenticated: true, requestTimeoutMs: 150000, acceptPeer(socket) { lifetime.assertCurrent(); const peer = readControllerSocketAuditPeer(socket, lifetime.peerHelper); if (peer.uid !== lifetime.manifest.serviceUid)
        throw Error('composite_controller_peer'); return peer; }, async dispatch(bytes, signal) { lifetime.assertCurrent(); signal.throwIfAborted(); const result = await dispatch(JSON.parse(bytes.toString('utf8'))); lifetime.assertCurrent(); return Buffer.from(JSON.stringify(result ?? null)); } }); }
export async function startInstalledCompositeEgress() {
    if (arguments.length)
        throw Error('egress_entry_arguments');
    const lifetime = createInstalledCompositeLifetime('egress');
    let service, server, closing;
    try {
        const configuration = readInstalledEgressConfiguration(lifetime), targets = configuration.targets;
        const p = lifetime.pair.participant;
        service = createCompositeEgressService({ root: join(lifetime.state, 'journal'), egressId: lifetime.definition.authorityId, generation: lifetime.definition.instanceEpoch, participant: { authorityId: p.authorityId, authorityGeneration: p.instanceEpoch, instanceIncarnation: String(p.instanceEpoch), keyId: p.keyId, publicKeyPem: p.publicKeyPem }, targets, assertCurrent() { lifetime.assertCurrent(); configuration.assertCurrent(); } });
        const actual = service;
        server = await listen(lifetime, createCompositeEgressDispatch(actual));
        return Object.freeze({ close() { return closing ??= Promise.resolve().then(async () => { try {
                await server.close();
                await actual.close();
                lifetime.close();
            }
            catch (error) {
                unresolved.add({ lifetime, service, server });
                throw error;
            } }); } });
    }
    catch (error) {
        try {
            await server?.close();
            await service?.close();
            lifetime.close();
        }
        catch (cleanup) {
            unresolved.add({ lifetime, service, server });
            throw new AggregateError([error, cleanup], 'egress_start_cleanup_unresolved');
        }
        throw error;
    }
}
export async function startInstalledRoomParticipant() {
    if (arguments.length)
        throw Error('participant_entry_arguments');
    const lifetime = createInstalledCompositeLifetime('participant');
    let store, server, closing;
    try {
        const moduleRoot = join(lifetime.release, 'participant-runtime', 'room');
        const { createRoomStore } = await import(pathToFileURL(join(moduleRoot, 'store.js')).href);
        const { createRoomService } = await import(pathToFileURL(join(moduleRoot, 'service.js')).href);
        store = createRoomStore({ dbPath: join(lifetime.state, 'rooms.sqlite'), storageBudget: { databaseBytes: 64 * 1024 ** 2 } });
        store.migrate();
        const roomService = createRoomService({ store }), workspace = roomService.workspace;
        server = await listen(lifetime, createRoomParticipantDispatch({ store, roomService, definition: lifetime.definition, privateKey: lifetime.privateKey }));
        return Object.freeze({ close() { return closing ??= Promise.resolve().then(async () => { try {
                await server.close();
                store.close();
                lifetime.close();
            }
            catch (error) {
                unresolved.add({ lifetime, store, server });
                throw error;
            } }); } });
    }
    catch (error) {
        try {
            await server?.close();
            store?.close();
            lifetime.close();
        }
        catch (cleanup) {
            unresolved.add({ lifetime, store, server });
            throw new AggregateError([error, cleanup], 'participant_start_cleanup_unresolved');
        }
        throw error;
    }
}
