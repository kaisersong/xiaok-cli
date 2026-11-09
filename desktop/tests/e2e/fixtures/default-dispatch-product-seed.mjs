// Controlled historical storage seed using original Hub APIs. This is not a
// Native user grant; only the subsequent production Main IPC can supply it.
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const sibling=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../..'),root=process.env.DISPATCH_PRODUCT_SEED_ROOT,scope=JSON.parse(process.env.DISPATCH_PRODUCT_SEED_SCOPE||'null');
if(!root||!scope||!/^[a-f0-9]{64}$/.test(scope.profileId)||!/^[a-f0-9]{64}$/.test(scope.workspaceId))throw Error('controlled_seed_input_required');
const {createHub}=await import(pathToFileURL(join(sibling,'kswarm/src/core/hub.js')).href),{createProjectInputAuthority}=await import(pathToFileURL(join(sibling,'kswarm/src/core/project-input-authority.js')).href);
const authority=createProjectInputAuthority(scope),control={requestSource:'user',projectInputAuthority:authority.reader()},hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},messages:[{messageId:'msg'}],members:['po','worker'].map(logicalAgentId=>({status:'active',subject:{kind:'agent',logicalAgentId}}))};},async acquireRoomMembershipLease(){return{ok:true,leaseId:'seed-only'};},async releaseRoomMembershipLease(){return{ok:true};}}});
try{
 if(!hub.prepareDurableDispatchWriter(control).ok)throw Error('controlled_seed_prepare_failed');
 await hub.createProject({id:'p',name:'DSH Native Product',goal:'Verify actual Main source and stable dispatch receipt',poAgent:'po',members:['worker'],primaryRoomId:'room',sourceMessageIds:['msg'],requestedStartPolicy:'plan_only',autoAssignPo:false},control);
 if(!hub.handleHumanAddTasks('p',[{id:'a',title:'Original task',brief:'Fixture task',assignedAgent:'worker'}],{requestSource:'user'}).ok)throw Error('controlled_seed_task_failed');
 hub.mutateProjectState('p',()=>{hub.getProject('p').status='active';});
 console.log(JSON.stringify({fixture:'controlled-protected-historical-project',projectId:'p',storageOnly:true,nativeMainProof:false,status:hub.getProject('p').status}));
}finally{hub.closePersistence();}
