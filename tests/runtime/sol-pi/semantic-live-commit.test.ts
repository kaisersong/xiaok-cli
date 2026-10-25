import { expect, it } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { computeSessionHistoryDigest } from '../../../src/ai/runtime/session-store/store.js';
it('installs the durable snapshot without replacing the observation owner generation',()=>{
 const session=new AgentSessionState();session.appendUserText('original');
 const source=session.exportSnapshot(),revision=session.planCompaction().sourceRevision,generation=session.getObservationRestoreGeneration();
 const next={...source,storeRevision:2,executionProtected:true as const,messages:[{role:'user' as const,content:[{type:'text' as const,text:'exact anchors plus summary'}]}]};
 const snapshot={...next,historyDigest:computeSessionHistoryDigest(next)};
 session.installCommittedSnapshot({snapshot,expectedRevision:revision,expectedHistoryDigest:computeSessionHistoryDigest(source)});
 expect(session.exportSnapshot().messages).toEqual(next.messages);expect(session.getObservationRestoreGeneration()).toBe(generation);
 expect(session.exportSnapshot().storeRevision).toBe(2);
});
it('rejects stale corrections, wrong session, and an inconsistent persisted digest',()=>{
 const session=new AgentSessionState();session.appendUserText('original');const source=session.exportSnapshot();
 const input={snapshot:{...source,storeRevision:2,historyDigest:computeSessionHistoryDigest(source)},expectedRevision:session.planCompaction().sourceRevision,expectedHistoryDigest:computeSessionHistoryDigest(source)};
 expect(()=>session.installCommittedSnapshot({...input,snapshot:{...input.snapshot,sessionId:'other'}})).toThrow();
 expect(()=>session.installCommittedSnapshot({...input,snapshot:{...input.snapshot,historyDigest:'0'.repeat(64)}})).toThrow();
 session.appendUserText('correction');expect(()=>session.installCommittedSnapshot(input)).toThrow();
 expect(session.getMessages().at(-1)!.content[0]).toMatchObject({text:'correction'});
});
