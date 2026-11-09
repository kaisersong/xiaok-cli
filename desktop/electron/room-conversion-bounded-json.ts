import {assertCapturedJsonUniqueKeys} from '../../src/runtime/verification/captured-source-json.js';
/** Fixed local-source protocols only. Bounds actual streamed bytes, and owns
 * response cancellation even when the native caller disappears after headers. */
export async function readRoomConversionJson(response:Response,maximum:number,signal:AbortSignal,assertNativeCurrent:()=>void):Promise<unknown>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,aborted:(()=>void)|undefined;
 try{
  signal.throwIfAborted();assertNativeCurrent();if(response.redirected||!response.body)throw Error('room_conversion_response_invalid');
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  const stop=new Promise<never>((_resolve,reject)=>{aborted=()=>reject(signal.reason??Error('room_conversion_closed'));signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();});
  if(Number(response.headers.get('content-length'))>maximum)throw Error('room_conversion_response_invalid');
  for(;;){const chunk=await Promise.race([reader.read(),stop]);signal.throwIfAborted();assertNativeCurrent();if(chunk.done)break;
   size+=chunk.value.byteLength;if(size>maximum)throw Error('room_conversion_response_invalid');chunks.push(chunk.value);
  }
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));assertCapturedJsonUniqueKeys(text,'room_conversion_response_invalid');return JSON.parse(text);
 }finally{
  if(aborted)signal.removeEventListener('abort',aborted);
  if(reader){try{await reader.cancel();}finally{reader.releaseLock();}}
  else await response.body?.cancel();
 }
}
