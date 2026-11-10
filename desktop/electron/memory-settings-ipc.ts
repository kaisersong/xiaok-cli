import { z } from 'zod';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcHandleRegistrar } from './shutdown-aware-ipc-main.js';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { MemorySettingsService } from './memory-settings-service.js';
const choice = z.object({id:z.string(),label:z.string(),eligible:z.boolean(),reason:z.enum(['missing_model','unsupported_protocol','non_text_model','unknown_capability']).nullable(),source:z.enum(['provider_catalog','config_declared']).nullable(),contextLimit:z.number().nullable(),quality:z.literal('not_evaluated')}).strict();
export const memorySettingsSchema = z.object({version:z.literal(1),embeddingModelId:z.string(),compactionModelId:z.string().nullable(),resolvedCompactionModelId:z.string().nullable(),defaultCompactionModel:choice,compactionModels:z.array(choice),warning:z.enum(['legacy_model_unresolved','invalid_model']).nullable()}).strict();
export function registerMemorySettingsIpc(options: {
  registrar:IpcHandleRegistrar; service:MemorySettingsService;
  source(event:IpcMainInvokeEvent): {requestSource:'user';assertCurrent:()=>void};
}):void {
  function handle<I,O>(name:string,input:z.ZodType<I>,output:z.ZodType<O>,riskTags:RiskTag[],run:(value:I,source:ReturnType<typeof options.source>)=>Promise<O>) {
    registerIpcHandler({registrar:options.registrar,channel:'desktop:'+name,input,wireInput:z.unknown() as z.ZodType<I>,inputStage:'afterHostAuthorization',output,sourceFile:'desktop/electron/memory-settings-ipc.ts',rolloutRound:39,riskTags,
      beforeInput:event=>{options.source(event);},beforeOutput:event=>{options.source(event);},
      handler:async(raw,event,helpers)=>{const source=options.source(event);const input=helpers!.parseInput(raw);const result=await run(input,source);source.assertCurrent();return result;},
    });
  }
  handle('memoryGetSettings',z.undefined(),memorySettingsSchema,['fs-read','fs-write-userData'],(_value,source)=>options.service.settings(source));
  handle('memoryCancelCompaction',z.undefined(),z.boolean(),['internal-mutation'],async(_value,source)=>options.service.cancel(source));
  handle('deleteEmbeddingModel',z.string().min(1).max(128),z.void(),['fs-read','fs-delete'],(id,source)=>options.service.deleteEmbeddingModel(id,source));
}
