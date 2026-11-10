import {it,expect} from 'vitest';
import {projectForwardDigest,parseProjectForwardStamp} from '../../../src/runtime/conversation-activity/project-forward-snapshot-data.js';
it('keeps object key order insignificant and array order significant',()=>{
 expect(projectForwardDigest({b:[1,2],a:0})).toBe(projectForwardDigest({a:0,b:[1,2]}));expect(projectForwardDigest([1,2])).not.toBe(projectForwardDigest([2,1]));
});
it('rejects a sparse array whose extra numeric property impersonates a dense array',()=>{
 const value=new Array(1);Object.defineProperty(value,'4294967295',{value:1,enumerable:true});expect(()=>projectForwardDigest(value)).toThrow('activity_project_forward_data_invalid');
});
it('rejects custom serialization, cycles and non JSON primitives without invoking them',()=>{
 let calls=0;const custom={toJSON(){calls++;return {};}};expect(()=>projectForwardDigest(custom)).toThrow();expect(calls).toBe(0);const cycle:unknown[]=[];cycle.push(cycle);expect(()=>projectForwardDigest(cycle)).toThrow();for(const value of [undefined,NaN,Infinity,1n,Symbol(),()=>{}])expect(()=>projectForwardDigest(value)).toThrow();
});
it('rejects excessive bytes and nesting before a transport stamp can be parsed',()=>{
 expect(()=>projectForwardDigest('x'.repeat(2*1024*1024+1))).toThrow();let deep:unknown=0;for(let i=0;i<66;i++)deep=[deep];expect(()=>projectForwardDigest(deep)).toThrow();expect(()=>parseProjectForwardStamp({protocol:2})).toThrow();
});
