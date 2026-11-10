// @vitest-environment node
import {it,expect} from 'vitest';
import {createHmac,createHash} from 'node:crypto';
import {dshAJson} from '../../../src/runtime/multi-agent/dsh-admission-data.js';
import {brokerAdmissionDigest,readBrokerAdmissionReply} from '../../electron/broker-dsh-control-data.js';
const token='private-test-credential',challenge='1'.repeat(64),realmId='11111111-1111-4111-8111-111111111111';
const input={schemaVersion:1,scope:{profileId:'p',workspaceId:'w'},authority:{authorityId:'a',authorityEpoch:1},operationId:'baseline',visibility:{kind:'no_visibility'}};
function signed(value:unknown=input){const principal=createHash('sha256').update('room-host-installation\n').update(token).digest('hex'),scopeKey=brokerAdmissionDigest({scope:input.scope,principal}),domainId='broker-dsh:'+realmId+':'+scopeKey;
 const body={ok:true,domain:{schemaVersion:1,kind:'broker_dsh',ownerKind:'active_pointer',domainId,storeId:realmId,scope:input.scope,writerProfile:'broker_dsh_control_v1',writerSchemaVersion:9},visibility:input.visibility,receipt:{schemaVersion:1,kind:'baseline',realmId,domainId,scope:input.scope,authority:input.authority,operationId:'baseline',storageRevision:1,request:input,durableGuard:brokerAdmissionDigest({realmId,scopeKey,request:input,storageRevision:1})},current:true};
 const data={protocol:'broker_dsh_control_v1',challenge,requestDigest:brokerAdmissionDigest(value),body};return {...data,authentication:createHmac('sha256',token).update('xiaok.broker-dsh-reply.v1\0'+dshAJson(data)).digest('hex')};
}
it('authenticates actual protocol/request digest/full body and independently matches expected scope and baseline',()=>{
 expect(readBrokerAdmissionReply(token,challenge,input,signed()).current).toBe(true);
 for(const mutation of [{challenge:'2'.repeat(64)},{protocol:'foreign'},{requestDigest:'0'.repeat(64)},{authentication:'0'.repeat(64)}])expect(()=>readBrokerAdmissionReply(token,challenge,input,{...signed(),...mutation})).toThrow();
 expect(()=>readBrokerAdmissionReply(token,challenge,{...input,operationId:'other'},signed())).toThrow();
 const foreign=signed({...input,scope:{profileId:'foreign',workspaceId:'w'}});expect(()=>readBrokerAdmissionReply(token,challenge,{...input,scope:{profileId:'foreign',workspaceId:'w'}},foreign)).toThrow();
});
it('foreign Proxy/getter and wrong credential cannot authenticate; no candidate getters run',()=>{
 let calls=0;const raw=new Proxy({}, {ownKeys(){calls++;return[];},get(){calls++;throw Error();}});expect(()=>readBrokerAdmissionReply(token,challenge,input,raw)).toThrow();
 const getter=signed();Object.defineProperty(getter,'body',{get(){calls++;throw Error();}});expect(()=>readBrokerAdmissionReply(token,challenge,input,getter)).toThrow();expect(calls).toBe(0);
 expect(()=>readBrokerAdmissionReply('wrong',challenge,input,signed())).toThrow();
});
