import {it,expect} from 'vitest';
import {assertPrivateEngineImageStore} from '../../../src/runtime/verification/engine-image-store.js';

it('accepts bounded classic overlay2 facts without granting an engine handle',()=>{
 expect(assertPrivateEngineImageStore({Driver:'overlay2',DriverStatus:[['Backing Filesystem','extfs'],['Supports d_type','true']]})).toBeUndefined();
});
it('rejects other image stores and malformed informational tuples',()=>{
 for(const value of [null,{}, {Driver:'overlayfs',DriverStatus:[]},{Driver:'overlay2'},
  {Driver:'overlay2',DriverStatus:null},{Driver:'overlay2',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]},
  {Driver:'overlay2',DriverStatus:[['driver-type','unknown']]},{Driver:'overlay2',DriverStatus:[['one']]},
  {Driver:'overlay2',DriverStatus:[[1,'value']]},{Driver:'overlay2',DriverStatus:[['key','x'.repeat(1025)]]},
  {Driver:'overlay2',DriverStatus:Array.from({length:65},()=>['key','value'])}]){
  expect(()=>assertPrivateEngineImageStore(value)).toThrow('private_engine_image_store');
 }
});
it('does not invoke proxy traps or accessors while checking the store',()=>{
 let hits=0;
 const proxy=new Proxy({}, {get(){hits++;throw Error('trap');},getOwnPropertyDescriptor(){hits++;throw Error('trap');}});
 const getter={Driver:'overlay2',get DriverStatus(){hits++;return [];}};
 for(const value of [proxy,getter,{Driver:'overlay2',DriverStatus:proxy},
  {Driver:'overlay2',DriverStatus:[proxy]}]) expect(()=>assertPrivateEngineImageStore(value)).toThrow('private_engine_image_store');
 expect(hits).toBe(0);
});
