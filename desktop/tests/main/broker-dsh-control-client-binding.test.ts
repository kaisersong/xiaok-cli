// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {createKSwarmService,assertOriginalKSwarmBrokerClientToken,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {createCollaborationRoomBrokerClient,assertOriginalBrokerAdmissionClient,performOriginalBrokerAdmission} from '../../electron/collaboration-room-broker-client.js';
const owned:ReturnType<typeof createKSwarmService>[]=[];
afterEach(async()=>{for(const service of owned.splice(0))await sealAndDrainKSwarmServiceInstance(service);});
it('pins actual original KSwarm constructor credential without exposing or rereading mutable public service getters',()=>{
 const service=createKSwarmService();owned.push(service);const token=service.getIntentBrokerRoomToken();
 let getters=0;Object.defineProperty(service,'getIntentBrokerRoomToken',{get(){getters++;throw Error('late getter');}});
 expect(()=>assertOriginalKSwarmBrokerClientToken(service,token)).not.toThrow();
 expect(()=>assertOriginalKSwarmBrokerClientToken(service,'foreign-token')).toThrow();
 const foreign=new Proxy({}, {get(){getters++;throw Error();},getOwnPropertyDescriptor(){getters++;throw Error();}});
 expect(()=>assertOriginalKSwarmBrokerClientToken(foreign,token)).toThrow();expect(()=>assertOriginalKSwarmBrokerClientToken(Object.create(null,Object.getOwnPropertyDescriptors(service)),token)).toThrow();expect(getters).toBe(0);
});
it('genuine client with foreign token/transport is rejected before any HTTP and arbitrary frame/source cannot enter control',async()=>{
 const service=createKSwarmService();owned.push(service);const token=service.getIntentBrokerRoomToken();let sdk=0,getters=0;
 const client=createCollaborationRoomBrokerClient({token}),wrong=createCollaborationRoomBrokerClient({token:'foreign-token'}),custom=createCollaborationRoomBrokerClient({token,fetchImpl:(()=>{sdk++;throw Error();}) as typeof fetch});
 expect(()=>assertOriginalBrokerAdmissionClient(client,service)).not.toThrow();expect(()=>assertOriginalBrokerAdmissionClient(wrong,service)).toThrow();expect(()=>assertOriginalBrokerAdmissionClient(custom,service)).toThrow();
 const foreign=new Proxy({}, {get(){getters++;throw Error();},getOwnPropertyDescriptor(){getters++;throw Error();}});
 expect(()=>assertOriginalBrokerAdmissionClient(foreign,service)).toThrow();await expect(()=>performOriginalBrokerAdmission(client,foreign,foreign)).rejects.toThrow();expect(sdk).toBe(0);expect(getters).toBe(0);
});

it('actual private and ordinary HTTP use the captured constructor credential after late options getter replacement',async()=>{
 const {createServer}=await import('node:http'),{createRoomTurnCustody}=await import('../../electron/original-room-turn-custody.js'),{readOriginalRoomSnapshot}=await import('../../electron/collaboration-room-broker-client.js');
 const headers:unknown[]=[],nativeFetch=fetch,server=createServer((request,response)=>{headers.push(request.headers['x-intent-broker-room-token']);response.setHeader('content-type','application/json');response.end('{"ok":true}');});
 await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
 const address=server.address();if(!address||typeof address==='string')throw Error('fixture_address');const origin='http://127.0.0.1:'+address.port;
 let getters=0;const options={token:'original-fixture-credential',fetchImpl:((url:unknown,init:RequestInit)=>{const input=new URL(String(url));return nativeFetch(new URL(input.pathname,origin),init);}) as typeof fetch},client=createCollaborationRoomBrokerClient(options);
 Object.defineProperty(options,'token',{get(){getters++;throw Error('late token getter');}});
 try{await client.listRooms();const stock=createRoomTurnCustody();await stock.root(()=>readOriginalRoomSnapshot(client,stock,'original-room'));await stock.drain();expect(headers).toEqual(['original-fixture-credential','original-fixture-credential']);expect(getters).toBe(0);}
 finally{await new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));}
});
