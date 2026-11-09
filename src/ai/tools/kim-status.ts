import {z} from 'zod/v3';
import type {Tool} from '../../types.js';
import {defaultKimDecisionRuntime,type KimDecisionRuntime} from '../kim/runtime.js';
const inputSchema=z.object({}).strict();
export function createKimStatusTool(runtime:KimDecisionRuntime=defaultKimDecisionRuntime):Tool{return {
 permission:'safe',definition:{name:'kim_model_status',description:'只读检查用户已配置的本地 K-IM 模型开关与服务健康。严禁修改配置、启动进程或尝试其他地址；不可用时如实说明原因，引导用户检查模型设置。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 execute:async(input,context)=>{inputSchema.parse(input);const signal=context?.signal??new AbortController().signal;signal.throwIfAborted();const config=await runtime.view(),health=await runtime.health(signal);signal.throwIfAborted();return JSON.stringify({enabled:config.enabled,...health});},
};}
