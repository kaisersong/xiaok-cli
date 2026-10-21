import { expect, it } from 'vitest';
import { buildStrictSemanticSnapshot } from '../../../src/runtime/sol-pi/semantic-snapshot.js';
import { AgentSessionState } from '../../../src/ai/runtime/session.js';
it('empty summary and unknown anchor owner never manufacture deterministic replacement',()=>{
 const session=new AgentSessionState();session.appendUserText('Exact goal '+ 'x'.repeat(10000));session.appendAssistantBlocks([{type:'text',text:'Unresolved issue'}]);
 const sourceSnapshot=session.exportSnapshot(),plan=session.planCompaction(0);
 for(const summaryText of ['', ' ', 'generated summary']){
  expect(()=>buildStrictSemanticSnapshot({sourceSnapshot,plan,summaryText,observationOwner:{} as never,measureInputTokens:()=>1})).toThrow();
 }
 expect(session.getMessages()).toEqual(sourceSnapshot.messages);
});
