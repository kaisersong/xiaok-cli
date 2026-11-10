// @vitest-environment node
import {expect,it} from 'vitest';
import {createMainDshAdmissionCoordinator,readOriginalMainDshAdmissionCoordinator} from '../../electron/main-dsh-admission-coordinator.js';
it('refuses foreign coordinator identities without evaluating caller methods or Proxy traps',()=>{
 let reads=0;const foreign=new Proxy({},{get(){reads++;throw Error('foreign');},ownKeys(){reads++;throw Error('foreign');},getOwnPropertyDescriptor(){reads++;throw Error('foreign');}});
 expect(()=>createMainDshAdmissionCoordinator(foreign)).toThrow();
 expect(()=>readOriginalMainDshAdmissionCoordinator(foreign,foreign,foreign,foreign,foreign)).toThrow();
 expect(()=>createMainDshAdmissionCoordinator({realm:{},store:foreign,runtime:{},budgetSource:{},businessSource:{},modelSource:{}})).toThrow();
 expect(reads).toBe(0);
});
