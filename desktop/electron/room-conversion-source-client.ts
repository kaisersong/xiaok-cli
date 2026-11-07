import {z} from 'zod';
import {readRoomConversionJson} from './room-conversion-bounded-json.js';
const reference=z.string().min(1).max(256).refine(value=>value.trim()===value&&!value.includes('\0'));
const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const ROOM_CONVERSION_SOURCE_SNAPSHOT=z.object({ok:z.literal(true),protocol:z.literal('room_conversion_source_v1'),realmId:z.string().uuid(),actorUserId:reference,
 roomId:reference,roomRevision:revision,membershipRevision:revision,messageId:reference,messageSequence:revision,
 text:z.string().max(65536).refine(value=>Buffer.byteLength(value,'utf8')<=65536),
 contextScope:z.discriminatedUnion('kind',[z.object({kind:z.literal('room_only')}).strict(),z.object({kind:z.literal('project'),projectId:reference}).strict()]),
}).strict();
export type RoomConversionSourceSnapshot=z.infer<typeof ROOM_CONVERSION_SOURCE_SNAPSHOT>;
/** Unlike the old UI snapshot client, this exact source transport never
 * redirects or retries at another endpoint after an authority failure. */
export function createRoomConversionSourceReader(options:{token:string;fetchImpl:typeof fetch}){
 const token=options.token,fetchImpl=options.fetchImpl;
 return async(roomId:string,messageId:string,signal:AbortSignal,assertNativeCurrent:()=>void=()=>{}):Promise<RoomConversionSourceSnapshot>=>{
  signal.throwIfAborted();if(!reference.safeParse(roomId).success||!reference.safeParse(messageId).success)throw Error('room_conversion_input_invalid');
  if(!token)throw Error('room_conversion_source_unavailable');
  const response=await fetchImpl(`http://127.0.0.1:4318/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/conversion-source`,{
   method:'GET',signal,redirect:'error',cache:'no-store',headers:{'x-intent-broker-room-token':token},
  });
  try{
   if(!response.ok){await response.body?.cancel();throw Error('room_conversion_source_unavailable');}
   const parsed=ROOM_CONVERSION_SOURCE_SNAPSHOT.safeParse(await readRoomConversionJson(response,512*1024,signal,assertNativeCurrent));
   signal.throwIfAborted();assertNativeCurrent();
   if(!parsed.success||parsed.data.roomId!==roomId||parsed.data.messageId!==messageId)throw Error('room_conversion_source_unavailable');return parsed.data;
  }catch(error){if(signal.aborted)throw signal.reason;assertNativeCurrent();throw Error('room_conversion_source_unavailable',{cause:error});}
 };
}
