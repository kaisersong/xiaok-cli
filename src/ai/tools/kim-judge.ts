import {z} from 'zod/v3';
import type {Tool} from '../../types.js';
import {KIM_MODEL,KIM_WINDOW_SCHEMA} from '../kim/contracts.js';
import {defaultKimDecisionRuntime,type KimDecisionRuntime} from '../kim/runtime.js';
const schema=z.object({windows:z.array(KIM_WINDOW_SCHEMA.extend({context:KIM_WINDOW_SCHEMA.shape.context.unwrap().max(10).optional()})).min(1).max(8)}).strict();
const message={type:'object',properties:{sender:{type:'string',maxLength:256},text:{type:'string',minLength:1,maxLength:10000},sentAt:{type:'number',minimum:0},id:{type:'string',maxLength:256}},required:['sender','text'],additionalProperties:false};
export function createKimJudgeTool(runtime:KimDecisionRuntime=defaultKimDecisionRuntime):Tool{return {
 permission:'safe',definition:{name:'kim_judge_messages',description:'使用用户已启用的本地 K-IM 模型判断中文企业群聊的类别、关注概率、待办概率和重要/紧急程度。只能处理用户提供或已授权读取的消息；严禁把评分当作发送、建任务、批准或更改配置的授权。只返回七项结构化判断，不生成回复或执行动作。服务不可用时应说明失败，不自动转发群聊到云端。',inputSchema:{type:'object',properties:{windows:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{group:{type:'string',maxLength:200},target:message,context:{type:'array',maxItems:10,items:message}},required:['group','target'],additionalProperties:false}}},required:['windows'],additionalProperties:false}},
 execute:async(input,context)=>{const {windows}=schema.parse(input);const results=await runtime.judge(windows,context?.signal??new AbortController().signal);return JSON.stringify({model:KIM_MODEL,local:true,results});},
};}
