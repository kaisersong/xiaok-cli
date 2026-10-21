import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {computeSessionHistoryDigest} from '../../../src/ai/runtime/session-store/store.js';
it('complete publication records the exact committed history, preserving later live input and ignoring metadata-only receipts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'history-basis-'));try{
  const store=new FileSessionStore(root),session=new AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'basis',cwd:root});
  store.onCommit(snapshot=>session.updatePersistenceFacts(snapshot));
  const basis=session.getPublishedHistoryBasis();session.appendUserText('committed intent');const committed=session.exportSnapshot();
  await store.save(committed);session.appendUserText('later queued input');
  expect(session.getPublishedHistoryBasis()).toBe(basis);
  session.notePublishedHistory(committed,basis);
  expect(session.getPublishedHistoryBasis()).toBe(computeSessionHistoryDigest(committed));
  expect(session.exportSnapshot().messages).toHaveLength(2);
  const current=(await store.load('basis'))!;
  await store.save({...current,messages:[{role:'user',content:[{type:'text',text:'foreign durable history'}]}]});
  expect(session.getPublishedHistoryBasis()).toBe(computeSessionHistoryDigest(committed));
  expect(session.exportSnapshot().messages).toHaveLength(2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('atomic full snapshot installation advances the basis without changing restore incarnation',()=>{
 const session=new AgentSessionState();session.appendUserText('before');
 const current=session.exportSnapshot(),revision=session.planCompaction().sourceRevision,incarnation=session.getObservationRestoreGeneration();
 const next={...current,messages:[{role:'user' as const,content:[{type:'text' as const,text:'installed history'}]}],storeRevision:1};
 const durable={...next,historyDigest:computeSessionHistoryDigest(next)};
 session.updatePersistenceFacts(durable);
 session.installCommittedSnapshot({snapshot:durable,expectedRevision:revision,expectedHistoryDigest:computeSessionHistoryDigest(current)});
 expect(session.getPublishedHistoryBasis()).toBe(durable.historyDigest);
 expect(session.exportSnapshot().messages).toEqual(durable.messages);
 expect(session.getObservationRestoreGeneration()).toBe(incarnation);
});
