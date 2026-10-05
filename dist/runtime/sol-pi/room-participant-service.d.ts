import { type KeyObject } from 'node:crypto';
import type { CompositeServiceRegistration } from '../verification/composite-service-registration.js';
/** Uses the original RoomStore and service transactions. Context is supplied only
 * by the installed controller-authenticated IPC composition. */
export declare function createRoomParticipantDispatch(input: {
    store: any;
    roomService: any;
    definition: Readonly<CompositeServiceRegistration>;
    privateKey: KeyObject;
}): (request: any) => any;
