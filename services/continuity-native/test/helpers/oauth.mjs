import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {worker} from './worker.mjs';

export function tokensFor(label='a',plan='plus'){
  const claims={email:'synthetic@example.invalid',sub:`synthetic-user-${label}`,exp:Math.floor(Date.now()/1000)+3600,
    'https://api.openai.com/auth':{chatgpt_account_id:`synthetic-account-${label}`,chatgpt_user_id:`synthetic-user-${label}`,chatgpt_plan_type:plan}};
  return {id_token:`${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SYNTHETIC_SIGNATURE`,
    access_token:`SYNTHETIC_OAUTH_ACCESS_CANARY_${label}`,refresh_token:`SYNTHETIC_OAUTH_REFRESH_CANARY_${label}`,token_type:'Bearer',expires_in:3600};
}

export async function syntheticIssuer(t,{tokenResponse,bundleResponse}={}){
  const requests=[],tokens=tokensFor();
  const server=http.createServer({maxHeaderSize:128*1024},async(req,res)=>{
    try{
      let body='';for await(const chunk of req)body+=chunk;
      requests.push({method:req.method,path:req.url,body});
      if(req.method==='POST'&&req.url==='/oauth/token'){
        const response=await tokenResponse?.({body,requests})??tokens;
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
      }else if(req.method==='POST'&&req.url==='/oauth/revoke'){
        res.writeHead(200);res.end('{}');
      }else if(req.method==='GET'&&req.url==='/backend-api/wham/accounts/check'){
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({accounts:['a','b'].map(label=>({id:`synthetic-account-${label}`,workspace_backend_origin:'https://chatgpt.com',account_routing_override:'NO_CONSTRAINT'}))}));
      }else if(req.method==='GET'&&req.url==='/backend-api/wham/config/bundle'){
        const response=(typeof bundleResponse==='function'?await bundleResponse({requests}):bundleResponse)??{status:200,body:'{}'};
        res.writeHead(response.status,{'content-type':'application/json'});res.end(response.body);
      }else if(req.method==='GET'&&req.url==='/backend-api/wham/settings/user'){
        res.writeHead(200,{'content-type':'application/json'});res.end('{"commit_attribution_enabled":false}');
      }else{res.writeHead(404);res.end();}
    }catch{res.destroy();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {origin:`http://127.0.0.1:${server.address().port}`,tokens,requests};
}

export function oauthWorker(t,oauth,{diagnosticLevel,faultMode,configSuffix='',physicalStdoutPipe=false}={}){
  return worker(t,{fixtureIssuer:oauth.origin,diagnosticLevel,faultMode,physicalStdoutPipe,configure:({root})=>{
    fs.writeFileSync(path.join(root,'config.toml'),`chatgpt_base_url = "${oauth.origin}/backend-api"\n${configSuffix}\n[features]\nshell_snapshot = false\n`,{mode:0o600});
  }});
}

export async function beginBrowser(w,code='synthetic-authorization-code'){
  const response=await w.call('account/login/start',{type:'chatgpt'});assert.equal(response.error,undefined);
  const auth=new URL(response.result.authUrl),callback=new URL(auth.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('code',code);
  return {loginId:response.result.loginId,callback};
}

export async function completeBrowser(w,attempt){
  const response=await fetch(attempt.callback,{redirect:'manual',signal:AbortSignal.timeout(5000)});await response.text();assert.equal(response.status,302);
  const page=await fetch(response.headers.get('location'),{redirect:'manual',signal:AbortSignal.timeout(5000)});await page.text();
  const completion=await w.waitFor(frame=>frame.method==='account/login/completed'&&frame.params?.loginId===attempt.loginId);
  assert.equal(completion.params.success,true);return completion;
}
