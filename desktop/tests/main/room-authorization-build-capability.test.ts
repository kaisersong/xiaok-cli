import { expect, it } from 'vitest';
import { ROOM_AUTHORIZATION_PROJECTION_CAPABLE, selectRoomAuthorizationReadMode } from '../../electron/room-authorization-build-capability.js';
it('ordinary builds deny projection even when requested through the environment',()=>{
  expect(ROOM_AUTHORIZATION_PROJECTION_CAPABLE).toBe(false);
  expect(selectRoomAuthorizationReadMode(ROOM_AUTHORIZATION_PROJECTION_CAPABLE,'projection')).toEqual({activeMode:'legacy',capabilityDenied:true});
});
it('capable builds remain opt-in',()=>{
  expect(selectRoomAuthorizationReadMode(true,undefined).activeMode).toBe('legacy');
  expect(selectRoomAuthorizationReadMode(true,'projection').activeMode).toBe('projection');
});
