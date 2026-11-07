import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {z} from 'zod';
import {registerIpcHandler,resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import type {IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
beforeEach(()=>resetIpcSchemaRegistryForTests());afterEach(()=>vi.unstubAllEnvs());
it('runs final output admission after a real schema callback revokes its original lifetime',async()=>{
 let handler!:IpcHandlerListener,live=true,cleaned=0,cleanupCause:unknown;const order:string[]=[],original=Error('original output lifetime withdrawn');
 registerIpcHandler({registrar:{handle(_channel,fn){handler=fn;}},channel:'test:final-output',input:z.tuple([]),payloadMode:'tuple',wireInput:z.custom<unknown[]>(()=>true),inputStage:'afterHostAuthorization',
  output:z.object({ok:z.literal(true)}).strict().superRefine(()=>{order.push('schema');live=false;}),rolloutRound:39,sourceFile:'desktop/tests/main/ipc-final-output-admission.test.ts',
  handler:async(args,_event,helpers)=>{helpers!.parseInput(args);helpers!.onFailure((error:unknown)=>{cleanupCause=error;cleaned++;});order.push('handler');return{ok:true as const};},
  afterOutputValidation(){order.push('final');if(!live)throw original;},
 } as Parameters<typeof registerIpcHandler>[0]);
 await expect(handler({} as never)).rejects.toBe(original);expect(order).toEqual(['handler','schema','final']);expect(cleaned).toBe(1);expect(cleanupCause).toBe(original);
});
it('does not let a new production fallback object bypass the original projection membership',async()=>{
 vi.stubEnv('NODE_ENV','production');let handler!:IpcHandlerListener,cleaned=0;const values=new WeakSet<object>(),original={ok:true as const,extra:true};
 registerIpcHandler({registrar:{handle(_channel,fn){handler=fn;}},channel:'test:final-output-fallback',input:z.tuple([]),payloadMode:'tuple',wireInput:z.custom<unknown[]>(()=>true),inputStage:'afterHostAuthorization',
  output:z.object({ok:z.literal(true)}).strict(),rolloutRound:39,sourceFile:'desktop/tests/main/ipc-final-output-admission.test.ts',
  handler:async(args,_event,helpers)=>{helpers!.parseInput(args);helpers!.onFailure(()=>{cleaned++;});values.add(original);return original;},
  afterOutputValidation(value:object){if(!values.has(value))throw Error('original_projection_required');},
 } as Parameters<typeof registerIpcHandler>[0]);
 await expect(handler({} as never)).rejects.toThrow('original_projection_required');expect(cleaned).toBe(1);
});

it('applies the same final admission to the input-error fallback branch',async()=>{
 let handler!:IpcHandlerListener,checks=0;
 registerIpcHandler({registrar:{handle(_channel,fn){handler=fn;}},channel:'test:final-input-fallback',input:z.object({required:z.literal(true)}),output:z.object({ok:z.literal(false),error:z.string()}).strict(),rolloutRound:38,sourceFile:'desktop/tests/main/ipc-final-output-admission.test.ts',
  handler:async()=>({ok:false as const,error:'unused'}),inputError:()=>({ok:false as const,error:'invalid_input'}),afterOutputValidation(){checks++;throw Error('input_fallback_has_no_original_projection');},
 });
 await expect(handler({} as never,{})).rejects.toThrow('input_fallback_has_no_original_projection');expect(checks).toBe(1);
});
