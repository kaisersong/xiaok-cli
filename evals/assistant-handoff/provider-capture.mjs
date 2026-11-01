import {writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
/** Passive copy of a real response. Never fabricates/replays a provider response.
 * Keep partial bytes on cancellation; unknown usage is never replaced with zero.
 */
export async function captureProviderResponse(response,{file,redact=value=>value,maxBytes=1024*1024}){
 const result={capture:'incomplete',usage:null,finishReason:null,bytes:0},hash=createHash('sha256');
 writeFileSync(file,'',{mode:0o600,flag:'wx'});let reader;
 try{
  reader=response.clone().body.getReader();const decoder=new TextDecoder();let pending='';
  const parse=line=>{if(!line.startsWith('data: '))return;try{const value=JSON.parse(line.slice(6));if(value.usage)result.usage=value.usage;if(value.choices?.[0]?.finish_reason)result.finishReason=value.choices[0].finish_reason;}catch{}};
  while(true){const chunk=await reader.read();if(chunk.done)break;result.bytes+=chunk.value.byteLength;if(result.bytes>maxBytes){void reader.cancel();throw Error('capture_byte_limit');}hash.update(chunk.value);const text=decoder.decode(chunk.value,{stream:true});appendFileSync(file,redact(text));pending+=text;const lines=pending.split('\n');pending=lines.pop();for(const line of lines)parse(line);}
  pending+=decoder.decode();if(pending)parse(pending);result.capture='complete';
 }catch(error){result.error={name:error.name,detail:redact(error.message).slice(0,160)};}
 result.sha256=hash.digest('hex');return result;
}
