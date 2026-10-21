import {it,expect} from 'vitest';
import {createInstalledControllerLifetime} from '../../../src/runtime/verification/installed-controller-lifetime.js';
it('gates unsupported platforms before loading the native database or installed files',()=>{const old=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{value:'win32'});try{expect(()=>createInstalledControllerLifetime()).toThrow('controller_lifetime_platform');}finally{Object.defineProperty(process,'platform',old);}});
it('does not accept a caller-selected root or supplied private key',()=>{expect(()=>(createInstalledControllerLifetime as (...args:unknown[])=>unknown)({stateRoot:'/tmp/fake'})).toThrow('controller_lifetime_arguments');});
