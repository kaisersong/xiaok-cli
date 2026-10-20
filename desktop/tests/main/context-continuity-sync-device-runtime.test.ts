// @vitest-environment node
import {expect,it,vi} from 'vitest';
const app=vi.hoisted(()=>({getAppPath:vi.fn(()=>{throw new Error('must_not_resolve_resources');}),isPackaged:false}));
vi.mock('electron',()=>({app}));
import {assertDesktopSyncIncoming,openDesktopSyncDevice,type DesktopSyncDeviceOptions,type DesktopSyncDevice} from '../../electron/context-continuity/sync-device-runtime.js';

it('rejects an unqualified non-Electron runtime before options getters, resources, native import or credentials',async()=>{
 const getter=vi.fn(()=>{throw new Error('must_not_read_options');});
 await expect(openDesktopSyncDevice(Object.defineProperty({},'identity',{get:getter})as DesktopSyncDeviceOptions)).rejects.toThrow('desktop_sync_runtime_unqualified');
 expect(getter).not.toHaveBeenCalled();expect(app.getAppPath).not.toHaveBeenCalled();
});
it('does not let a copied device DTO and caller assertion certify an incoming body',()=>{
 const assertion=vi.fn();
 expect(()=>assertDesktopSyncIncoming({kind:'desktop-sync-device',assertIncomingCurrent:assertion}as unknown as DesktopSyncDevice,{})).toThrow('desktop_sync_device_unavailable');
 expect(assertion).not.toHaveBeenCalled();
});
