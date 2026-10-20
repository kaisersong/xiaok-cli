import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worker,nativeSkip,startParams} from './helpers/worker.mjs';

function denied(response,label){
  assert.equal(response.error?.code,-32600,label);
  assert.match(response.error?.message??'',/xiaok_main_bridge_rpc_forbidden/,label);
}
test('dedicated actual native worker rejects normal config RPC at the common request boundary',{skip:nativeSkip,timeout:30000},async t=>{
  const w=await worker(t);
  denied(await w.call('config/read',{includeLayers:false}),'config/read');
});
test('actual RPC ceiling rejects sibling execution/config/history paths and turn overrides before any model call',{skip:nativeSkip,timeout:30000},async t=>{
  const w=await worker(t);
  assert.match(w.initialized.result.userAgent,/xiaok-main-bridge-v1/);
  for(const [method,params] of [
    ['thread/list',{}],['thread/resume',{threadId:'foreign-thread'}],['thread/fork',{threadId:'foreign-thread'}],
    ['thread/read',{threadId:'foreign-thread',includeTurns:true}],
    ['config/value/write',{keyPath:'features.shell_tool',value:true,mergeStrategy:'replace'}],
    ['plugin/list',{}],['mcpServerStatus/list',{}],
    ['account/read',{refreshToken:true}],
    ['turn/start',{threadId:'foreign-thread',input:[{type:'text',text:'never',text_elements:[]}]}],
    ['turn/steer',{threadId:'foreign-thread',expectedTurnId:'old',input:[{type:'text',text:'never',text_elements:[]}]}],
    ['turn/interrupt',{threadId:'foreign-thread',turnId:'old'}],
  ])denied(await w.call(method,params),method);
  for(const override of [{cwd:w.workspace},{approvalPolicy:'never'},{config:{features:{shell_tool:true}}},{ephemeral:false},{environments:[{environmentId:'local',cwd:w.workspace}]}]){
    denied(await w.call('thread/start',{...startParams(),...override}),JSON.stringify(override));
  }
});
