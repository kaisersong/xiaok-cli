// @vitest-environment node
import {it,vi,expect} from 'vitest';
const h=vi.hoisted(()=>({construct:vi.fn(),show:vi.fn(),on:vi.fn()}));
vi.mock('electron',()=>({Notification:class{static isSupported(){return true}constructor(input:unknown){h.construct(input)}show=h.show;on=h.on;}}));
import {createElectronDesktopNotificationPort} from '../../electron/desktop-notifications.js';
it('checks the host predicate after async import and before constructing an OS notification',async()=>{const p=createElectronDesktopNotificationPort();let active=true;const first=p.show({title:'Synthetic',body:'No real notification',beforeShow:()=>active});active=false;expect(await first).toMatchObject({ok:false,skipped:true});expect(h.construct).not.toHaveBeenCalled();expect(await p.show({title:'Old caller',body:'Fixture'})).toMatchObject({ok:true});expect(h.show).toHaveBeenCalledTimes(1);});
