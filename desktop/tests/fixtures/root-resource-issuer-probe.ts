// Actual Node child used only for resource-contract crash/issuer tests. No native
// qualification, model/tool launch, physical-exit proof or producer registration.
import {createHash} from 'node:crypto';
import {createRootResourceJournal} from '../../electron/desktop-root-resource-store.js';
const [mode,path]=process.argv.slice(2),authority=Object.freeze({});
const subject={executionKey:'original',payloadHash:createHash('sha256').update('input').digest('hex'),executionClass:'kswarm_direct',priorityClass:'background',scope:{profileId:'profile',workspaceId:'workspace',principalId:'principal'},subject:{kind:'kswarm_task',projectId:'project',taskId:'task',runId:'run'},authorizationRef:'original-user-authorization'};
let journal:ReturnType<typeof createRootResourceJournal>|undefined;
try{
 journal=createRootResourceJournal({path,authority,capacity:1,issuer:{hostId:'contract-host',hostBootId:'contract-boot',runtimeEpoch:1},verifySubject:()=>subject,isEligible:()=>true,verifyExit:()=>{throw Error('no_native_exit_authority');}});
 if(mode!=='commit_then_wait')throw Error('unexpected_issuer_accepted');
 const ctx={requestSource:'scheduler' as const,authority};journal.enqueueRoot(Object.freeze({}),ctx);const claim=journal.claimNext(ctx);
 process.stdout.write(JSON.stringify({kind:'committed_original_claim',pid:process.pid,recordId:claim?.recordId,claimToken:claim?.claimToken})+'\n');
 setInterval(()=>{},1000);
}catch(error){
 const message=(error as Error).message;journal?.close();
 process.stdout.write(JSON.stringify({kind:'constructor_rejected',pid:process.pid,error:message})+'\n');
 process.exitCode=mode==='conflicting_issuer'&&message==='root_issuer_conflict'?0:1;
}
