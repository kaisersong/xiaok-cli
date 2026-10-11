import { createInterface } from 'node:readline';
import { TaskV1Schema, CreateTaskResultV1Schema, GetTaskResultV1Schema, CallToolResultV1Schema } from '@modelcontextprotocol/ext-tasks/core/v1';
const send = message => process.stdout.write(JSON.stringify(message)+'\n');
const reply = (request,result) => send({jsonrpc:'2.0',id:request.id,result});
const tasks = new Map(); let calls = 0;
for await (const line of createInterface({input:process.stdin})) {
  const request = JSON.parse(line);
  if (request.method === 'initialize') reply(request,{protocolVersion:'2025-11-25',serverInfo:{name:'legacy-task-fixture',version:'1'},capabilities:{tools:{},tasks:{requests:{tools:{call:{}}},cancel:{}}}});
  else if (request.method === 'tools/list') reply(request,{tools:[{name:'work',inputSchema:{type:'object'},execution:{taskSupport:'required'}},{name:'ordinary',inputSchema:{type:'object'},execution:{taskSupport:'forbidden'}}]});
  else if (request.method === 'tools/call' && request.params.name === 'ordinary') reply(request,CallToolResultV1Schema.parse({content:[{type:'text',text:'ordinary'}]}));
  else if (request.method === 'tools/call') {
    if (!request.params.task) throw new Error('required task was not requested');
    const now = new Date().toISOString(),taskId = `legacy-${++calls}`;
    const task = TaskV1Schema.parse({taskId,status:'working',createdAt:now,lastUpdatedAt:now,ttl:60_000,pollInterval:25});
    tasks.set(taskId,{task,result:CallToolResultV1Schema.parse({content:[{type:'text',text:'legacy result'}],isError:request.params.arguments?.fail === true})});
    reply(request,CreateTaskResultV1Schema.parse({task}));
    setTimeout(()=>{ const record = tasks.get(taskId); if(record.task.status !== 'working') return; record.task=TaskV1Schema.parse({...task,status:'completed',lastUpdatedAt:new Date().toISOString()}); },100);
  } else if (request.method === 'tasks/get') reply(request,GetTaskResultV1Schema.parse(tasks.get(request.params.taskId).task));
  else if (request.method === 'tasks/result') reply(request,tasks.get(request.params.taskId).result);
  else if (request.method === 'tasks/cancel') { const record=tasks.get(request.params.taskId); reply(request,record.task); setTimeout(()=>{record.task=TaskV1Schema.parse({...record.task,status:'cancelled',lastUpdatedAt:new Date().toISOString()});},50); }
  else if ('id' in request) send({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'unsupported'}});
}
