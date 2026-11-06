// Explicit synthetic transport, loaded only by provider-errors.py. No real API calls.
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.XIAOK_PROVIDER_ERROR_PROBE_DIR;
if(!root)throw Error('PROVIDER_ERROR_PROBE_REQUIRED');
writeFileSync(join(root,'cli.pid'),String(process.pid));
const actualFetch=globalThis.fetch;
const counts=new Map();
const frame=(delta,finish_reason=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`;
globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'||input instanceof URL?String(input):input.url;
  if(!/https:\/\/(?:api.kimi.com\/coding\/v1|open.bigmodel.cn\/api\/coding\/paas\/v4)\/chat\/completions/.test(url))return actualFetch(input,init);
  const body=JSON.parse(typeof init?.body==='string'?init.body:await input.clone().text());
  const message=[...body.messages].reverse().find(m=>m.role==='user'&&/PROVIDER_(?:QUOTA|RATE)_CASE/.test(JSON.stringify(m.content)));
  const kind=JSON.stringify(message?.content).includes('PROVIDER_RATE_CASE')?'rate':'quota';
  const attempt=(counts.get(kind)??0)+1;counts.set(kind,attempt);
  appendFileSync(join(root,'requests.jsonl'),JSON.stringify({kind,attempt,time:Date.now()})+'\n');
  const kimi=url.includes('api.kimi.com');
  if(kind==='quota'||attempt===1){
    const error=kind==='quota'?(kimi?{type:'exceeded_current_quota_error',message:"You've reached your weekly (7-day) usage limit. PRIVATE_CANARY sk-fictional"}:{code:'1310',message:'您已达到每周/每月使用上限，您的限额将在 2026-12-10 09:30:00 重置。PRIVATE_CANARY sk-fictional'})
      :(kimi?{type:'rate_limit_error',message:"We're receiving too many requests. PRIVATE_CANARY"}:{code:'1302',message:'PRIVATE_CANARY'});
    return new Response(JSON.stringify({error}),{status:429,headers:{'content-type':'application/json','retry-after':kind==='quota'?'1':'3','x-request-id':'PRIVATE_CANARY'}});
  }
  return new Response(frame({reasoning_content:'',content:'PROVIDER_RATE_RECOVERED'})+frame({},'stop')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
};
