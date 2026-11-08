import type {Tool} from '../../src/types.js';
import {KIM_MODEL,KIM_SCORES_SCHEMA} from '../../src/ai/kim/contracts.js';
import type {KimDecisionRuntime} from '../../src/ai/kim/runtime.js';
import type {AssistantYzjClient} from './assistant-yzj-cli.js';
import {ASSISTANT_MESSAGE_RANGE} from './assistant-message-reader.js';
/** Whole source rows only: keep the JSON and its coverage valid below the common tool-result byte cap. */
const OUTPUT_BUDGET=100000;
export function createAssistantMessageTools(deps:{cloud:Pick<AssistantYzjClient,'identity'|'readMessages'>;kim:KimDecisionRuntime;timeZone():string}):Tool[]{return [{permission:'safe',definition:{name:'assistant_analyze_messages',description:'只读分析当前云之家账号已连接消息。按明确带时区的起止时间（最多7天，结束不含）读取最近5个会话各20条原文，代码组装前文并用本地K-IM判断最多40条；始终是部分采样，严禁称全量周报。不会刷新邮件/新闻/日历或发送、建任务。关注概率不代表本人责任，自己发送的承诺不会过滤。严禁传入改写正文、账号、profile、端点或把分数当执行授权。',inputSchema:{type:'object',properties:{startAt:{type:'string',format:'date-time'},endAt:{type:'string',format:'date-time'}},required:['startAt','endAt'],additionalProperties:false}},execute:async(input,context)=>{
 const range=ASSISTANT_MESSAGE_RANGE.parse(input),lease=await deps.kim.begin();if(!lease.config.enabled)throw Error('kim_disabled');
 const signal=AbortSignal.any([context?.signal??new AbortController().signal,AbortSignal.timeout(45000)]),zone=deps.timeZone(),started=Date.now();signal.throwIfAborted();
 const sample=await deps.cloud.readMessages(range,signal,()=>context?.executionProgress?.progress(),zone),readElapsedMs=Date.now()-started,selected=sample.windows.slice(0,40),judgeStart=Date.now();
 if(!await deps.kim.current(lease))throw Error('kim_config_changed');signal.throwIfAborted();
 const judgments=selected.length?await deps.kim.judge(selected.map(m=>m.window),signal,lease):[];
 const judgeElapsedMs=Date.now()-judgeStart;if(judgments.length!==selected.length)throw Error('kim_invalid_response');
 signal.throwIfAborted();if(await deps.cloud.identity(signal)!==sample.identity)throw Error('assistant_account_changed');if(!await deps.kim.current(lease))throw Error('kim_config_changed');signal.throwIfAborted();if(deps.timeZone()!==zone)throw Error('assistant_timezone_changed');
 const items=selected.map((m,i)=>{const s=KIM_SCORES_SCHEMA.parse(judgments[i]);return {sourceId:m.window.target.id,groupId:m.groupId,group:m.window.group,text:m.window.target.text,sentAt:new Date(m.window.target.sentAt!).toISOString(),rawSentAt:m.rawSentAt,timeAssumed:m.timeAssumed,direction:m.direction,scores:{category:s.category_top,categoryConfidence:s.category[s.category_top],sentiment:s.sentiment_top,sentimentConfidence:s.sentiment[s.sentiment_top],importance:s.importance.expected,urgency:s.urgency.expected,intensity:s.intensity.expected,needs_attention:s.needs_attention,has_todo:s.has_todo}};});
 const result={asOf:new Date().toISOString(),model:KIM_MODEL,local:true,requestedRange:range,observedRange:sample.observedRange,coverage:{...sample.coverage,analyzed:selected.length,analysisLimited:Math.max(0,sample.windows.length-selected.length),outputOmitted:0},timings:{readElapsedMs,judgeElapsedMs},interpretation:{attentionIsPersonalResponsibility:false,todoIsCreatedTask:false,selfMessagesExcluded:false},items};
 let output=JSON.stringify(result);while(Buffer.byteLength(output)>OUTPUT_BUDGET&&result.items.length){result.items.pop();result.coverage.outputOmitted++;output=JSON.stringify(result);}return output;
 }}];}
