import { createHash, sign } from 'node:crypto';
/** Uses the original RoomStore and service transactions. Context is supplied only
 * by the installed controller-authenticated IPC composition. */
export function createRoomParticipantDispatch(input) {
    const { store, roomService, definition, privateKey } = input, workspace = roomService.workspace;
    // Original Room transactions remain the only author of grants and source leases.
    const existing = store.db.prepare("SELECT value_json FROM room_workspace_records WHERE kind='disclosure-authority' AND record_key='singleton'").get();
    if (existing && JSON.parse(existing.value_json).authorityId !== definition.authorityId)
        throw Error('participant_existing_authority_requires_installer_migration');
    if (!existing)
        store.withTransaction(() => store.db.prepare("INSERT INTO room_workspace_records(kind,record_key,room_id,value_json) VALUES('disclosure-authority','singleton','',?)").run(JSON.stringify({ authorityId: definition.authorityId, protocol: 'disclosure-lease/v1' })));
    const methods = new Set(['registerHost', 'getState', 'beginChange', 'commitBinding', 'activateBinding', 'cancelChange', 'publishInstructions', 'acquireClaim', 'ackClaim', 'cancelClaim', 'heartbeatClaim', 'releasingClaim', 'releaseClaim', 'approveDisclosureGrant', 'prepareDisclosure', 'queryDisclosure']);
    const roomMethods = new Set(['createRoom', 'getCollaborationRoom', 'listCollaborationRooms', 'listRoomMessages', 'sendRoomMessage', 'updateRoomMembers', 'archiveRoom']);
    return (request) => {
        if (roomMethods.has(request.method))
            return roomService[request.method](request.input, request.context);
        if (!methods.has(request.method))
            throw Error('participant_method');
        const result = workspace[request.method](request.input, request.context);
        if (request.method !== 'prepareDisclosure' || !result.ok)
            return result;
        const lease = result.lease, p = definition;
        const payload = { version: 1, domain: 'xiaok.composite.participant.prepared.v1', authorityId: p.authorityId, authorityGeneration: p.instanceEpoch, instanceIncarnation: String(p.instanceEpoch), keyId: p.keyId, egressId: lease.egressId, egressGeneration: lease.egressGeneration, attemptId: lease.attemptId, invocationId: lease.invocationId, bodySha256: lease.bodySha256, destination: lease.destination.url, model: lease.destination.model, protocol: lease.destination.protocol, leaseId: lease.attemptId, evidenceSha256: createHash('sha256').update(JSON.stringify(lease)).digest('hex') };
        const encoded = JSON.stringify(payload, Object.keys(payload).sort()), signature = sign(null, Buffer.from(encoded), privateKey).toString('base64url');
        return { ...result, receipt: Buffer.from('{"payload":' + encoded + ',"signature":' + JSON.stringify(signature) + '}').toString('base64') };
    };
}
