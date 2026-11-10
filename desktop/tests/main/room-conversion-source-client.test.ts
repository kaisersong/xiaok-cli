// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createCollaborationRoomBrokerClient} from '../../electron/collaboration-room-broker-client.js';
const source=()=>({ok:true,protocol:'room_conversion_source_v1',realmId:'11111111-1111-4111-8111-111111111111',actorUserId:'user.local',roomId:'room',roomRevision:2,membershipRevision:1,messageId:'message',messageSequence:3,text:'Original body',contextScope:{kind:'room_only'}});
function fixture(response:Response){const fetchImpl=vi.fn(async()=>response);return {fetchImpl,client:createCollaborationRoomBrokerClient({token:'native-desktop-token',fetchImpl:fetchImpl as unknown as typeof fetch})};}
it('strict source method uses the dedicated native credential, exact route and bounded nonredirecting request',async()=>{
 const f=fixture(Response.json(source())),signal=new AbortController().signal;
 expect(await f.client.getRoomConversionSource('room','message',signal)).toEqual(source());
 expect(f.fetchImpl).toHaveBeenCalledOnce();expect(f.fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4318/rooms/room/messages/message/conversion-source',expect.objectContaining({method:'GET',signal,redirect:'error',cache:'no-store',headers:{'x-intent-broker-room-token':'native-desktop-token'}}));
});
it.each([401,403,404,409,503])('HTTP %i is final and cannot fall back to another broker or wide snapshot',async status=>{
 const f=fixture(Response.json({ok:false,code:'room_actor_forbidden'},{status}));await expect(f.client.getRoomConversionSource('room','message',new AbortController().signal)).rejects.toThrow('room_conversion_source_unavailable');expect(f.fetchImpl).toHaveBeenCalledOnce();
});
it('rejects mismatched identity, unknown schemas/extensions and duplicate JSON keys',async()=>{
 for(const value of [{...source(),roomId:'other'},{...source(),messageId:'other'},{...source(),realmId:'invalid'},{...source(),protocol:'future'},{...source(),messages:[]},{...source(),contextScope:{kind:'unknown'}},{...source(),text:'你'.repeat(30000)}]){
  const f=fixture(Response.json(value));await expect(f.client.getRoomConversionSource('room','message',new AbortController().signal)).rejects.toThrow('room_conversion_source_unavailable');
 }
 const f=fixture(new Response(JSON.stringify(source()).replace('"ok":true','"ok":false,"ok":true')));await expect(f.client.getRoomConversionSource('room','message',new AbortController().signal)).rejects.toThrow('room_conversion_source_unavailable');
});
it('enforces a real response stream bound without trusting Content-Length and cancels rejected bodies',async()=>{
 let cancelled=0;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(524289));},cancel(){cancelled++;}}),f=fixture(new Response(stream));
 await expect(f.client.getRoomConversionSource('room','message',new AbortController().signal)).rejects.toThrow('room_conversion_source_unavailable');expect(cancelled).toBe(1);expect(f.fetchImpl).toHaveBeenCalledOnce();
});
it('rejects aborted/source-invalid inputs before entering network',async()=>{
 const f=fixture(Response.json(source())),controller=new AbortController();controller.abort(Error('stopped'));
 await expect(f.client.getRoomConversionSource('room','message',controller.signal)).rejects.toThrow('stopped');
 await expect(f.client.getRoomConversionSource('','message',new AbortController().signal)).rejects.toThrow('room_conversion_input_invalid');expect(f.fetchImpl).not.toHaveBeenCalled();
});
it('cancels a source body when native authorization is lost immediately after headers',async()=>{
 let cancelled=0;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify(source())));},cancel(){cancelled++;}}),f=fixture(new Response(stream));
 await expect(f.client.getRoomConversionSource('room','message',new AbortController().signal,()=>{throw Error('task_actor_forbidden');})).rejects.toThrow();expect(cancelled).toBe(1);
});
it('aborts a stalled body and waits for its actual cancellation',async()=>{
 let cancelled=0;const stream=new ReadableStream<Uint8Array>({cancel(){cancelled++;}}),f=fixture(new Response(stream)),controller=new AbortController();
 const pending=f.client.getRoomConversionSource('room','message',controller.signal);await new Promise<void>(done=>setImmediate(done));controller.abort(Error('stopped'));
 await expect(pending).rejects.toThrow('stopped');expect(cancelled).toBe(1);
});
