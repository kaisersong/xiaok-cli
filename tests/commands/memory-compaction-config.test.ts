import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Command} from 'commander';
import {DEFAULT_CONFIG,type Config} from '../../src/types.js';
const fixture=vi.hoisted(()=>({config:null as Config|null,store:{compact:vi.fn(),close:vi.fn(),setLLMFn:vi.fn(),getStats:vi.fn()},resolve:vi.fn(),adapter:vi.fn(),llm:vi.fn()}));
vi.mock('../../src/utils/config.js',()=>({loadConfig:async()=>fixture.config,getConfigDir:()=>'/synthetic-unused'}));
vi.mock('../../src/ai/memory/store.js',()=>({createMemoryStoreAsync:async()=>fixture.store}));
vi.mock('../../src/ai/providers/control-plane.js',()=>({resolveRuntimeModelBinding:(...args:unknown[])=>fixture.resolve(...args)}));
vi.mock('../../src/ai/models.js',()=>({createAdapterFromBinding:(...args:unknown[])=>fixture.adapter(...args)}));
vi.mock('../../src/ai/memory/layered-store.js',()=>({createLLMFromAdapter:()=>fixture.llm}));
import {registerMemoryCommands} from '../../src/commands/memory.js';
function run(){const program=new Command();registerMemoryCommands(program);return program.parseAsync(['node','fixture','memory','compact']);}
beforeEach(()=>{
 vi.resetAllMocks();vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
 fixture.config={...structuredClone(DEFAULT_CONFIG),defaultModelId:'text',providers:{fixture:{type:'custom',protocol:'openai_legacy'}},models:{text:{provider:'fixture',model:'synthetic-text',label:'Text',capabilities:['text_generation']}}};
 fixture.store.compact.mockResolvedValue({status:'completed',l1:1,l2:0,l3:0});fixture.store.close.mockResolvedValue(undefined);fixture.store.getStats.mockReturnValue({l0:0,l1:1,l2:0,l3:0});fixture.resolve.mockReturnValue({});fixture.adapter.mockReturnValue({});
});
afterEach(()=>vi.restoreAllMocks());
describe('actual Commander memory compact dispatch, dependency-isolated not Native evidence',()=>{
 it.each(['bge-small-zh-v1.5','unknown-old'])('rejects ambiguous legacy %s before creating an adapter instead of default cloud',async id=>{
  fixture.config!.memory={modelId:id};await expect(run()).rejects.toThrow('invalid_compaction_model');expect(fixture.resolve).not.toHaveBeenCalled();expect(fixture.store.compact).not.toHaveBeenCalled();expect(fixture.store.close).toHaveBeenCalledTimes(1);
 });
 it('selects independent eligible text and preserves original force/user source and result path',async()=>{
  fixture.config!.memory={compaction:{modelId:'text'}} as Config['memory'];await run();expect(fixture.resolve.mock.calls[0][1]).toBe('text');expect(fixture.store.setLLMFn).toHaveBeenCalledWith(fixture.llm);expect(fixture.store.compact).toHaveBeenCalledWith({requestSource:'user',force:true});expect(fixture.store.close).toHaveBeenCalledTimes(1);
 });
 it('propagates bare undefined initialization failure and still joins store close',async()=>{
  fixture.adapter.mockImplementation(()=>{throw undefined;});const outcome=await run().then(()=>({fulfilled:true}),raw=>({fulfilled:false,raw}));expect(outcome).toEqual({fulfilled:false,raw:undefined});expect(fixture.store.close).toHaveBeenCalledTimes(1);
 });
 it('preserves both original compaction and close errors with the first cause',async()=>{
  const first=new Error('original_compaction'),last=new Error('original_close');fixture.store.compact.mockRejectedValue(first);fixture.store.close.mockRejectedValue(last);
  const raw=await run().then(()=>null,raw=>raw);expect(raw).toBeInstanceOf(AggregateError);expect(raw.cause).toBe(first);expect(raw.errors).toEqual([first,last]);
 });
 it('does not return while the original store negative close is held',async()=>{
  let release!:()=>void;const held=new Promise<void>(yes=>{release=yes;});fixture.store.close.mockReturnValue(held);let finished=false;const outcome=run().then(()=>{finished=true;},raw=>{throw raw;});
  try{await new Promise<void>(yes=>setImmediate(yes));expect(finished).toBe(false);expect(fixture.store.close).toHaveBeenCalledTimes(1);release();await outcome;expect(finished).toBe(true);}finally{release();await outcome;}
 });
});
