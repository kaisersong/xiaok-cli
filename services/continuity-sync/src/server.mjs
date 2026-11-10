import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { canonical,exactObject,integer,parseCanonical,unbase64 } from './crypto.mjs';
import { privateFile } from './private-files.mjs';
import { claimCoordinatorProvisioning } from './provisioning.mjs';
import { validateCoordinatorIdentity } from './identity.mjs';
import { AuthorityJournal } from './journal.mjs';
import { Coordinator } from './coordinator.mjs';

const CONTROL=new Set(['/v1/membership','/v1/scopes','/v1/pairings/confirm']);
const SIGNED=new Set(['/v1/head','/v1/journal/pull','/v1/control/pull','/v1/events/pull','/v1/events/push','/v1/pairings/begin','/v1/key-use/consume','/v1/content-revocations/append']);
const ERRORS=new Set(['invalid_content_revocation','content_revocation_conflict','key_use_unavailable','key_use_consumed','key_use_exhausted','origin_mismatch','response_too_large','invalid_crypto_data','invalid_request','invalid_signature','scope_mismatch','scope_forbidden','forbidden','device_revoked','unknown_device','challenge_unavailable','challenge_capacity','operation_conflict','head_changed','membership_gap','pairing_required','pairing_unavailable','event_conflict','stream_gap','key_epoch_changed','key_rotation_required','invalid_page','relay_quota','stream_quota','event_too_large','authority_unavailable','owner_unavailable','coordinator_disposed','unknown_record_type','unknown_control_type','private_entry_unavailable','invalid_devices','device_history_required','device_identity_changed','active_root_required','bootstrap_root_required','profile_mapping_required','scope_revision_conflict','invalid_scope']);
function error(code,status){return Object.assign(new Error(code),{status});}
function readBody(req,maxBytes){return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,finished=false;
  function done(e,value){if(finished)return;finished=true;req.off('data',data);req.off('end',end);req.off('aborted',abort);req.off('error',abort);e?reject(e):resolve(value);}
  function data(chunk){size+=chunk.length;if(size>maxBytes){req.pause();done(error('request_too_large',413));}else chunks.push(chunk);}
  function end(){try{done(null,parseCanonical(Buffer.concat(chunks)));}catch{done(error('invalid_request',400));}}
  function abort(){done(error('request_aborted',400));}req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',abort);
});}
function send(res,status,value){return new Promise(resolve=>{
  if(res.destroyed){resolve();return;}let body;
  try{body=canonical(value);}catch{status=503;body='{"error":"response_too_large"}';}
  if(Buffer.byteLength(body)>2*1024*1024){status=503;body='{"error":"response_too_large"}';}
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff','connection':'close'});
  res.once('close',resolve);res.once('error',resolve);res.end(body,resolve);
});}
function assertListenerIdentity(identity,host,publicOrigin){
  if(identity.certificate.body.deploymentMode!=='test')return;
  if(!['127.0.0.1','::1'].includes(host))throw new Error('test_listener_forbidden');
  if(publicOrigin&&!['127.0.0.1','[::1]'].includes(new URL(publicOrigin).hostname))throw new Error('test_listener_forbidden');
}
export async function startCoordinatorServer({coordinator,tls,host='127.0.0.1',port=0,publicOrigin,maxBodyBytes=1024*1024,maxConcurrent=4}){
  assertListenerIdentity(validateCoordinatorIdentity(coordinator.identity).identity,host,publicOrigin);
  if(!tls?.key||!tls?.cert)throw new Error('https_required');integer(port);if(port>65535)throw new Error('invalid_port');integer(maxBodyBytes,1);integer(maxConcurrent,1);
  if(maxBodyBytes>1024*1024||maxConcurrent>32)throw new Error('invalid_limits');
  let configured;
  if(publicOrigin){configured=new URL(publicOrigin);if(configured.protocol!=='https:'||configured.username||configured.password||configured.pathname!=='/'||configured.search||configured.hash)throw new Error('invalid_public_origin');}
  else if(host!=='127.0.0.1')throw new Error('public_origin_required');
  let authority=configured?.host,closing=false,inFlight=0;const sockets=new Set();
  const server=https.createServer({key:tls.key,cert:tls.cert,minVersion:'TLSv1.3',maxHeaderSize:8192,handshakeTimeout:5000},async(req,res)=>{
    let counted=false;
    try{
      if(closing)throw error('service_closing',503);
      if(req.headers.host!==authority)throw error('host_forbidden',421);
      if(req.headers.origin!==undefined)throw error('origin_forbidden',403);
      if(req.method!=='POST')throw error('method_not_allowed',405);
      if(!CONTROL.has(req.url)&&!SIGNED.has(req.url)&&req.url!=='/v1/challenge')throw error('unknown_route',404);
      if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']!==undefined)throw error('invalid_request',400);
      const length=req.headers['content-length'];if(length!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>maxBodyBytes))throw error('request_too_large',413);
      if(inFlight>=maxConcurrent)throw error('request_capacity',429);inFlight++;counted=true;
      const body=await readBody(req,maxBodyBytes);if(closing)throw error('service_closing',503);let response;
      if(req.url==='/v1/challenge'){exactObject(body,Object.hasOwn(body,'clientNonce')?['deviceId','clientNonce']:['deviceId']);response=coordinator.createChallenge(body);}
      else if(CONTROL.has(req.url))response=coordinator.handleControl({path:req.url,body,requestSource:'user'});
      else{exactObject(body,['auth','signature','body','requestSource']);response=coordinator.handle({method:'POST',path:req.url,...body});}
      await send(res,200,response);
    }catch(e){
      const known=ERRORS.has(e.message),code=e.status?e.message:known?e.message:'internal_error';
      const status=e.status??(['scope_forbidden','forbidden','device_revoked'].includes(code)?403:['invalid_signature','challenge_unavailable','unknown_device'].includes(code)?401:code.includes('unavailable')||code==='internal_error'?503:code.endsWith('conflict')||code==='head_changed'?409:400);
      await send(res,status,{error:code});req.destroy();
    }finally{if(counted)inFlight--;}
  });
  server.maxConnections=32;server.maxHeadersCount=32;server.headersTimeout=5000;server.requestTimeout=10_000;server.keepAliveTimeout=1000;server.setTimeout(5000,socket=>socket.destroy());
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('clientError',(_e,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
  const url=configured?.origin??'https://127.0.0.1:'+server.address().port;authority=new URL(url).host;let closePromise;
  return {server,url,close(){if(closePromise)return closePromise;closing=true;closePromise=new Promise(resolve=>{server.close(()=>resolve());for(const socket of sockets)socket.destroy();});return closePromise;}};
}

function readPrivate(filename,max=256*1024){privateFile(filename);if(fs.statSync(filename).size>max)throw new Error('private_file_too_large');return fs.readFileSync(filename);}
async function main(){
  const {values}=parseArgs({options:{config:{type:'string'},initialize:{type:'boolean',default:false},'test-provisioning-dir':{type:'string'}}});if(!values.config)throw new Error('config_required');
  const configPath=path.resolve(values.config),base=path.dirname(configPath),config=JSON.parse(readPrivate(configPath));
  exactObject(config,['schemaVersion','identity','stateDir','witnessDir','signingKeyFile','tlsKeyFile','tlsCertFile','host','port','publicOrigin']);if(config.schemaVersion!==1)throw new Error('invalid_config');
  const file=key=>path.resolve(base,config[key]);
  const {identity}=validateCoordinatorIdentity(config.identity);
  assertListenerIdentity(identity,config.host,config.publicOrigin);
  claimCoordinatorProvisioning({identity,stateDir:file('stateDir'),witnessDir:file('witnessDir'),initialize:values.initialize,testProvisioningDir:values['test-provisioning-dir']});
  const journal=new AuthorityJournal({stateDir:file('stateDir'),witnessDir:file('witnessDir'),identity:config.identity,initialize:values.initialize});let coordinator,listener;
  try{
    const signingKey=unbase64(readPrivate(file('signingKeyFile')).toString('utf8').trim(),64);
    try{coordinator=new Coordinator({journal,identity:config.identity,signingKey});}finally{signingKey.fill(0);}
    listener=await startCoordinatorServer({coordinator,tls:{key:readPrivate(file('tlsKeyFile')),cert:readPrivate(file('tlsCertFile'))},host:config.host,port:config.port,publicOrigin:config.publicOrigin});
  }catch(e){coordinator?.dispose();journal.close();throw e;}
  let stopping;const stop=()=>stopping??=(async()=>{await listener.close();coordinator.dispose();journal.close();})();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  process.stdout.write(canonical({event:'listening',url:listener.url,pid:process.pid})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('continuity_sync_startup_unavailable\n');process.exitCode=1;});
