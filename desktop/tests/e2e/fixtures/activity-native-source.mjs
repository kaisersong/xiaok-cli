import {createServer}from'node:http';import{join}from'node:path';import{pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';
const[compiled,root,threadId]=process.argv.slice(2);const load=relative=>import(pathToFileURL(join(compiled,relative)).href);
const{ConversationActivityOwnerClient}=await load('src/runtime/conversation-activity/owner-client.js');
const{InProcessTaskRuntimeHost}=await load('src/runtime/task-host/task-runtime-host.js');
const{FileTaskSnapshotStore}=await load('src/runtime/task-host/snapshot-store.js');
const{MaterialRegistry}=await load('src/runtime/task-host/material-registry.js');
const client=new ConversationActivityOwnerClient(root,'producer');let input,release;const wait=new Promise(resolve=>release=resolve);
const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'source-workspace'),maxBytes:1024}),runner:async value=>{input=value;await wait;}});
const operationId=`fixture:${randomUUID()}`,watchId=operationId;
const prepared=await host.prepareTask({prompt:'Native activity fixture',materials:[],context:{threadId}});const snapshot=(await host.recoverTask(prepared.taskId)).snapshot;
await client.request('prepare',{threadId,operationId,creationIdempotencyKey:operationId});await client.request('bind',{operationId,watchId,source:'task_host',logicalSourceId:'native-e2e-source',sourceDataEpoch:snapshot.sessionId,workId:prepared.taskId});await host.startTask(prepared.taskId);
while(!input)await new Promise(resolve=>setTimeout(resolve,1));
const server=createServer(async(req,res)=>{try{const buffers=[];for await(const part of req)buffers.push(part);const body=JSON.parse(Buffer.concat(buffers).toString()||'{}');
 if(req.url==='/receipt'){await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'fixture-turn',intentId:'fixture-intent',stepId:'fixture-step',note:String(body.note)});}
 else if(req.url==='/finish'){release();await host.drain();}
 else{res.writeHead(404).end();return;}
 const committedAt=Date.now();res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({committedAt,watchId,taskId:prepared.taskId}));
}catch(error){res.writeHead(500).end(JSON.stringify({error:String(error)}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,watchId,taskId:prepared.taskId}));
process.on('SIGTERM',()=>{release();void host.drain().finally(()=>{client.dispose();server.close(()=>process.exit(0));});});
