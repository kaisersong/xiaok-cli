// @vitest-environment node
import {expect,it} from 'vitest';
import {createRoomTurnCustody} from '../../electron/original-room-turn-custody.js';
it('keeps the original known negative while a read-only physical join can finish',async()=>{
 const c=createRoomTurnCustody(),raw=Error('original negative');await expect(c.sdk(()=>Promise.reject(raw),undefined,[])).rejects.toBe(raw);
 await c.waitPhysicalKnown();c.assertPhysicalKnown();await expect(c.waitKnown()).rejects.toBe(raw);expect(()=>c.current()).toThrow(raw);
});
it('keeps an original own/symbol rejection tail held and never treats unknown input as physically known',async()=>{
 const c=createRoomTurnCustody();let release!:()=>void;const tail=new Promise<void>(yes=>{release=yes;}),raw=Object.assign(Error('negative with tail'),{[Symbol('original-tail')]:tail});await expect(c.sdk(()=>Promise.reject(raw),undefined,[])).rejects.toBe(raw);
 let done=false;const physical=c.waitPhysicalKnown().then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);expect(()=>c.assertPhysicalKnown()).toThrow();release();await physical;c.assertPhysicalKnown();await expect(c.waitKnown()).rejects.toBe(raw);
 const unknown=createRoomTurnCustody();unknown.inventory(new Proxy({},{}));await expect(unknown.waitPhysicalKnown()).rejects.toThrow('UNCONFIRMED');expect(()=>unknown.assertPhysicalKnown()).toThrow('UNCONFIRMED');
});
