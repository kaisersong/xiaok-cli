import {expect,it} from 'vitest';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';

it('keeps UTF16 order for numeric object keys including array-index boundaries',()=>{
 const value=Object.fromEntries([['4294967295','ordinary'],['2','two'],['4294967294','index'],['00','double'],['10','ten'],['0','zero'],['-0','neg']]);
 expect(json(value)).toBe('{"-0":"neg","0":"zero","00":"double","10":"ten","2":"two","4294967294":"index","4294967295":"ordinary"}');
});
it('keeps numeric-key ordering throughout mixed nested arrays and objects',()=>{
 const value={omega:[{gamma:{2:'b',10:'a'},beta:'x'}],alpha:{2:0,10:[{z:2,a:1}]}};
 expect(json(value)).toBe('{"alpha":{"10":[{"a":1,"z":2}],"2":0},"omega":[{"beta":"x","gamma":{"10":"a","2":"b"}}]}');
});
it.each(['ordinary','numeric'] as const)('preserves the original depth500 for arrays and %s records',kind=>{
 let value:any=kind==='numeric'?{2:2,10:10}:{z:2,a:1};const base=kind==='numeric'?'{"10":10,"2":2}':'{"a":1,"z":2}';
 for(let i=0;i<500;i++)value=[value];expect(json(value)).toBe('['.repeat(500)+base+']'.repeat(500));
});
it('keeps native null-prototype typed-array snapshots and numeric key order',()=>{
 const value=new Uint8Array(12);value[2]=2;value[10]=10;Object.setPrototypeOf(value,null);
 expect(json(value)).toBe('{"0":0,"1":0,"10":10,"11":0,"2":2,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0}');
});
it.each(['accessor','cycle'] as const)('rejects the current array child before a later hole: %s',kind=>{
 const value:any=new Array(2);let reads=0;
 if(kind==='accessor')value[0]=Object.defineProperty({},'secret',{get(){reads++;return 1;}});else {value[0]={};value[0].self=value[0];}
 expect(()=>json(value)).toThrow(kind==='accessor'?'verification_accessor_denied':'verification_invalid_record');expect(reads).toBe(0);
});
it('checks the full array descriptor set before an earlier scalar invalidity',()=>{
 const value:any=[undefined];let reads=0;Object.defineProperty(value,'ignored',{get(){reads++;return 1;}});
 expect(()=>json(value)).toThrow('verification_accessor_denied');expect(reads).toBe(0);
});
it('preserves scalar JSON including well formed lone surrogates and negative zero',()=>{
 expect(json({z:'\ud800',a:[-0,'😀','中文','\0\n"\\']})).toBe('{"a":[0,"😀","中文","\\u0000\\n\\\"\\\\"],"z":"\\ud800"}');
});
