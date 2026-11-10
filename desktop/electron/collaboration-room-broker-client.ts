import { desktopServiceUrl } from './desktop-service-discovery.js';
import {createBrokerAdmissionLoopbackFetch,attachOriginalSingleRequestResourceGate,isOriginalSingleRequestResponse,readSingleRequestOwnedReply,readOriginalSingleRequestPhysicalReceipt,isSingleRequestSourceUnknown} from '../../src/runtime/sol-pi/single-request-https.js';
import {captureGithubReadData,githubReadFields,githubReadRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {types as roomResponseTypes} from 'node:util';
import {assertOriginalKSwarmBrokerClientToken} from './kswarm-service.js';
import {readOriginalMainDshBrokerFrame,retireOriginalMainDshBrokerFrame} from './main-dsh-broker-control-source.js';
import {brokerAdmissionDigest,readBrokerAdmissionReply,readBrokerControlRejection} from './broker-dsh-control-data.js';
import {assertRoomTurnCustody,type RoomTurnCustody} from './original-room-turn-custody.js';
interface OriginalRoomBrokerFunctions {snapshot(roomId:string,context:RoomTurnCustody):Promise<Record<string,unknown>>;claim(input:Readonly<{roomId:string;roomMessageId:string;logicalAgentId:string;hostParticipantId:string}>,context:RoomTurnCustody):Promise<Record<string,unknown>>;complete(input:unknown,context:RoomTurnCustody):Promise<Record<string,unknown>>;history(input:unknown,context:RoomTurnCustody):Promise<Record<string,unknown>>}
const roomClients=new WeakMap<object,OriginalRoomBrokerFunctions>();
const roomClientGet=WeakMap.prototype.get,roomClientSet=WeakMap.prototype.set,roomClientApply=Reflect.apply,roomResponseKeys=Reflect.ownKeys,roomResponseDescriptor=Object.getOwnPropertyDescriptor,roomResponseOwn=Object.hasOwn;
const roomResponseJson=Response.prototype.json,roomResponseOk=Object.getOwnPropertyDescriptor(Response.prototype,'ok')!.get!;
const roomNativeThen=Promise.prototype.then,roomStringify=JSON.stringify;
const originalBrokerFetch=fetch;
const brokerControlUnknown=()=>{};
const brokerControlParse=JSON.parse,brokerControlDecoder=new TextDecoder('utf-8',{fatal:true}),brokerControlDecode=TextDecoder.prototype.decode;
const admissionClients=new WeakMap<object,{assert(service:unknown):void;perform(source:unknown,proof:unknown):Promise<Readonly<Record<string,unknown>>>}>();
export function assertOriginalBrokerAdmissionClient(client:unknown,service:unknown):void {
 const row=roomClientApply(roomClientGet,admissionClients,[client]) as {assert(service:unknown):void}|undefined;if(!row)throw Error('BROKER_DSH_ORIGINAL_CLIENT_REQUIRED');row.assert(service);
}
export function performOriginalBrokerAdmission(client:unknown,source:unknown,proof:unknown):Promise<Readonly<Record<string,unknown>>> {
 const row=roomClientApply(roomClientGet,admissionClients,[client]) as {perform(source:unknown,proof:unknown):Promise<Readonly<Record<string,unknown>>>}|undefined;if(!row)throw Error('BROKER_DSH_ORIGINAL_CLIENT_REQUIRED');return row.perform(source,proof);
}
export function readOriginalRoomSnapshot(client:object,context:RoomTurnCustody,roomId:string):Promise<Record<string,unknown>> {
 const read=roomClientApply(roomClientGet,roomClients,[client]) as {snapshot(roomId:string,context:RoomTurnCustody):Promise<Record<string,unknown>>}|undefined;
 if(!read)throw Error('ROOM_TURN_ORIGINAL_BROKER_REQUIRED');assertRoomTurnCustody(context);return read.snapshot(roomId,context);
}
/** Original authenticated HTTP claim only. Public client method shapes and
 * caller response DTOs are never accepted as original claim evidence. */
export function claimOriginalRoomWake(client:object,context:RoomTurnCustody,input:Readonly<{roomId:string;roomMessageId:string;logicalAgentId:string;hostParticipantId:string}>):Promise<Record<string,unknown>> {
 const read=roomClientApply(roomClientGet,roomClients,[client]) as {claim(input:Readonly<{roomId:string;roomMessageId:string;logicalAgentId:string;hostParticipantId:string}>,context:RoomTurnCustody):Promise<Record<string,unknown>>}|undefined;
 if(!read)throw Error('ROOM_TURN_ORIGINAL_BROKER_REQUIRED');
 assertRoomTurnCustody(context);return read.claim(input,context);
}
export function completeOriginalRoomWake(client:object,context:RoomTurnCustody,input:unknown):Promise<Record<string,unknown>> {
 const read=roomClientApply(roomClientGet,roomClients,[client]) as OriginalRoomBrokerFunctions|undefined;if(!read)throw Error('ROOM_TURN_ORIGINAL_BROKER_REQUIRED');assertRoomTurnCustody(context);
 const value=githubReadRecord(captureGithubReadData(input));githubReadFields(value,['roomId','claimToken','reply']);const reply=githubReadRecord(value.reply);githubReadFields(reply,reply.kind==='pass'?['kind']:['kind','text']);if(reply.kind!=='pass'&&(reply.kind!=='text'||typeof reply.text!=='string'))throw Error('ROOM_TURN_COMPLETE_INVALID');return read.complete(value,context);
}
export function readOriginalRoomHistoryPage(client:object,context:RoomTurnCustody,input:unknown):Promise<Record<string,unknown>> {
 const read=roomClientApply(roomClientGet,roomClients,[client]) as OriginalRoomBrokerFunctions|undefined;if(!read)throw Error('ROOM_TURN_ORIGINAL_BROKER_REQUIRED');assertRoomTurnCustody(context);
 const value=githubReadRecord(captureGithubReadData(input)),fields=['roomId','claimToken'];for(const key of ['afterSequence','beforeSequence','limit'])if(roomResponseOwn(value,key))Object.defineProperty(fields,fields.length,{__proto__:null,value:key,enumerable:true,configurable:true,writable:true} as PropertyDescriptor);githubReadFields(value,fields);return read.history(value,context);
}
import {createRoomConversionSourceReader} from './room-conversion-source-client.js';
const BROKER_BASE_URLS = ['http://127.0.0.1:4318', 'http://localhost:4318'];
const ROOM_TOKEN_HEADER = 'x-intent-broker-room-token';

export function createCollaborationRoomBrokerClient(options: {
  token: string;
  discoveryFile?: string;
  ready?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}, context?:RoomTurnCustody): Promise<Record<string, unknown>> {
    if(context){
      assertRoomTurnCustody(context);context.current();
      const sourceInit={...init,headers:{[ROOM_TOKEN_HEADER]:originalToken,...(init.body===undefined?{}:{'content-type':'application/json'}),...(init.headers??{})},redirect:'error' as const,cache:'no-store' as const};
      let acquired:Response|undefined,bodyEntered=false;
      try{
        const response=await context.sdk<Response>(fetchImpl,undefined,[`${BROKER_BASE_URLS[0]}${path}`,sourceInit],{
          accept(value){if(!value||typeof value!=='object'||roomResponseTypes.isProxy(value))return false;const names=roomResponseKeys(value);for(let i=0;i<names.length;i++){const row=roomResponseDescriptor(value,names[i]!);if(!row||!roomResponseOwn(row,'value'))return false;}if(typeof roomClientApply(roomResponseOk,value,[])!=='boolean')return false;acquired=value as Response;return true;},consumer:roomResponseJson,
        });
        const ok=await context.consumeResource<boolean>(roomResponseOk,response,[]);
        bodyEntered=true;
        const payload=await context.consumeResource<unknown>(roomResponseJson,response,[]);
        if(!ok)throw Error('ROOM_TURN_BROKER_UNAVAILABLE');context.current();return payload as Record<string,unknown>;
      }catch(first){
        // A graph fault can reject delivery after the original resource was
        // acquired. Its real body still needs the same fixed consumer. This
        // does not deliver data or certify known: custody joins every raw tail.
        if(acquired&&!bodyEntered){
          bodyEntered=true;
          try{
            const cleanup=context.consumeResource<unknown>(roomResponseJson,acquired,[]);
            const observer=roomClientApply(roomNativeThen,cleanup,[()=>undefined,(raw:unknown)=>{context.inventory(raw);}]);context.inventory(observer);
          }catch(raw){context.inventory(raw);}
        }
        throw first;
      }
    }
    await options.ready?.();
    let lastError: unknown = null;
    for (const baseUrl of [desktopServiceUrl('broker', options.discoveryFile)]) {
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...init,
          headers: {
            [ROOM_TOKEN_HEADER]: originalToken,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(init.headers ?? {}),
          },
        });
        const payload = await response.json() as Record<string, unknown>;
        return payload;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('broker_unavailable');
  }

  const json = (method: string, path: string, input: unknown) => request(path, {
    method,
    body: JSON.stringify(input ?? {}),
  });
  const roomIdFrom = (input: unknown) => (
    input && typeof input === 'object' && typeof (input as { roomId?: unknown }).roomId === 'string'
      ? (input as { roomId: string }).roomId
      : ''
  );

  const originalToken=options.token;
  const originalClient = {
    getRoomConversionSource:createRoomConversionSourceReader({token:originalToken,fetchImpl}),
    sendScheduledRoomWake: (input:unknown)=>json('POST',`/rooms/${encodeURIComponent(roomIdFrom(input))}/scheduled-wakes`,input),
    createRoom: (input: unknown) => json('POST', '/rooms', input),
    cancelDiscussion: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/discussion/cancel`, input),
    archiveRoom: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/archive`, input),
    deleteRoom: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/delete`, input),
    updateRoomMembers: (input: unknown) => json('PUT', `/rooms/${encodeURIComponent(roomIdFrom(input))}/members`, input),
    sendRoomMessage: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/messages`, input),
    markRoomSeen: (input: unknown) => json('POST', `/rooms/${encodeURIComponent(roomIdFrom(input))}/seen`, input),
    listPendingWakes: (logicalAgentId: string) => request(`/room-wakes?logicalAgentId=${encodeURIComponent(logicalAgentId)}`),
    claimWake: (input: unknown) => json('POST', '/room-wakes/claim', input),
    completeWake: (input: unknown) => json('POST', '/room-wakes/complete', input),
    getRoomSnapshot: (roomId: string) => request(`/rooms/${encodeURIComponent(roomId)}`),
    listRooms: () => request('/rooms'),
    // design §6.2：agent-internal 语义 wrapper，供
    // collaboration-room-wake-dispatcher.ts 在唤醒执行期间按需补取历史使用。
    // 不暴露给 renderer preload（renderer 走既有的 getRoomSnapshot/getRoom
    // 全量 UI 快照路径）。
    //
    // design §6.2 RoomHistoryReadCapability：调用专用的 claim-token-bound
    // POST /room-wakes/history-page 端点（intent-broker 侧新增，2026-09-02），
    // 不调用宽松鉴权的 GET /rooms/:roomId/messages——那条路径走的是
    // desktop-main-user/kswarm-system ctx，与 agent 的 wake claim 身份完全
    // 无关，不满足"claim token 派生 roomId 并与请求绑定 roomId 比较，再核对
    // exact delivery token、wakeStatus='claimed'、active member/room 和
    // current discussion epoch"的要求。
    listRoomMessagesPage: (input: {
      roomId: string;
      claimToken: string;
      afterSequence?: number;
      beforeSequence?: number;
      limit?: number;
    }) => json('POST', '/room-wakes/history-page', {
      claimToken: input.claimToken,
      roomId: input.roomId,
      ...(input.afterSequence !== undefined ? { afterSequence: input.afterSequence } : {}),
      ...(input.beforeSequence !== undefined ? { beforeSequence: input.beforeSequence } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
  };
  roomClientApply(roomClientSet,roomClients,[originalClient,{snapshot:(roomId:string,context:RoomTurnCustody)=>request(`/rooms/${encodeURIComponent(roomId)}`,{},context),claim:(input:unknown,context:RoomTurnCustody)=>request('/room-wakes/claim',{method:'POST',body:JSON.stringify(input)},context),complete:(input:unknown,context:RoomTurnCustody)=>request('/room-wakes/complete',{method:'POST',body:roomStringify(input)},context),history:(input:unknown,context:RoomTurnCustody)=>request('/room-wakes/history-page',{method:'POST',body:roomStringify(input)},context)}]);
  const assertAdmission=(service:unknown)=>{assertOriginalKSwarmBrokerClientToken(service,originalToken);if(fetchImpl!==originalBrokerFetch)throw Error('BROKER_DSH_ORIGINAL_FETCH_REQUIRED');};
  roomClientApply(roomClientSet,admissionClients,[originalClient,{assert:assertAdmission,async perform(source:unknown,proof:unknown){
    const frame=readOriginalMainDshBrokerFrame(source,proof);assertAdmission(frame.service);
    const stock=frame.stock,body={protocol:'broker_dsh_control_v1',challenge:frame.challenge,requestDigest:brokerAdmissionDigest(frame.input),input:frame.input};
    const expectedBody=roomStringify(body),destination=`${BROKER_BASE_URLS[0]}/rooms/admission-control/${frame.action}`;
    const engine=createBrokerAdmissionLoopbackFetch({action:frame.action,expectedBody,signal:frame.signal});
    // These fixed narrowing hooks cannot mint authority. The shared engine
    // owns the actual Node resources and repeats local checks next to send.
    attachOriginalSingleRequestResourceGate(engine,{
      beforeSource(){stock.syncVoid(frame.assertCurrent,undefined,[]);},
      afterSourceLocal(){stock.syncVoid(frame.assertLocal,undefined,[]);},
      observeRawFailure(raw:unknown){stock.inventory(raw);},
    });
    const consumeOriginalAdmissionResponse=async function(this:Response):Promise<unknown>{
      const reply=await readSingleRequestOwnedReply(engine,this);
      for(let i=0;i<reply.ownExtras.length;i++)stock.inventory(reply.ownExtras[i]);
      if(reply.ownUnknown){
        stock.inventory(brokerControlUnknown);
        throw Error('BROKER_DSH_CONTROL_RESOURCE_UNCONFIRMED');
      }
      const physical=readOriginalSingleRequestPhysicalReceipt(reply);
      if(physical.destination!==destination||physical.method!=='POST'||physical.requestBody!==expectedBody)throw Error('BROKER_DSH_CONTROL_TRANSPORT_CONFLICT');
      physical.assertKnown();
      const text=roomClientApply(brokerControlDecode,brokerControlDecoder,[reply.bytes]) as string;
      return brokerControlParse(text);
    };
    const send=()=>engine(destination,{method:'POST',signal:frame.signal,redirect:'error',cache:'no-store',headers:{[ROOM_TOKEN_HEADER]:originalToken,'content-type':'application/json'},body:expectedBody});
    stock.syncVoid(frame.assertCurrent,undefined,[]);
    let acquired:Response|undefined,entered=false,authenticating=false;
    try{
      const response=await stock.sdk<Response>(send,undefined,[],{
        accept(value){if(!isOriginalSingleRequestResponse(engine,value))return false;acquired=value as Response;return true;},
        consumer:consumeOriginalAdmissionResponse,
      });
      entered=true;
      const payload=await stock.consumeResource<unknown>(consumeOriginalAdmissionResponse,response,[]);
      authenticating=true;const output=readBrokerAdmissionReply(originalToken,frame.challenge,frame.input,payload);stock.syncVoid(frame.assertCurrent,undefined,[]);return output;
    }catch(first){
      // The private transport's unknown graph cannot become a known finite
      // Error DTO merely by crossing into this frame's separate custody.
      if(isSingleRequestSourceUnknown(first))stock.inventory(brokerControlUnknown);

      if(authenticating){const code=readBrokerControlRejection(first);if(!code||code==='admission_baseline_required'||code==='admission_authority_conflict'||code==='admission_baseline_conflict'||code==='admission_storage_conflict')retireOriginalMainDshBrokerFrame(source,proof);}
      if(acquired&&!entered){entered=true;try{const cleanup=stock.consumeResource(consumeOriginalAdmissionResponse,acquired,[]),observer=roomClientApply(roomNativeThen,cleanup,[()=>undefined,(raw:unknown)=>{stock.inventory(raw);}]);stock.inventory(observer);}catch(raw){stock.inventory(raw);}}
      throw first;
    }
  }}]);
  return originalClient;
}
