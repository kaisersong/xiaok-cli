import {createApplicationReviewRegistry} from './application-review-registry.js';
import {applicationBindingReviewBytes} from './application-binding-review.js';
import {createProfileSourceCustodyRegistry} from './profile-source-custody-registry.js';
import {authorizeApplicationBinding} from './application-binding-authorization.js';
import {authorizeArchiveOperation} from './archive-operation-authorization.js';
import {createPublicationReviewRegistry,consumePublicationReview} from './publication-review-registry.js';
import {parseVerificationTuple} from './protocol.js';
import {authorizePublicationOperation} from './publication-operation-authorization.js';
import {startReceiverClockServer} from './receiver-clock-server.js';
import {parseInstalledReceiverRegistration} from './installed-receiver-registration.js';
import {readControllerSocketPeer} from './socket-peer.js';
import {assertMaterialDeadline} from './material-deadline.js';
import {authorizeOwnerEnrollment} from './owner-enrollment-authorization.js';
import {createInstalledLocalContinuousClock} from './continuous-clock.js';
import {parseInstalledDeploymentManifest} from './deployment-manifest.js';
import {readFileSync,lstatSync,realpathSync,existsSync,unlinkSync,mkdirSync} from 'node:fs';
import {join,relative,isAbsolute,parse} from 'node:path';
import {createHash,createPublicKey} from 'node:crypto';
import {assertRootProtectedFile,assertRootProtectedExecutable} from './installed-identity.js';
import {parseDeploymentPackageInventory,verifyDeploymentPackage} from './deployment-package.js';
import {readControllerSocketAuditPeer} from './socket-peer.js';
import {startControllerIpc} from './controller-ipc.js';
import {runBrokerHelper} from './broker-process.js';
import {openPrivateVerificationDatabase} from './private-database.js';
import {canonicalVerificationJson} from './protocol.js';
import {syncDirectoryTreeStrict} from '../../utils/atomic-file.js';
const retainedBrokerLocks=new Set<ReturnType<typeof openPrivateVerificationDatabase>>();
function shape(value:unknown,keys:string[]):asserts value is Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw Error('broker_schema');}
function asciiJson(value:unknown){return canonicalVerificationJson(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
/** Installed root-only daemon. No public caller can choose paths, helpers, commands
 * or environment. This function does not install itself or request elevation. */
export async function startInstalledMacRootBroker():Promise<{close():Promise<void>}>{
 if(process.platform!=='darwin'||process.getuid?.()!==0||process.geteuid?.()!==0)throw Error('broker_root_identity');
 const base='/Library/Application Support/xiaok-verification',configPath=join(base,'deployment.json');assertRootProtectedFile(configPath);
 const configBytes=readFileSync(configPath);if(configBytes.length>65536)throw Error('broker_config');const config=parseInstalledDeploymentManifest(JSON.parse(configBytes.toString()));
 const allowed=new Set<number>(config.allowedUserIds),serviceUid=config.serviceUid,releaseRoot=join(base,'releases',config.packageHash),inventoryPath=join(base,'releases',config.packageHash+'.json');assertRootProtectedFile(inventoryPath);
 const inventory=parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath,'utf8')));if(inventory.packageHash!==config.packageHash)throw Error('broker_package');verifyDeploymentPackage(releaseRoot,inventory);
 const helper=(name:string)=>{const path=join(releaseRoot,'bin',name);assertRootProtectedExecutable(path);return path;};
 const peerHelper=helper('socket-audit-peer'),reader=helper('broker-user-reader'),authorizer=helper('broker-authorize'),clock=createInstalledLocalContinuousClock(helper('continuous-clock'));assertRootProtectedExecutable('/bin/launchctl');
 const root=join(base,'broker');if(!existsSync(root))mkdirSync(root,{mode:0o700});const rootStat=lstatSync(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==0||(rootStat.mode&0o077)!==0)throw Error('broker_root_directory');
 const lock=openPrivateVerificationDatabase(root);const maxPages=Math.floor(1024**2/Number(lock.pragma('page_size',{simple:true})));if(Number(lock.pragma(`max_page_count=${maxPages}`,{simple:true}))>maxPages){lock.close();throw Error('broker_lock_budget');}let sourceRegistry:ReturnType<typeof createProfileSourceCustodyRegistry>|undefined;let publicationRegistry:ReturnType<typeof createPublicationReviewRegistry>|undefined;let applicationRegistry:ReturnType<typeof createApplicationReviewRegistry>|undefined;let ipc:Awaited<ReturnType<typeof startControllerIpc>>|undefined,receiverClock:Awaited<ReturnType<typeof startReceiverClockServer>>|undefined;
 try{
  lock.exec('BEGIN EXCLUSIVE');syncDirectoryTreeStrict(root);
  // Parent is root-owned but searchable; private state remains0700. Peer gate is kernel authenticated.
  const accountHelper=helper('account-generation'),enrollmentAuthorizer=helper('broker-enroll-authorize'),publicationAuthorizer=helper('broker-publish-authorize'),archiveAuthorizer=helper('broker-archive-authorize'),applicationAuthorizer=helper('broker-application-authorize'),sourceAuthorizer=helper('broker-source-authorize');
  const socketPath=join(base,'broker.sock');if(existsSync(socketPath)){const stat=lstatSync(socketPath);if(!stat.isSocket()||stat.uid!==0)throw Error('broker_socket_unknown');unlinkSync(socketPath);syncDirectoryTreeStrict(base);}
  const receiverPath=join(base,'receiver.json');assertRootProtectedFile(receiverPath);if(lstatSync(receiverPath).size>65536)throw Error('receiver_clock_registration');
  const receiverBytes=readFileSync(receiverPath),receiver=parseInstalledReceiverRegistration(JSON.parse(receiverBytes.toString()),{controllerPublicKey:createPublicKey(config.publicKeyPem),controllerServiceUid:serviceUid,interactiveUids:config.allowedUserIds});let receiverInvalid=false;
  const clockPeerHelper=helper('socket-peer'),clockSocket=join(base,'receiver-clock.sock');
  function assertReceiver(uid:number){if(receiverInvalid)throw Error('receiver_clock_registration_changed');try{assertRootProtectedFile(configPath);assertRootProtectedFile(receiverPath);if(!readFileSync(configPath).equals(configBytes)||!readFileSync(receiverPath).equals(receiverBytes))throw Error('receiver_clock_registration_changed');}catch(error){receiverInvalid=true;throw error;}if(uid!==receiver.serviceUid)throw Error('receiver_clock_peer');}
  if(existsSync(clockSocket)){const stat=lstatSync(clockSocket);if(!stat.isSocket()||stat.uid!==0)throw Error('receiver_clock_socket_unknown');unlinkSync(clockSocket);syncDirectoryTreeStrict(base);}
  receiverClock=await startReceiverClockServer({socketPath:clockSocket,authenticateReceiver(socket){assertRootProtectedExecutable(clockPeerHelper);return readControllerSocketPeer(socket,clockPeerHelper).uid;},assertReceiver,sample:clock.sample});
  const processHelper=helper('process-observation');
  publicationRegistry=createPublicationReviewRegistry({now:()=>clock.sample().upperBound,async observe(peer){const bytes=await runBrokerHelper({executable:processHelper,args:[String(peer.pid)],maximumOutput:4096,timeoutMs:5000,signal:new AbortController().signal});const fact=JSON.parse(bytes.toString('utf8'));if(fact.pid!==peer.pid||fact.uid!==peer.uid||fact.realUid!==peer.uid||typeof fact.startIdentity!=='string')throw Error('broker_process_identity');return fact.startIdentity;}});
  applicationRegistry=createApplicationReviewRegistry({authorityId:config.authorityId,clock(){assertRootProtectedFile(configPath);if(!readFileSync(configPath).equals(configBytes))throw Error('broker_config_changed');return clock.sample();},async resolveAccount(uid){assertRootProtectedExecutable(accountHelper);const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal:new AbortController().signal});const facts=JSON.parse(bytes.toString('utf8'));shape(facts,['uid','accountGeneration','source']);if(facts.uid!==uid||facts.source!=='macos-local-generateduid')throw Error('broker_account_identity');return facts.accountGeneration;},async observe(peer){assertRootProtectedExecutable(processHelper);const bytes=await runBrokerHelper({executable:processHelper,args:[String(peer.pid)],maximumOutput:4096,timeoutMs:5000,signal:new AbortController().signal});const fact=JSON.parse(bytes.toString('utf8'));if(fact.pid!==peer.pid||fact.uid!==peer.uid||fact.realUid!==peer.uid||typeof fact.startIdentity!=='string')throw Error('broker_process_identity');return fact.startIdentity;}});
  sourceRegistry=createProfileSourceCustodyRegistry({authorityId:config.authorityId,allowedUserIds:config.allowedUserIds,directoryHelper:helper('broker-source-lock-custody'),sqliteHelper:helper('broker-source-sqlite-custody'),
   clock(){assertRootProtectedFile(configPath);if(!readFileSync(configPath).equals(configBytes))throw Error('broker_config_changed');return clock.sample();},
   async observe(peer,signal){assertRootProtectedExecutable(processHelper);const bytes=await runBrokerHelper({executable:processHelper,args:[String(peer.pid)],maximumOutput:4096,timeoutMs:5000,signal});const fact=JSON.parse(bytes.toString('utf8'));if(fact.pid!==peer.pid||fact.uid!==peer.uid||fact.realUid!==peer.uid||typeof fact.startIdentity!=='string')throw Error('broker_process_identity');return fact.startIdentity;},
   async resolveAccount(uid,signal){assertRootProtectedExecutable(accountHelper);const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal});const fact=JSON.parse(bytes.toString('utf8'));shape(fact,['uid','accountGeneration','source']);if(fact.uid!==uid||fact.source!=='macos-local-generateduid')throw Error('broker_account_identity');return fact.accountGeneration;},
   async approve(input,signal){assertRootProtectedExecutable(sourceAuthorizer);const bytes=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(input.uid),sourceAuthorizer,String(input.uid),String(input.auditSessionId),String(input.continuousDeadlineMs)],stdin:input.reviewBytes,maximumOutput:128,timeoutMs:120000,signal});return bytes.toString('ascii').trim();},
  });
  ipc=await startControllerIpc({socketPath,requestTimeoutMs:120000,publicPeerAuthenticated:true,
   acceptPeer(socket){const peer=readControllerSocketAuditPeer(socket,peerHelper);if(peer.uid!==serviceUid)throw Error('broker_caller');return peer;},
   async dispatch(body,signal,caller){
    const request=JSON.parse(body.toString('utf8'));const peer=caller as {uid:number;gid:number;pid:number;auditSessionId:number};
    if(request?.schemaVersion===1){if(!Buffer.from(canonicalVerificationJson(request)).equals(body))throw Error('broker_schema');const tuple=parseVerificationTuple(request),sample=clock.sample();if(tuple.clockDomainId!==sample.domainId||tuple.clockQualificationEpoch!==sample.qualificationEpoch)throw Error('broker_clock_domain');return Buffer.from(canonicalVerificationJson(await publicationRegistry!.register(tuple,peer)));}
    shape(request,['version','method','payload']);if(request.version!==1||!Buffer.from(canonicalVerificationJson(request)).equals(body))throw Error('broker_schema');const p=request.payload;
    const execute=async()=>{
    if(request.method==='principal.resolve'){
     shape(p,['uid','gid','auditSessionId']);if(!allowed.has(p.uid)||!Number.isSafeInteger(p.gid)||p.gid<0||!Number.isSafeInteger(p.auditSessionId)||p.auditSessionId<1)throw Error('broker_user');
     const bytes=await runBrokerHelper({executable:accountHelper,args:[String(p.uid)],maximumOutput:1024,timeoutMs:5000,signal});
     const facts=JSON.parse(bytes.toString('utf8'));shape(facts,['uid','accountGeneration','source']);if(facts.uid!==p.uid||facts.source!=='macos-local-generateduid'||typeof facts.accountGeneration!=='string'||!/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(facts.accountGeneration))throw Error('broker_account_identity');
     return Buffer.from(canonicalVerificationJson({...facts,gid:p.gid,auditSessionId:p.auditSessionId}));
    }
    if(request.method==='clock.sample'){shape(p,[]);return Buffer.from(canonicalVerificationJson(clock.sample()));}
    if(request.method==='sources.authorize'){shape(p,['requestSource','review']);if(p.requestSource!=='user')throw Error('profile_source_authorization_source');return Buffer.from(canonicalVerificationJson(await sourceRegistry!.authorize(p.review,peer,signal)));}
    if(request.method==='sources.capture'){shape(p,['challengeId','reviewHash']);return Buffer.from(canonicalVerificationJson(await sourceRegistry!.capture({challengeId:p.challengeId,reviewHash:p.reviewHash},peer,signal)));}
    if(request.method==='sources.manifest'){shape(p,['handle','offset','length']);const bytes=await sourceRegistry!.readManifest(p.handle,p.offset,p.length,peer,signal);return Buffer.from(canonicalVerificationJson({offset:p.offset,bytes:bytes.toString('base64')}));}
    if(request.method==='sources.file'){shape(p,['handle','sourceId','entryIndex','offset','length']);const bytes=await sourceRegistry!.readFile(p.handle,p.sourceId,p.entryIndex,p.offset,p.length,peer,signal);return Buffer.from(canonicalVerificationJson({offset:p.offset,bytes:bytes.toString('base64')}));}
    if(request.method==='sources.page'){shape(p,['handle','sourceId','pageNo']);const bytes=await sourceRegistry!.readSqlitePage(p.handle,p.sourceId,p.pageNo,peer,signal);return Buffer.from(canonicalVerificationJson({pageNo:p.pageNo,bytes:bytes.toString('base64')}));}
    if(request.method==='sources.check'){shape(p,['handle']);await sourceRegistry!.check(p.handle,peer,signal);return Buffer.from('{}');}
    if(request.method==='sources.release'){shape(p,['handle']);await sourceRegistry!.release(p.handle,peer);return Buffer.from('{}');}
    if(request.method==='application.registerReview'){shape(p,['review']);return Buffer.from(canonicalVerificationJson(await applicationRegistry!.register(p.review,peer,signal)));}
    if(request.method==='application.releaseReview'){shape(p,['ticket','reviewHash']);if(body.length>65536)throw Error('broker_application_metadata');await applicationRegistry!.release(p.ticket,p.reviewHash,peer);return Buffer.from('{}');}
    if(request.method==='application.authorize'){
     let review:unknown,assertCaller:undefined|(()=>Promise<void>);
     if(Object.hasOwn(p,'ticket')){shape(p,['requestSource','ticket','reviewHash']);if(body.length>65536||p.requestSource!=='user')throw Error('broker_application_metadata');const prepared=await applicationRegistry!.consume(p.ticket,p.reviewHash,peer);review=prepared.review;assertCaller=prepared.assertCaller;}
     else {shape(p,['requestSource','review']);if(applicationBindingReviewBytes(p.review).length>65536)throw Error('broker_application_registration_required');review=p.review;}
     await assertCaller?.();
     const result=await authorizeApplicationBinding(review,{requestSource:p.requestSource,authorityId:config.authorityId,allowedUserIds:config.allowedUserIds,signal,clock:()=>{assertRootProtectedFile(configPath);if(!readFileSync(configPath).equals(configBytes))throw Error('broker_config_changed');return clock.sample();},
      async resolveAccount(uid,signal){const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal});const value=JSON.parse(bytes.toString('utf8'));shape(value,['uid','accountGeneration','source']);if(value.uid!==uid||value.source!=='macos-local-generateduid')throw Error('broker_account_identity');return value.accountGeneration;},
      async approve(input,signal){await assertCaller?.();const bytes=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(input.uid),applicationAuthorizer,String(input.uid),String(input.auditSessionId),String(input.continuousDeadlineMs)],stdin:input.reviewBytes,maximumOutput:128,timeoutMs:120000,signal});await assertCaller?.();return bytes.toString('ascii').trim();},
     });await assertCaller?.();return Buffer.from(canonicalVerificationJson(result));
    }
    if(request.method==='archive.authorize'){
     shape(p,['requestSource','review']);
     const result=await authorizeArchiveOperation(p.review,{requestSource:p.requestSource,authorityId:config.authorityId,allowedUserIds:config.allowedUserIds,signal,clock:()=>{assertRootProtectedFile(configPath);if(!readFileSync(configPath).equals(configBytes))throw Error('broker_config_changed');return clock.sample();},
      async resolveAccount(uid,signal){const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal});const value=JSON.parse(bytes.toString('utf8'));shape(value,['uid','accountGeneration','source']);if(value.uid!==uid||value.source!=='macos-local-generateduid')throw Error('broker_account_identity');return value.accountGeneration;},
      async approve(input,signal){const bytes=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(input.uid),archiveAuthorizer,String(input.uid),String(input.auditSessionId),String(input.continuousDeadlineMs)],stdin:input.reviewBytes,maximumOutput:128,timeoutMs:120000,signal});return bytes.toString('ascii').trim();},
     });return Buffer.from(canonicalVerificationJson(result));
    }
    if(request.method==='enrollment.authorize'){
     shape(p,['review']);
     const result=await authorizeOwnerEnrollment(p.review,{authorityId:config.authorityId,allowedUserIds:config.allowedUserIds,signal,clock:clock.sample,
      async resolveAccount(uid,signal){const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal});const value=JSON.parse(bytes.toString('utf8'));shape(value,['uid','accountGeneration','source']);if(value.uid!==uid||value.source!=='macos-local-generateduid')throw Error('broker_account_identity');return value.accountGeneration;},
      async approve(input,signal){const bytes=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(input.uid),enrollmentAuthorizer,String(input.uid),String(input.auditSessionId),String(input.continuousDeadlineMs)],stdin:input.reviewBytes,maximumOutput:128,timeoutMs:120000,signal});return bytes.toString('ascii').trim();},
     });return Buffer.from(canonicalVerificationJson(result));
    }
    if(request.method==='publication.authorize'){
     const currentPublicationConfig=()=>{assertRootProtectedFile(configPath);if(!readFileSync(configPath).equals(configBytes))throw Error('broker_config_changed');};currentPublicationConfig();
     if(body.length>65536)throw Error('broker_publication_metadata');const prepared=await consumePublicationReview(publicationRegistry!,p,peer);
     const result=await authorizePublicationOperation(prepared.review,{authorityId:config.authorityId,allowedUserIds:config.allowedUserIds,signal,clock:()=>{currentPublicationConfig();return clock.sample();},
      async resolveAccount(uid,signal){const bytes=await runBrokerHelper({executable:accountHelper,args:[String(uid)],maximumOutput:1024,timeoutMs:5000,signal});const value=JSON.parse(bytes.toString('utf8'));shape(value,['uid','accountGeneration','source']);if(value.uid!==uid||value.source!=='macos-local-generateduid')throw Error('broker_account_identity');return value.accountGeneration;},
      async approve(input,signal){await prepared.assertCaller();const bytes=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(input.uid),publicationAuthorizer,String(input.uid),String(input.auditSessionId),String(input.continuousDeadlineMs)],stdin:input.reviewBytes,maximumOutput:128,timeoutMs:120000,signal});await prepared.assertCaller();return bytes.toString('ascii').trim();},
     });return Buffer.from(canonicalVerificationJson(result));
    }
    if(request.method==='materials.authorize'){
     shape(p,['uid','auditSessionId','review','deadline']);shape(p.deadline,['wallExpiresAt','continuousExpiresAt','clockDomainId','clockQualificationEpoch','preparedLowerBound']);const deadline={wallExpiresAt:p.deadline.wallExpiresAt,continuousExpiresAt:p.deadline.continuousExpiresAt,clockDomainId:p.deadline.clockDomainId,clockQualificationEpoch:p.deadline.clockQualificationEpoch,preparedLowerBound:p.deadline.preparedLowerBound};assertMaterialDeadline(deadline,{wallNow:Date.now(),clock:clock.sample()});if(!allowed.has(p.uid)||!Number.isSafeInteger(p.auditSessionId)||p.auditSessionId<1)throw Error('broker_user');
     const review=Buffer.from(asciiJson(p.review));if(review.length>65536)throw Error('broker_review_limit');
     const expectedHash=createHash('sha256').update(review).digest('hex');
     const output=await runBrokerHelper({executable:'/bin/launchctl',args:['asuser',String(p.uid),authorizer,String(p.uid),String(p.auditSessionId),String(p.deadline.continuousExpiresAt)],stdin:review,maximumOutput:128,timeoutMs:120000,signal});
     assertMaterialDeadline(deadline,{wallNow:Date.now(),clock:clock.sample()});if(output.toString('ascii').trim()!==expectedHash)throw Error('broker_authorization_unknown');
     return Buffer.from(canonicalVerificationJson({reviewHash:expectedHash,uid:p.uid,auditSessionId:p.auditSessionId}));
    }
    if(request.method==='materials.read'||request.method==='materials.inspect'){
     const inspecting=request.method==='materials.inspect';shape(p,inspecting?['uid','workspace','path','byteLimit']:['uid','workspace','path','byteLimit','contentHash','offset','length']);if(!allowed.has(p.uid)||typeof p.workspace!=='string'||Buffer.byteLength(p.workspace)>4096||/[\x00-\x1f\x7f]/.test(p.workspace)||!isAbsolute(p.workspace)||typeof p.path!=='string'||!p.path||Buffer.byteLength(p.path)>4096||p.path.split('/').length>64||isAbsolute(p.path)||p.path.includes('\\')||p.path.split('/').some((s:string)=>!s||s==='.'||s==='..'||/[:\x00-\x1f\x7f]/.test(s))||!Number.isSafeInteger(p.byteLimit)||p.byteLimit<0||p.byteLimit>16*1024**2||(!inspecting&&(!/^[a-f0-9]{64}$/.test(p.contentHash)||!Number.isSafeInteger(p.offset)||p.offset<0||!Number.isSafeInteger(p.length)||p.length<1||p.length>512*1024)))throw Error('broker_read_scope');
     const boundary=lstatSync(base,{bigint:true}),originalCandidate=join(p.workspace,p.path);let ancestor=parse(originalCandidate).root;
     for(const part of originalCandidate.slice(ancestor.length).split('/').filter(Boolean)){ancestor=join(ancestor,part);const checked=lstatSync(ancestor,{bigint:true});if(checked.isSymbolicLink()||checked.dev===boundary.dev&&checked.ino===boundary.ino)throw Error('broker_private_root');}
     const workspace=realpathSync(p.workspace),candidate=join(workspace,p.path),rel=relative(base,candidate);if(rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'))throw Error('broker_private_root');
     const stat=lstatSync(workspace,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('broker_read_root');
     const framed=await runBrokerHelper({executable:reader,args:[String(p.uid),workspace,p.path,String(p.byteLimit),String(stat.dev),String(stat.ino)],maximumOutput:p.byteLimit+2,timeoutMs:5000,signal});
     if(framed.length<2||![48,49].includes(framed[0])||framed[1]!==10)throw Error('broker_read_framing');const executable=framed[0]===49,bytes=framed.subarray(2);
     const contentHash=createHash('sha256').update(bytes).digest('hex');
     if(inspecting)return Buffer.from(canonicalVerificationJson({sha256:contentHash,size:bytes.length,executable}));
     if(contentHash!==p.contentHash||p.offset>bytes.length)throw Error('broker_read_changed');
     return Buffer.from(canonicalVerificationJson({contentHash:p.contentHash,totalBytes:bytes.length,executable,offset:p.offset,bytes:bytes.subarray(p.offset,Math.min(bytes.length,p.offset+p.length)).toString('base64')}));
    }
    throw Error('broker_method');
    };
    return ['application.authorize','archive.authorize','enrollment.authorize','publication.authorize','materials.authorize'].includes(request.method)?sourceRegistry!.runNative(execute):execute();
   },
  });
 }catch(error){publicationRegistry?.close();applicationRegistry?.close();const results=await Promise.allSettled([ipc?.close(),receiverClock?.close(),sourceRegistry?.close()]);if(results.every(r=>r.status==='fulfilled'))lock.close();else retainedBrokerLocks.add(lock);throw error;}
 let closed:Promise<void>|undefined;return Object.freeze({close(){return closed??=(async()=>{publicationRegistry?.close();applicationRegistry?.close();const results=await Promise.allSettled([ipc!.close(),receiverClock!.close(),sourceRegistry!.close()]);const failures=results.filter(r=>r.status==='rejected');if(failures.length){retainedBrokerLocks.add(lock);throw new AggregateError(failures,'broker_shutdown_unknown');}lock.close();})();}});
}
