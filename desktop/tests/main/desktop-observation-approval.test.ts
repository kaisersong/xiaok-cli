// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDesktopObservationApprovals, consumeDesktopObservationApproval } from '../../electron/desktop-observation-approval.js';
describe('Desktop observation main private approvals',()=>{
 it('requires separate extra-call consent for semantic compaction and refuses a declined experiment',async()=>{
  const kinds:string[]=[];
  const approvals=createDesktopObservationApprovals({selectPolicy:async()=>({policy:{} as any,summary:{semanticCompaction:{mode:'mechanism-experiment'}} as any}),confirm:async(_sender,_summary,kind)=>{kinds.push(kind);return kind!=='semantic';}});
  expect(await approvals.prepare({})).toBeNull();
  expect(kinds).toEqual(['persistence','disclosure','semantic']);
 });
 it('requires both native confirmations and binds a single-use draft to the actual sender',async()=>{
  const policy={} as any, summary={} as any, sender={}, other={};let confirmations=0;
  const approvals=createDesktopObservationApprovals({selectPolicy:async()=>({policy,summary}),confirm:async()=>{confirmations++;return true;}});
  const draft=await approvals.prepare(sender);expect(confirmations).toBe(2);
  expect(()=>approvals.consume(other,draft!.draftId)).toThrow(/sender/);
  const capability=approvals.consume(sender,draft!.draftId);expect(consumeDesktopObservationApproval(capability)).toBe(policy);
  expect(()=>consumeDesktopObservationApproval(capability)).toThrow(/approval/);expect(()=>approvals.consume(sender,draft!.draftId)).toThrow(/draft/);
 });
 it('rejects expiry, sender destruction, and false or truthy-string consent',async()=>{
  let now=0;const sender={};let answer:any=true;
  const approvals=createDesktopObservationApprovals({now:()=>now,selectPolicy:async()=>({policy:{} as any,summary:{} as any}),confirm:async()=>answer});
  const first=await approvals.prepare(sender);now=300001;expect(()=>approvals.consume(sender,first!.draftId)).toThrow(/draft/);
  const second=await approvals.prepare(sender);approvals.destroySender(sender);expect(()=>approvals.consume(sender,second!.draftId)).toThrow(/draft/);
  answer='true';expect(await approvals.prepare({})).toBeNull();
 });
});

it('requires explicit native confirmation for the compound experiment',async()=>{
 const kinds:string[]=[];const approvals=createDesktopObservationApprovals({selectPolicy:async()=>({policy:{} as any,summary:{compoundExecution:{version:1,mode:'mechanism-experiment'}} as any}),confirm:async(_sender,_summary,kind)=>{kinds.push(kind);return kind!=='compound';}});
 expect(await approvals.prepare({})).toBeNull();expect(kinds).toEqual(['persistence','disclosure','compound']);
});
