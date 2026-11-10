// @vitest-environment node
import {expect,it} from 'vitest';
import {createDshDesktopController} from '../../electron/dsh-desktop-controller.js';
it('accepts only fixed original composition handles, never authority callbacks or proxy getters',()=>{
 let calls=0;expect(()=>createDshDesktopController({scope:{profileId:'profile',tenantId:'tenant',workspaceId:'workspace'},realm:{},store:{},userSource:{},runtime:{},sourceOwner:{},authorize(){calls++;}})).toThrow();
 expect(()=>createDshDesktopController(new Proxy({}, {ownKeys(){calls++;return [];},get(){calls++;return undefined;}}))).toThrow();expect(calls).toBe(0);
});
