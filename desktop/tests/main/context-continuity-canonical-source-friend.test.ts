// @vitest-environment node
import {expect,it} from 'vitest';
import * as runtime from '../../electron/context-continuity/sync-device-runtime.js';
import * as friend from '../../electron/context-continuity/sync-canonical-source-friend.js';
it('rejects caller raw owner/wrapper DTOs and proxies before reading any source proof',()=>{
 let reads=0;const proof=Object.defineProperty({},'kind',{get(){reads++;throw new Error('caller proof getter');}});
 for(const device of [{kind:'desktop-sync-device'},new Proxy({},{}),{}]){
  expect(()=>runtime.assertOriginalDesktopSyncRawOwner(device as never,{})).toThrow('desktop_sync_device_unavailable');
  expect(()=>friend.assertCanonicalSourceForRawOwner({},device as never,{},proof)).toThrow('desktop_sync_device_unavailable');
 }expect(reads).toBe(0);
});
it('never accepts a caller payload producer or index as source authority',()=>{
 for(const raw of [{kind:'os-device-owner'},new Proxy({},{}),{}])expect(()=>friend.readCanonicalSourcePayloadForRawOwner(raw,{}as never,{},{}as never,0)).toThrow('desktop_sync_device_unavailable');
});
