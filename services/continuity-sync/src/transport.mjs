import https from 'node:https';
import {ClientRequest} from 'node:http';
import {claimOriginalDeviceTransport} from './device-owner.mjs';
import {createSecureContext} from 'node:tls';
import { randomBytes,randomUUID } from 'node:crypto';
import { base64,bytes,canonical,exactObject,hash,integer,parseCanonical,sign,verify } from './crypto.mjs';
import { validateCoordinatorIdentity,verifyServerResponse } from './identity.mjs';

const SIGNED=new Set(['/v1/head','/v1/journal/pull','/v1/control/pull','/v1/events/pull','/v1/events/push','/v1/pairings/begin','/v1/key-use/consume','/v1/content-revocations/append']);
const CONTROL=new Set(['/v1/membership','/v1/scopes','/v1/pairings/confirm']);
const keyUseClients=new WeakMap();
const originalEnd=ClientRequest.prototype.end;
function validatedCa(value){
  if(value===undefined)return undefined;
  const entries=Array.isArray(value)?value:[value];let total=0;
  if(!entries.length||entries.length>32)throw new Error('invalid_ca');
  const copy=entries.map(entry=>{
    if(typeof entry!=='string'&&!Buffer.isBuffer(entry))throw new Error('invalid_ca');
    const bytes=Buffer.from(entry);total+=bytes.length;if(!bytes.length||total>1024*1024)throw new Error('invalid_ca');return bytes;
  });
  try{createSecureContext({ca:copy,minVersion:'TLSv1.3'});}catch{throw new Error('invalid_ca');}
  return copy;
}
/** Original private transport capability; neither a kind string nor a replaced public call is proof. */
export function privateKeyUseConsumer(client,{identityHash,deviceId,expectedHead,requestSource,requestId}){
  const original=keyUseClients.get(client);if(!original)throw new Error('key_use_client_unavailable');
  if(original.identityHash!==identityHash||original.deviceId!==deviceId)throw new Error('coordinator_identity_mismatch');
  expectedHead=parseCanonical(Buffer.from(canonical(expectedHead)));exactObject(expectedHead,['identityHash','sequence','hash']);integer(expectedHead.sequence);
  if(expectedHead.identityHash!==identityHash||!/^[a-f0-9]{64}$/.test(expectedHead.hash))throw new Error('coordinator_identity_mismatch');
  if(!['user','agent','scheduler'].includes(requestSource))throw new Error('request_source_required');
  return body=>original.consume(body,{expectedHead,requestSource,...(requestId===undefined?{}:{requestId})});
}
export class CoordinatorClient {
  #base;#identity;#online;#device;#signing;#agent;#pending=new Map();#closed=false;#timeout;#drainPromise;#resolveDrain;#rejectDrain;#constructionUncertain=false;#deviceCurrent;
  constructor({baseUrl,identity,deviceId,signingKey,ca,timeoutMs=15_000,owner}){
    const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('https_required');
    const trusted=validateCoordinatorIdentity(identity);this.#identity=trusted.identity;this.#online=trusted.coordinatorPublicKey;this.#device=deviceId;this.#base=url;integer(timeoutMs,1);if(timeoutMs>30_000)throw new Error('invalid_timeout');this.#timeout=timeoutMs;
    if(owner!==undefined)this.#deviceCurrent=claimOriginalDeviceTransport(owner,this,{identity,deviceId:this.#device,signingKey});
    this.#agent=new https.Agent({ca:validatedCa(ca),minVersion:'TLSv1.3',keepAlive:false,maxSockets:2,rejectUnauthorized:true});
    this.#signing=new Uint8Array(bytes(signingKey,64));
    keyUseClients.set(this,{identityHash:hash(this.#identity),deviceId:this.#device,consume:(body,options)=>this.#call('/v1/key-use/consume',body,options)});
  }
  #post(route,body){
    if(this.#closed)throw new Error('client_closed');if(this.#constructionUncertain)throw new Error('transport_construction_uncertain');if(this.#pending.size>=8)throw new Error('client_capacity');const wire=canonical(body);if(Buffer.byteLength(wire)>1024*1024)throw new Error('request_too_large');
    return new Promise((resolve,reject)=>{
      const fail=e=>reject(this.#closed?new Error('client_closed'):e);
      // Native request construction can synchronously reenter close. Register first;
      // only its original close event can discharge this obligation.
      const obligation=Symbol();this.#pending.set(obligation,undefined);
      let req;try{req=https.request(new URL(route,this.#base),{method:'POST',agent:this.#agent,headers:{'content-type':'application/json','content-length':Buffer.byteLength(wire)}},res=>{
        let size=0;const chunks=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)req.destroy(new Error('response_too_large'));else chunks.push(chunk);});
        res.on('error',fail);res.on('aborted',()=>fail(new Error('response_aborted')));
        res.on('end',()=>{try{if(this.#closed)throw new Error('client_closed');if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(res.headers['content-type']??''))throw new Error('invalid_response');const value=parseCanonical(Buffer.concat(chunks));if(res.statusCode!==200)throw new Error(typeof value.error==='string'&&/^[a-z_]{1,64}$/.test(value.error)?value.error:'remote_error');resolve(value);}catch(e){fail(e);}});
      });}catch(error){this.#constructionUncertain=true;this.#rejectDrain?.(new Error('transport_construction_uncertain'));throw error;}
      this.#pending.set(obligation,req);const deadline=setTimeout(()=>req.destroy(new Error('transport_timeout')),this.#timeout);deadline.unref();req.once('close',()=>{clearTimeout(deadline);this.#pending.delete(obligation);if(this.#closed&&this.#pending.size===0)this.#resolveDrain?.();});req.once('error',fail);req.setTimeout(this.#timeout,()=>req.destroy(new Error('transport_timeout')));
      // Original native construction and listener/timer registrations may all
      // reenter main. Validate the fixed original owner only after them, at the
      // last synchronous boundary before the captured original send.
      const destroy=req.destroy;
      try{
        this.#deviceCurrent?.(route,body);
        if(this.#closed)throw new Error('client_closed');
        if(this.#constructionUncertain||req.destroyed||req.writableEnded)throw new Error('transport_unavailable');
        originalEnd.call(req,wire);
      }catch(error){destroy.call(req,error);fail(error);}

    });
  }
  async call(path,body,options){return this.#call(path,body,options);}
  async #call(path,body,{expectedHead,requestId=randomUUID(),requestSource}={}){
    if(!SIGNED.has(path))throw new Error('unknown_route');if(!['user','agent','scheduler'].includes(requestSource))throw new Error('request_source_required');
    body=parseCanonical(Buffer.from(canonical(body)));expectedHead=parseCanonical(Buffer.from(canonical(expectedHead)));
    const keyUse=path==='/v1/key-use/consume',clientNonce=keyUse?base64(randomBytes(32)):undefined;
    const challenge=await this.#post('/v1/challenge',{deviceId:this.#device,...(keyUse?{clientNonce}:{})});exactObject(challenge,['body','signature']);const c=challenge.body;
    exactObject(c,['schemaVersion','rootKeyId','syncGroupId','coordinatorId','deviceId','challengeId','expiresAt',...(keyUse?['clientNonce']:[])]);if(c.schemaVersion!==1||c.deviceId!==this.#device||keyUse&&c.clientNonce!==clientNonce||!verify(['xiaok/context-sync/challenge/v1',c],challenge.signature,this.#online))throw new Error('invalid_challenge');
    for(const k of ['rootKeyId','syncGroupId','coordinatorId'])if(c[k]!==this.#identity[k])throw new Error('invalid_challenge');integer(c.expiresAt,1);
    const auth={schemaVersion:1,method:'POST',path,rootKeyId:this.#identity.rootKeyId,syncGroupId:this.#identity.syncGroupId,coordinatorId:this.#identity.coordinatorId,deviceId:this.#device,requestId,challengeId:c.challengeId,bodyHash:hash(body),expectedHead};
    const response=await this.#post(path,{auth,signature:sign(['xiaok/context-sync/request/v1',auth],this.#signing),body,requestSource});
    verifyServerResponse({response,identity:this.#identity,coordinatorPublicKey:this.#online,path,requestId,deviceId:this.#device,requestBodyHash:hash(body)});
    if(path==='/v1/key-use/consume'){
      const result=response.body.result;
      try{
        if(!this.#identity.certificate.body.capabilities.includes('key-use-v1'))throw new Error();
        exactObject(result,['useId','reservationId','workerBootId','challengeId','headerHash','derivedKeyId','count']);integer(result.count,1);
        if(result.count>2**32||result.challengeId!==c.challengeId||result.workerBootId!==body.workerBootId||result.reservationId!==body.reservationId||result.useId!==body.useId||result.headerHash!==hash(body.header)||result.derivedKeyId!==body.derivedKeyId)throw new Error();
      }catch{throw new Error('invalid_key_use_response');}
    }
    return response;
  }
  async control(path,body){
    if(!CONTROL.has(path))throw new Error('unknown_route');body=parseCanonical(Buffer.from(canonical(body)));const response=await this.#post(path,body);
    return verifyServerResponse({response,identity:this.#identity,coordinatorPublicKey:this.#online,path,requestBodyHash:hash(body),operationId:body.record?.body.operationId??body.pairingId,control:true});
  }
  async getHead({expectedHead}={}){
    expectedHead??={sequence:0,hash:hash(['xiaok/context-sync/authority-genesis/v2',this.#identity]),identityHash:hash(this.#identity)};
    const nonce=base64(randomBytes(32)),response=await this.#call('/v1/head',{nonce},{expectedHead,requestSource:'user'});
    if(response.body.result.nonce!==nonce)throw new Error('invalid_head');return {nonce,response};
  }
  close(){if(this.#closed)return;this.#closed=true;this.#signing.fill(0);this.#drainPromise=new Promise((resolve,reject)=>{this.#resolveDrain=resolve;this.#rejectDrain=reject;});this.#drainPromise.catch(()=>{});for(const req of this.#pending.values())req?.destroy(new Error('client_closed'));this.#agent.destroy();if(this.#constructionUncertain)this.#rejectDrain(new Error('transport_construction_uncertain'));else if(this.#pending.size===0)this.#resolveDrain();}
  drainClosed(){return this.#closed?this.#drainPromise:Promise.reject(new Error('client_not_closed'));}
}

// Capture in this module after class initialization. In particular the owner
// must not read this class at top level through the two-way ESM friend edge.
const originalCall=CoordinatorClient.prototype.call,originalHead=CoordinatorClient.prototype.getHead,originalClose=CoordinatorClient.prototype.close,originalDrain=CoordinatorClient.prototype.drainClosed;
export function createOriginalCoordinatorClient(options){return new CoordinatorClient(options);}
export function callOriginalCoordinatorClient(...args){return originalCall.apply(this,args);}
export function headOriginalCoordinatorClient(...args){return originalHead.apply(this,args);}
export function closeOriginalCoordinatorClient(...args){return originalClose.apply(this,args);}
export function drainOriginalCoordinatorClient(...args){return originalDrain.apply(this,args);}
