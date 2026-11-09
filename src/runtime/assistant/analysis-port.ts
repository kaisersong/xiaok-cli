/** Main-private provider contract. The legacy text-only LoopLLMPort cannot
 * satisfy it and must never be silently adapted by character counting. */
export interface AssistantAnalysisPort {
 readonly contract:{id:string;provider:string;model:string;tokenizer:string;protocolOverheadMeasured:true;maxOutputTokensEnforced:true;usageIncludesReasoningAndProtocol:true};
 measureInput(input:{systemPrompt:string;userMessage:string}):number|Promise<number>;
 complete(input:{attemptId:string;systemPrompt:string;userMessage:string;maxOutputTokens:number;signal?:AbortSignal}):Promise<{text:string;usage:'unknown'|{inputTokens:number;outputTokens:number};finish:'complete'|'timeout'|'cancelled'|'truncated'}>;
}
export function assistantAnalysisContractAvailable(port:AssistantAnalysisPort|undefined):port is AssistantAnalysisPort{
 const c=port?.contract;
 return !!c&&[c.id,c.provider,c.model,c.tokenizer].every(value=>typeof value==='string'&&!!value&&value.length<=256)&&c.protocolOverheadMeasured===true&&c.maxOutputTokensEnforced===true&&c.usageIncludesReasoningAndProtocol===true&&typeof port?.measureInput==='function'&&typeof port.complete==='function';
}
