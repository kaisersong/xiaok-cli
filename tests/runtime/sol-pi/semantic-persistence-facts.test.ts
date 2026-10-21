import { expect, it } from 'vitest';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
import { computeSessionHistoryDigest } from '../../../src/ai/runtime/session-store/store.js';
it('store notifications update durable facts without overwriting queued input or invalidating a boundary',()=>{
 const session=new AgentSessionState();session.appendUserText('original');const durable=session.exportSnapshot();
 session.appendUserText('queued correction');const revision=session.planCompaction().sourceRevision,generation=session.getObservationRestoreGeneration();
 session.updatePersistenceFacts({...durable,storeRevision:3,executionProtected:true,historyDigest:computeSessionHistoryDigest(durable)});
 expect(session.exportSnapshot().storeRevision).toBe(3);expect(session.getMessages()).toHaveLength(2);
 expect(session.planCompaction().sourceRevision).toBe(revision);expect(session.getObservationRestoreGeneration()).toBe(generation);
 expect(()=>session.updatePersistenceFacts({...durable,storeRevision:2,historyDigest:computeSessionHistoryDigest(durable)})).toThrow();
 expect(()=>session.updatePersistenceFacts({...durable,sessionId:'other',storeRevision:4,historyDigest:computeSessionHistoryDigest(durable)})).toThrow();
});
