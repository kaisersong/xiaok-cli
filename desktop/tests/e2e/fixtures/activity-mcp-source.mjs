import{createServer}from'node:http';import{join}from'node:path';import{pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';
import{DetailedTaskV2Schema,CreateTaskResultV2Schema,TaskStatusNotificationV2Schema}from'@modelcontextprotocol/ext-tasks/core/v2';
const[compiled,root,threadId]=process.argv.slice(2);const load=p=>import(pathToFileURL(join(compiled,p)).href);
const{createMcpClientConnection}=await load('src/platform/mcp/transport.js');const{callMcpToolWithTasks}=await load('src/platform/mcp/tasks.js');const{ConversationActivityOwnerClient}=await load('src/runtime/conversation-activity/owner-client.js');
let task,updates=0,calls=0,cancels=0;const streams=new Map();
const changed=()=>{for(const[id,stream]of streams)stream.write(`event: message\ndata: ${JSON.stringify(TaskStatusNotificationV2Schema.parse({jsonrpc:'2.0',method:'notifications/tasks',params:{...task,_meta:{'io.modelcontextprotocol/subscriptionId':id}}}))}\n\n`);};
const server=createServer(async(req,res)=>{if(req.url==='/stats'){res.end(JSON.stringify({calls,updates,cancels,status:task?.status}));return;}
if(req.url==='/confirm-cancel'){task=DetailedTaskV2Schema.parse({taskId:task.taskId,createdAt:task.createdAt,lastUpdatedAt:new Date().toISOString(),ttlMs:60000,status:'cancelled'});changed();res.end('{}');return;}
if(req.headers.authorization!=='Bearer fixture'){res.writeHead(401).end();return;}
const chunks=[];for await(const part of req)chunks.push(part);const m=JSON.parse(Buffer.concat(chunks).toString());const reply=result=>{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));};
if(m.method==='server/discover')reply({resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{},extensions:{'io.modelcontextprotocol/tasks':{}}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'gui-input',version:'1'}}});
else if(m.method==='tools/list')reply({resultType:'complete',cacheScope:'private',ttlMs:1000,tools:[{name:'work',inputSchema:{type:'object'}}]});
else if(m.method==='tools/call'){calls++;const now=new Date().toISOString();task=DetailedTaskV2Schema.parse({taskId:'gui-input-task',status:'working',createdAt:now,lastUpdatedAt:now,ttlMs:60000,pollIntervalMs:1000});reply(CreateTaskResultV2Schema.parse({...task,resultType:'task'}));setTimeout(()=>{task=DetailedTaskV2Schema.parse({...task,status:'input_required',lastUpdatedAt:new Date().toISOString(),inputRequests:{format:{method:'elicitation/create',params:{mode:'form',message:'选择输出格式',requestedSchema:{type:'object',properties:{format:{type:'string',enum:['html','pdf']}},required:['format']}}}}});changed();},100);}
else if(m.method==='tasks/get')reply({...task,resultType:'complete'});
else if(m.method==='tasks/update'){updates++;task=DetailedTaskV2Schema.parse({taskId:task.taskId,createdAt:task.createdAt,lastUpdatedAt:new Date().toISOString(),ttlMs:60000,status:'working',statusMessage:'用户输入已记录，等待来源完成'});reply({resultType:'complete'});changed();}
else if(m.method==='tasks/cancel'){cancels++;reply({resultType:'complete'});}
else if(m.method==='subscriptions/listen'){res.writeHead(200,{'content-type':'text/event-stream'});streams.set(m.id,res);res.write(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',method:'notifications/subscriptions/acknowledged',params:{notifications:{taskIds:['gui-input-task']},_meta:{'io.modelcontextprotocol/subscriptionId':m.id}}})}\n\n`);res.on('close',()=>streams.delete(m.id));}
else if(m.method==='notifications/cancelled'){streams.get(m.params.requestId)?.end();streams.delete(m.params.requestId);res.writeHead(202).end();}else res.writeHead(202).end();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
const config={type:'http',url:url+'/mcp',headers:{authorization:'Bearer fixture'}};const connection=await createMcpClientConnection('gui-input',config);const client=new ConversationActivityOwnerClient(root,'producer');const operationId=`mcp-fixture:${randomUUID()}`;
await client.request('mcpRegister',{endpointId:connection.tasks.endpointId,name:'gui-input',config});await client.request('prepare',{threadId,operationId,creationIdempotencyKey:operationId});
await callMcpToolWithTasks(connection,{name:'work',arguments:{}},{detachOnTask:true,observer:{handle:ref=>client.request('bind',{operationId,watchId:operationId,source:'mcp',logicalSourceId:ref.endpointId,sourceDataEpoch:operationId,workId:ref.taskId,mcpReference:ref}),event:()=>{},detached:()=>{}}});
await connection.close();client.dispose();console.log(JSON.stringify({url,watchId:operationId}));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
