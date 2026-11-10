import {it,expect} from 'vitest';
import {AssistantCandidatePager} from '../../electron/assistant-candidate-pager.js';
import type {AssistantCandidateDto} from '../../shared/assistant-ipc-contract.js';
const candidates=(count:number):AssistantCandidateDto[]=>Array.from({length:count},(_,i)=>({id:String(i),runId:'run',kind:'memory',title:'title',content:'content',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:String(i)}],dedupeKey:String(i),status:'pending',createdAt:i}));
it('bounds v2 pages and returns stable main-issued read cursors without losing items',()=>{
 const pager=new AssistantCandidatePager(),input=candidates(121),first=pager.page(input);
 expect(first.candidates).toHaveLength(50);expect(first.nextCursor).toBeTruthy();
 const second=pager.page(input,first.nextCursor!);expect(second.candidates).toHaveLength(50);
 expect(pager.page(input,first.nextCursor!)).toEqual(second);
 const third=pager.page(input,second.nextCursor!);expect(third.candidates).toHaveLength(21);expect(third.nextCursor).toBeNull();
 expect([...first.candidates,...second.candidates,...third.candidates].map(c=>c.id)).toEqual(input.map(c=>c.id));
});
it('rejects invented cursors and dataset changes rather than leaking a different page',()=>{
 const pager=new AssistantCandidatePager(),input=candidates(60),first=pager.page(input);
 expect(()=>pager.page(input,'invented')).toThrow('cursor_changed');
 input[0]!.status='accepted';expect(()=>pager.page(input,first.nextCursor!)).toThrow('cursor_changed');
});
it('enforces byte limits without truncating candidate content',()=>{
 const pager=new AssistantCandidatePager(),input=candidates(30);for(const c of input)c.content='x'.repeat(16000);
 const first=pager.page(input);expect(first.candidates.length).toBeLessThan(30);expect(first.candidates.every(c=>c.content.length===16000)).toBe(true);expect(first.nextCursor).toBeTruthy();
});
