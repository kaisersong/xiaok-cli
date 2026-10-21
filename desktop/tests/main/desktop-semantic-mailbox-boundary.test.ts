// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopMultiAgentTurnMailbox,MultiAgentCommandSequencer,captureDesktopMailboxSemanticBoundary,bindDesktopMailboxSemanticAlias} from '../../electron/desktop-multi-agent-mailbox.js';
const cleanup:Array<()=>void>=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'semantic-mailbox-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'groups.sqlite'),store=new DesktopMultiAgentStore(path);cleanup.push(()=>store.close());
 store.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
 const group=store.createGroup('thread'),agentId=`root_${group.groupId}`,commands=new MultiAgentCommandSequencer();
 let active=true;
 const mailbox=new DesktopMultiAgentTurnMailbox({store,groupId:group.groupId,agentId,turnId:'turn',commands,
  assertCurrent(){if(!active)throw Error('old_actor');},onSeal(){}});
 const send=()=>store.sendMessage(group.groupId,{sender:{kind:'user',actorId:'profile'},receiverId:agentId,text:'actual input'});
 return {store,path,group,agentId,mailbox,commands,send,revoke(){active=false;}};
}
it('only the original queued mailbox and its registered wrapper issue stable boundaries; copied objects cannot',async()=>{
 const f=fixture();
 const guard=await captureDesktopMailboxSemanticBoundary(f.mailbox);expect(guard).toBeTypeOf('function');guard!();
 const alias={drainInput:()=>f.mailbox.drainInput(),confirmApplied:(id:string)=>f.mailbox.confirmApplied(id),returnClaim:(id:string)=>f.mailbox.returnClaim(id),trySealTurn:()=>f.mailbox.trySealTurn()};
 await expect(captureDesktopMailboxSemanticBoundary(alias)).rejects.toThrow(/untrusted/);
 bindDesktopMailboxSemanticAlias(alias,f.mailbox);
 (await captureDesktopMailboxSemanticBoundary(alias))!();
 await expect(captureDesktopMailboxSemanticBoundary({...alias})).rejects.toThrow(/untrusted/);
 expect(()=>bindDesktopMailboxSemanticAlias(alias,f.mailbox)).toThrow(/already/);
 f.revoke();expect(guard).toThrow('old_actor');
});
it('unread and consuming inputs block; actual confirmApplied restores eligibility without accepting the old boundary',async()=>{
 const f=fixture(),old=await captureDesktopMailboxSemanticBoundary(f.mailbox);
 f.send();expect(old).toThrow(/changed/);
 expect(await captureDesktopMailboxSemanticBoundary(f.mailbox)).toBeUndefined();
 const batch=await f.mailbox.drainInput();expect(batch.claimId).toBeTruthy();
 expect(await captureDesktopMailboxSemanticBoundary(f.mailbox)).toBeUndefined();
 await f.mailbox.confirmApplied(batch.claimId!);
 (await captureDesktopMailboxSemanticBoundary(f.mailbox))!();expect(old).toThrow(/changed/);
});
it('approval ABA, an external connection commit, sealing and store close invalidate the captured actual facts',async()=>{
 const f=fixture(),db=new DatabaseSync(f.path);cleanup.push(()=>db.close());
 const initial=await captureDesktopMailboxSemanticBoundary(f.mailbox);
 db.prepare('UPDATE thread_bindings SET pending_approval_count=1,thread_revision=thread_revision+1 WHERE thread_id=?').run('thread');
 expect(await captureDesktopMailboxSemanticBoundary(f.mailbox)).toBeUndefined();
 db.prepare('UPDATE thread_bindings SET pending_approval_count=0,thread_revision=thread_revision+1 WHERE thread_id=?').run('thread');
 expect(initial).toThrow(/changed/);
 const after=await captureDesktopMailboxSemanticBoundary(f.mailbox);after!();
 await f.mailbox.trySealTurn();expect(after).toThrow(/sealed/);
 const second=fixture(),closing=await captureDesktopMailboxSemanticBoundary(second.mailbox);
 second.store.close();expect(closing).toThrow();
});
it('capture is sequenced after already queued input mutations',async()=>{
 const f=fixture();const write=f.commands.run(()=>f.send());
 const pending=captureDesktopMailboxSemanticBoundary(f.mailbox);await write;
 expect(await pending).toBeUndefined();
});
it('the original group publication journal can persist its exact closure without impersonating a new mailbox input',async()=>{
 const f=fixture(),guard=await captureDesktopMailboxSemanticBoundary(f.mailbox);
 f.store.putOperation({groupId:f.group.groupId,operationId:'publication',command:'observation_reference',requestHash:'actual-fixed-reference',applyState:'applied',result:{state:'completed'}});
 expect(guard).not.toThrow();
 f.send();expect(guard).toThrow(/changed/);
});
