import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {TimedActionService} from '../../electron/timed-action-service.js';
import {createShutdownAwareTimedActionService} from '../../electron/timed-action-service-lifetime.js';
it('preserves real service ownership checks and denies retained non-IPC tool references after shutdown',()=>{const root=mkdtempSync(join(tmpdir(),'timed-lifetime-')),store=new TimedActionStore(join(root,'timed.sqlite')),gate=new DesktopShutdownGate();const service=createShutdownAwareTimedActionService(new TimedActionService(store),gate);try{
 const reminder=service.createReminder('original',Date.now()+10000, undefined, {requestSource:'user',ownerKind:'user',ownerId:'desktop-user'});expect(service.listReminders()).toHaveLength(1);expect(gate.outstanding).toBe(0);
 expect(service.cancelReminder(reminder.reminderId,{requestSource:'agent'})).toBe(false);expect(service.listReminders()).toHaveLength(1);
 const retained=service.createReminder;gate.close();expect(()=>retained('late',Date.now()+10000)).toThrow('shutting_down');expect(()=>service.listReminders()).toThrow('shutting_down');expect(store.listActions()).toHaveLength(1);expect(gate.outstanding).toBe(0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}});
