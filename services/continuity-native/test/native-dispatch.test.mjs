import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {worker,nativeSkip,startParams} from './helpers/worker.mjs';

function sse(id,items){
  const events=[{type:'response.created',response:{id}},...items.map(item=>({type:'response.output_item.done',item})),{
    type:'response.completed',response:{id,usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}},
  }];
  return events.map(value=>`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join('');
}
async function model(t,first){
  const requests=[],otherRequests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url!=='/v1/responses'){otherRequests.push(req.url);res.writeHead(404);res.end();return;}
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks)));
      const items=requests.length===1?first:[{type:'message',role:'assistant',id:'final-message',content:[{type:'output_text',text:'main bridge completed'}]}];
      res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});res.end(sse(`response-${requests.length}`,items));
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {url:`http://127.0.0.1:${server.address().port}`,requests,otherRequests};
}
test('actual native dispatch denies unadvertised builtins, reaches only the original dynamic bridge, and skips executable lifecycle config',{skip:nativeSkip,timeout:45000},async t=>{
  // The mock model intentionally ignores advertised tools and emits hidden siblings.
  // The native engine's original router, rather than a prompt assertion, must reject them.
  const forbidden=[
    {name:'shell',arguments:{command:['/bin/sh','-c','touch native-escaped-shell']}},
    {name:'exec_command',arguments:{cmd:'touch native-escaped-exec'}},
    {name:'apply_patch',arguments:{patch:'*** Begin Patch\n*** Add File: native-escaped-patch\n+escaped\n*** End Patch'}},
    {name:'js',arguments:{code:'throw new Error("must never run")'}},
    {namespace:'functions',name:'exec_command',arguments:{cmd:'touch native-escaped-functions'}},
    {namespace:'code_mode',name:'execute',arguments:{code:'throw new Error("must never run")'}},
    {name:'spawn_agent',arguments:{message:'must never spawn'}},
    {namespace:'mcp',name:'invoke',arguments:{}},
    {name:'invoke',arguments:{name:'fake_flat_bridge',arguments:{}}},
  ];
  const first=forbidden.map((value,index)=>({type:'function_call',call_id:`denied-${index}`,name:value.name,...(value.namespace?{namespace:value.namespace}:{}),arguments:JSON.stringify(value.arguments)}));
  first.push({type:'function_call',call_id:'original-main-call',namespace:'xiaok',name:'invoke',arguments:JSON.stringify({name:'context_read',arguments:{referenceId:'test-ref'}})});
  const remote=await model(t,first),mainCalls=[];
  const w=await worker(t,{
    configure({root,workspace}){
      const sentinel=path.join(root,'lifecycle-executed');
      const script=path.join(root,'executable-canary.cjs');
      fs.writeFileSync(script,`require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'unexpected execution')`,{mode:0o600});
      fs.writeFileSync(path.join(root,'config.toml'),[
        'model = "mock-model"','model_provider = "local_mock"','approval_policy = "never"','sandbox_mode = "read-only"',
        'cli_auth_credentials_store = "file"',`chatgpt_base_url = "${remote.url}"`,
        `notify = ${JSON.stringify([process.execPath,script])}`,
        '[features]','shell_snapshot = true','code_mode = true','code_mode_host = true','code_mode_prewarm = true','plugins = true','apps = true','tool_suggest = true','recommended_plugins = true','remote_plugin = true',
        '[model_providers.local_mock]','name = "Local test endpoint"',`base_url = "${remote.url}/v1"`,
        'wire_api = "responses"','supports_websockets = false','request_max_retries = 0','stream_max_retries = 0',
        '[mcp_servers.forbidden_canary]',`command = ${JSON.stringify(process.execPath)}`,`args = ${JSON.stringify([script])}`,
        '[plugins."canary@test"]','enabled = true',
      ].join('\n'),{mode:0o600});
      const jwt=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
      fs.writeFileSync(path.join(root,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{
        id_token:`${jwt({alg:'none',typ:'JWT'})}.${jwt({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-local-test',chatgpt_plan_type:'plus'}})}.`,
        access_token:'synthetic-local-test-only',refresh_token:'synthetic-local-test-only',account_id:'synthetic-local-test',
      },last_refresh:new Date().toISOString()}),{mode:0o600});
      fs.mkdirSync(path.join(workspace,'.git'));
      fs.mkdirSync(path.join(workspace,'.codex'));
      fs.writeFileSync(path.join(workspace,'.codex','config.toml'),'this is deliberately invalid project config = [');
      const skill=path.join(root,'skills','forbidden-skill');fs.mkdirSync(skill,{recursive:true});
      fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: forbidden-skill\ndescription: forbidden-lifecycle-payload\n---\nFORBIDDEN_SKILL_PAYLOAD_CANARY');
      const plugin=path.join(root,'plugins','cache','test','canary','local');
      fs.mkdirSync(path.join(plugin,'.codex-plugin'),{recursive:true});
      fs.writeFileSync(path.join(plugin,'.codex-plugin','plugin.json'),JSON.stringify({name:'canary',description:'FORBIDDEN_PLUGIN_PAYLOAD_CANARY'}));
      const pluginSkill=path.join(plugin,'skills','canary-skill');fs.mkdirSync(pluginSkill,{recursive:true});
      fs.writeFileSync(path.join(pluginSkill,'SKILL.md'),'---\nname: canary-skill\ndescription: FORBIDDEN_PLUGIN_PAYLOAD_CANARY\n---\nFORBIDDEN_PLUGIN_PAYLOAD_CANARY');
      fs.writeFileSync(path.join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{plugin_canary:{command:process.execPath,args:[script]}}}));
    },
    onRequest(request){
      assert.equal(request.method,'item/tool/call');
      assert.equal(request.params.namespace,'xiaok');assert.equal(request.params.tool,'invoke');
      assert.equal(request.params.callId,'original-main-call');
      mainCalls.push(request.params);
      return {success:true,contentItems:[{type:'inputText',text:'ORIGINAL_MAIN_OWNER_RESULT'}]};
    },
  });
  const started=await w.call('thread/start',startParams());
  assert.equal(started.error,undefined,JSON.stringify(started));
  const threadId=started.result.thread.id;
  const account=await w.call('account/read',{refreshToken:false});assert.equal(account.error,undefined);
  assert.doesNotMatch(JSON.stringify(account),/synthetic-local-test-only|access_token|refresh_token|id_token/,'account/read must not expose raw synthetic credentials');
  const turn=await w.call('turn/start',{threadId,input:[{type:'text',text:'Use the main context tool',text_elements:[]}]});
  assert.equal(turn.error,undefined,JSON.stringify(turn));
  const completed=await w.waitFor(value=>value.method==='turn/completed');
  assert.equal(completed.params.turn.status,'completed',JSON.stringify(completed));
  assert.equal(mainCalls.length,1);assert.equal(mainCalls[0].threadId,threadId);assert.equal(mainCalls[0].turnId,turn.result.turn.id);
  assert.equal(remote.requests.length,2);
  assert.equal(remote.otherRequests.some(url=>url.includes('/plugins/')),false,JSON.stringify(remote.otherRequests));
  const baseContext=remote.requests[0].instructions??remote.requests[0].input.filter(item=>item.role==='developer'||item.role==='system');
  assert.ok(JSON.stringify(baseContext).length>100,'ordinary base instructions must remain intact');
  const tools=remote.requests[0].tools;
  assert.equal(tools.length,1,JSON.stringify(tools));assert.equal(tools[0].name,'xiaok');
  assert.deepEqual(tools[0].tools.map(tool=>tool.name),['invoke']);
  const outputs=remote.requests[1].input.filter(item=>item.type==='function_call_output');
  for(let index=0;index<forbidden.length;index++){
    const output=outputs.find(item=>item.call_id===`denied-${index}`);
    assert.ok(output,`actual engine must return a denial for hidden sibling ${index}`);
    assert.match(JSON.stringify(output.output),/unsupported|not supported|unknown tool|not found/i,JSON.stringify(output));
  }
  assert.match(JSON.stringify(outputs.find(item=>item.call_id==='original-main-call')),/ORIGINAL_MAIN_OWNER_RESULT/);
  assert.doesNotMatch(JSON.stringify(remote.requests),/FORBIDDEN_SKILL_PAYLOAD_CANARY/);
  assert.doesNotMatch(JSON.stringify(remote.requests),/FORBIDDEN_PLUGIN_PAYLOAD_CANARY/);
  assert.equal(fs.existsSync(path.join(w.root,'lifecycle-executed')),false);
  for(const name of ['native-escaped-shell','native-escaped-exec','native-escaped-patch','native-escaped-functions'])assert.equal(fs.existsSync(path.join(w.workspace,name)),false,name);
  // A live actual thread cannot be switched, broadened or read through sibling RPCs.
  for(const [method,params] of [
    ['thread/start',startParams()],
    ['turn/start',{threadId,input:[{type:'text',text:'never',text_elements:[]}],cwd:w.workspace}],
    ['turn/start',{threadId,input:[{type:'image',url:'https://invalid.test/never'}]}],
    ['turn/start',{threadId,input:[{type:'text',text:'never',text_elements:[]}],additionalContext:{test:{kind:'application',value:'never'}}}],
  ]){
    const denied=await w.call(method,params);assert.equal(denied.error?.code,-32600,JSON.stringify(denied));
    assert.match(denied.error.message,/xiaok_main_bridge_rpc_forbidden/);
  }
  assert.equal(remote.requests.length,2,'rejected RPCs must not trigger another model request');
});
