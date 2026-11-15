import {writeFileSync} from 'node:fs';
// Isolated CLI fixture only: no real provider requests or credential logging.
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init);
 if(!request.url.startsWith('https://api.kimi.com/coding/v1/chat/completions'))throw Error('fixture_unexpected_network_destination');
 const body=JSON.parse(await request.text());
 writeFileSync(process.env.XIAOK_TEST_KIMI_REQUEST,JSON.stringify(body),{mode:0o600});
 const events=[
  {choices:[{index:0,delta:{reasoning_content:'fixture ephemeral reasoning'},finish_reason:null}]},
  {choices:[{index:0,delta:{content:'RESUMED_VALUE_47'},finish_reason:null}]},
  {choices:[{index:0,delta:{},finish_reason:'stop'}]},
 ];
 return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
};
