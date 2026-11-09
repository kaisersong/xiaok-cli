import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const authBinary=process.env.XIAOK_AUTH_TEST_BINARY;
if(authBinary)process.env.XIAOK_NATIVE_TEST_BINARY=authBinary;
const {worker}=await import('./helpers/worker.mjs');
const skip=!authBinary||process.platform!=='darwin'||process.arch!=='arm64';
const jwt=claims=>`${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.SYNTHETIC_SIGNATURE`;

async function issuer(t){
  const idToken=jwt({email:'synthetic@example.invalid',sub:'synthetic-user',exp:Math.floor(Date.now()/1000)+3600,
    'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account-a',chatgpt_user_id:'synthetic-user-a',chatgpt_plan_type:'plus'}});
  const tokens={id_token:idToken,access_token:'SYNTHETIC_OAUTH_ACCESS_CANARY',refresh_token:'SYNTHETIC_OAUTH_REFRESH_CANARY',token_type:'Bearer',expires_in:3600};
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    requests.push({method:req.method,path:req.url,body});
    if(req.method==='POST'&&req.url==='/oauth/token'){
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(tokens));
    }else if(req.method==='GET'&&req.url==='/backend-api/wham/accounts/check'){
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({accounts:[{id:'synthetic-account-a',workspace_backend_origin:'https://chatgpt.com',account_routing_override:'NO_CONSTRAINT'}]}));
    }else if(req.method==='GET'&&req.url==='/backend-api/wham/config/bundle'){
      res.writeHead(200,{'content-type':'application/json'});res.end('{}');
    }else if(req.method==='GET'&&req.url==='/backend-api/wham/settings/user'){
      res.writeHead(200,{'content-type':'application/json'});res.end('{"commit_attribution_enabled":false}');
    }else{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {origin:`http://127.0.0.1:${server.address().port}`,tokens,requests};
}

test('original synthetic OAuth callback persists managed File, checks cache origin and exposes no raw ID token in browser redirect',{skip,timeout:30000},async t=>{
  const oauth=await issuer(t),w=await worker(t,{fixtureIssuer:oauth.origin,configure:({root})=>{
    fs.writeFileSync(path.join(root,'config.toml'),`chatgpt_base_url = "${oauth.origin}/backend-api"\n[features]\nshell_snapshot = false\n`,{mode:0o600});
  }});
  const login=await w.call('account/login/start',{type:'chatgpt'});assert.equal(login.error,undefined);
  const authUrl=new URL(login.result.authUrl);assert.equal(authUrl.origin,oauth.origin);
  const callback=new URL(authUrl.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',authUrl.searchParams.get('state'));callback.searchParams.set('code','synthetic-authorization-code');
  const response=await fetch(callback,{redirect:'manual'});await response.text();
  assert.equal(response.status,302);
  const redirect=new URL(response.headers.get('location'));
  const idTokenInRedirect=redirect.searchParams.has('id_token')||redirect.href.includes(oauth.tokens.id_token);
  const completedPage=await fetch(redirect,{redirect:'manual'});const html=await completedPage.text();
  const completion=await w.waitFor(m=>m.method==='account/login/completed'&&m.params?.loginId===login.result.loginId);
  assert.equal(completion.params.success,true);
  const snapshot=await w.call('xiaok/auth/snapshot',{refresh:false});assert.equal(snapshot.error,undefined);
  assert.equal(snapshot.result.accessToken,oauth.tokens.access_token);assert.equal(snapshot.result.accountId,'synthetic-account-a');assert.equal(snapshot.result.userId,'synthetic-user-a');
  const stored=JSON.parse(fs.readFileSync(path.join(w.root,'auth.json'),'utf8'));
  assert.equal(stored.tokens.refresh_token,oauth.tokens.refresh_token);assert.equal(stored.tokens.id_token,oauth.tokens.id_token);
  assert.ok(oauth.requests.some(r=>r.path==='/oauth/token'&&r.body.includes('synthetic-authorization-code')));
  const publicFrames=JSON.stringify({snapshot,completion,html,stderr:w.diagnostics()});
  const leaks={idTokenInRedirect,idTokenInFrames:publicFrames.includes(oauth.tokens.id_token),refreshTokenInFrames:publicFrames.includes(oauth.tokens.refresh_token)};
  t.diagnostic(JSON.stringify({case:'original-synthetic-oauth-callback',...leaks}));
  assert.deepEqual(await w.endAndDrain(),{code:0,signal:null});
  assert.deepEqual(leaks,{idTokenInRedirect:false,idTokenInFrames:false,refreshTokenInFrames:false});
});
