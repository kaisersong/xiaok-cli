import {expect,it} from 'vitest';
import {parseIntentHostSubject,intentHostSubjectHash,intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
const parent={version:1,sessionId:'session-original',intentId:'intent-original',stageId:null};
it('captures a complete actual session subject with no legacy raw-owner fallback',()=>{
 const source={...parent},captured=parseIntentHostSubject(source);source.sessionId='changed';
 expect(captured).toEqual(parent);expect(Object.isFrozen(captured)).toBe(true);
 expect(intentHostSubjectHash(parent)).toBe('cff5abeecef5e936db0a52a8356cd98c5ae30279fefc89c8107cddbffb556dec');
 expect(intentHostSubjectOwner(captured)).toEqual({ownerKind:'intent',ownerId:`intent-subject-v1:${intentHostSubjectHash(parent)}`});
 expect(Object.isFrozen(intentHostSubjectOwner(captured))).toBe(true);
 expect(intentHostSubjectOwner(captured).ownerId).not.toBe(parent.intentId);
});
it('isolates same intent in different sessions and parent versus every stage',()=>{
 const all=[parent,{...parent,sessionId:'second-session'},{...parent,stageId:'stage-1'},{...parent,stageId:'stage-2'},{...parent,intentId:'other-intent'}];
 expect(new Set(all.map(value=>intentHostSubjectHash(value))).size).toBe(all.length);
 expect(new Set(all.map(value=>intentHostSubjectOwner(value).ownerId)).size).toBe(all.length);
});
it('canonical key order is stable while exact identity case and spaces remain distinct',()=>{
 expect(intentHostSubjectHash({stageId:null,intentId:parent.intentId,sessionId:parent.sessionId,version:1})).toBe(intentHostSubjectHash(parent));
 expect(intentHostSubjectHash({...parent,sessionId:' session-original'})).not.toBe(intentHostSubjectHash(parent));
 expect(intentHostSubjectHash({...parent,intentId:'INTENT-original'})).not.toBe(intentHostSubjectHash(parent));
});
it.each([
 {...parent,ownerId:'caller'}, {...parent,profileId:'caller'}, {...parent,goalSessionId:'fake'}, {...parent,invocations:[]},
 {...parent,version:2},{...parent,stageId:undefined},{...parent,stageId:''},{...parent,stageId:{}},
 {...parent,sessionId:'line\nbreak'},{...parent,intentId:'nul\0id'},{...parent,stageId:'delete\x7f'},
 {...parent,sessionId:'中'.repeat(54)},{...parent,intentId:'a'.repeat(161)},
])('rejects unknown fields or invalid identity without normalizing it',value=>expect(()=>parseIntentHostSubject(value)).toThrow());
it('uses UTF-8 byte limits and accepts the actual 160-byte boundary',()=>{
 expect(parseIntentHostSubject({...parent,sessionId:'中'.repeat(53)+'a'}).sessionId).toHaveLength(54);
 expect(parseIntentHostSubject({...parent,stageId:'a'.repeat(160)}).stageId).toHaveLength(160);
});
it('rejects accessors, symbols and class prototypes without invoking code',()=>{
 let calls=0;const getter={...parent,get sessionId(){calls++;return 'changed';}};
 expect(()=>parseIntentHostSubject(getter)).toThrow();expect(calls).toBe(0);
 expect(()=>parseIntentHostSubject({...parent,[Symbol('hidden')]:true})).toThrow();
 expect(()=>parseIntentHostSubject(Object.assign(Object.create({inherited:true}),parent))).toThrow();
});
