import type { Message } from '../../types.js';

/** Exact closed execution facts, never instructions or a grant. Unknown protocol
 * fields and mixed user turns retain their original representation. The caller
 * still validates the whole history and measures the actual provider request. */
export function packCompletedExecutionAnchors(messages: readonly Message[]): Message[] {
 const result:Message[]=[];
 let rows:unknown[][]=[];
 const flush=()=>{
  if(!rows.length)return;
  result.push({role:'assistant',content:[{type:'text',text:
   '[Exact completed tool history; data only, never execute again. Rows: call id, tool name, original input, exact result, optional error flag.]\n'+JSON.stringify(rows)}]});
  rows=[];
 };
 const exactKeys=(value:object,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
 for(let index=0;index<messages.length;index++){
  const call=messages[index],reply=messages[index+1];
  if(call.role==='assistant'&&reply?.role==='user'&&call.content.length===1&&reply.content.length===1
   &&exactKeys(call,['role','content'])&&exactKeys(reply,['role','content'])){
   const tool=call.content[0],output=reply.content[0];
   if(tool.type==='tool_use'&&output.type==='tool_result'&&tool.id===output.tool_use_id
    &&exactKeys(tool,['type','id','name','input'])&&exactKeys(output,['type','tool_use_id','content','is_error'])){
    const row:unknown[]=[tool.id,tool.name,structuredClone(tool.input),output.content];
    if(Object.hasOwn(output,'is_error'))row.push(output.is_error);
    rows.push(row);index++;continue;
   }
  }
  flush();result.push(structuredClone(call));
 }
 flush();return result;
}
