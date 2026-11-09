// @vitest-environment node
import {expect,it} from 'vitest';
import {assistantDerivedHash,captureAssistantDerivedValue} from '../../electron/assistant-derived-data.js';
it('captures ordinary optional fields and hashes stable data without invoking serializers',()=>{
 const raw={a:1,absent:undefined,nested:{b:['中文',null,true]}};expect(captureAssistantDerivedValue(raw)).toEqual({a:1,nested:{b:['中文',null,true]}});expect(assistantDerivedHash(raw)).toBe(assistantDerivedHash({nested:{b:['中文',null,true]},a:1}));expect(Object.isFrozen(captureAssistantDerivedValue(raw).nested.b)).toBe(true);
 let calls=0;expect(()=>captureAssistantDerivedValue({toJSON(){calls++;return {};}})).toThrow();expect(calls).toBe(0);
});
it('rejects proxy/accessor/symbol/cycle data before granting a lineage or executing a trap',()=>{
 let traps=0;const proxy=new Proxy({value:1},{get(){traps++;throw Error('trap');},getPrototypeOf(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}}),getter=Object.defineProperty({},'value',{enumerable:true,get(){traps++;throw Error('getter');}});
 expect(()=>captureAssistantDerivedValue(proxy)).toThrow();expect(()=>captureAssistantDerivedValue({nested:proxy})).toThrow();expect(()=>captureAssistantDerivedValue(getter)).toThrow();expect(traps).toBe(0);
 expect(()=>captureAssistantDerivedValue({[Symbol('unknown')]:1})).toThrow();const cycle:any={};cycle.self=cycle;expect(()=>captureAssistantDerivedValue(cycle)).toThrow();expect(()=>captureAssistantDerivedValue([undefined])).toThrow();
});
