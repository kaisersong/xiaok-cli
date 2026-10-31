import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../../src/ai/tools/index.js';
import { CapabilityRegistry } from '../../src/platform/runtime/capability-registry.js';
import { createCapabilityDiscoveryTool, capabilityQuestion, rankMetrics } from '../../src/runtime/evals/jev-capability-experiment.js';
import { instrumentCapabilityAdapter } from '../../src/runtime/evals/jev-capability-telemetry.js';
import { Agent } from '../../src/ai/agent.js';
import type { ModelAdapter } from '../../src/types.js';
const definitions = [
  {name:'slide',description:'Create slides. Not reports.',inputSchema:{type:'object' as const,properties:{}}},
  {name:'report',description:'Create reports. Not slides.',inputSchema:{type:'object' as const,properties:{}}},
];
function setup() { const c=new CapabilityRegistry(); definitions.forEach(d=>c.register({kind:'skill',...d})); return new ToolRegistry({autoMode:true,capabilityRegistry:c},[]); }
const good = {status:'ok' as const,usage:null,model:'jev-test',choice:'c01',confidence:.95,probabilities:{c00:.01,c01:.98,c02:0,none:.01}};
describe('opt-in capability discovery through actual tool search',()=>{
  it('uses original select with zero decision calls',async()=>{const r=setup(),request=vi.fn();const t=createCapabilityDiscoveryTool(r,request);expect(JSON.parse(await t.execute({query:'select:slide'}))).toEqual([definitions[0]]);expect(request).not.toHaveBeenCalled();r.dispose();});
  it('uses original exact-name and single-result searches without decision calls',async()=>{const r=setup(),request=vi.fn();const t=createCapabilityDiscoveryTool(r,request);await t.execute({query:'report'});await t.execute({query:'Create reports'});expect(request).not.toHaveBeenCalled();r.dispose();});
  it('consumes actual registered schema on accepted semantic decision',async()=>{const r=setup(),request=vi.fn(async()=>good),observe=vi.fn();const t=createCapabilityDiscoveryTool(r,request,observe);expect(JSON.parse(await t.execute({query:'演示文稿'}))).toEqual([definitions[0]]);expect(request).toHaveBeenCalledOnce();expect(observe).toHaveBeenCalledWith(expect.objectContaining({accepted:true,selected:['slide']}));r.dispose();});
  it('preserves original multiple matches when decision is uncertain',async()=>{const r=setup();const t=createCapabilityDiscoveryTool(r,async()=>({...good,confidence:.2}));expect(JSON.parse(await t.execute({query:'Create'}))).toEqual(definitions);r.dispose();});
  it('preserves empty result on none, unavailable or unbound choice',async()=>{for(const answer of [{...good,choice:'none'},{status:'unavailable' as const,usage:null,reason:'timeout'},{...good,choice:'missing'}]){const r=setup();const t=createCapabilityDiscoveryTool(r,async()=>answer);expect(JSON.parse(await t.execute({query:'卫星'}))).toEqual([]);r.dispose();}});
  it('does not consume or fall back after cancellation',async()=>{const r=setup(),controller=new AbortController(),observe=vi.fn();const t=createCapabilityDiscoveryTool(r,async()=>{controller.abort();return good;},observe,controller.signal);await expect(t.execute({query:'演示'})).rejects.toThrow();expect(observe).not.toHaveBeenCalled();r.dispose();});
  it('keeps real tool definition and binds descriptions under stable finite IDs',()=>{const q=capabilityQuestion(definitions);expect(Object.keys(q.criteria)).toEqual(['c00','c01','none']);expect(q.criteria.c01).toContain(definitions[1].description);});
});
describe('ranking metrics',()=>{
  it('counts a lower-ranked required capability and all-required misses',()=>{expect(rankMetrics(['slide','report'],['report'])).toEqual({hit1:0,hit3:1,mrr:.5,ndcg3:1/Math.log2(3),allRequiredRecall:1});expect(rankMetrics(['slide'],['slide','report']).allRequiredRecall).toBe(.5);});
  it('does not turn empty results into a hit',()=>{expect(rankMetrics([],['slide']).hit3).toBe(0);});
});
describe('complete adapter telemetry',()=>{
  it('records both tool-decision and terminal model stream before real Agent returns',async()=>{
    let count=0;
    const inner:ModelAdapter={getModelName:()=> 'fixture',async *stream(){count++;yield{type:'usage',usage:{inputTokens:100,outputTokens:10}};if(count===1)yield{type:'tool_use',id:'s1',name:'tool_search',input:{query:'select:tool_search'}};else yield{type:'text',delta:'{"capabilities":[]}'};yield{type:'done'};}};
    const controller=new AbortController(),meter=instrumentCapabilityAdapter(inner,controller.signal),registry=new ToolRegistry({autoMode:true},[]);
    const agent=new Agent(meter.adapter,registry,'test',{maxIterations:3});await agent.runTurn('discover',()=>{},controller.signal);
    expect(meter.calls).toHaveLength(2);expect(meter.calls.every(c=>c.status==='completed')).toBe(true);expect(meter.calls.reduce((n,c)=>n+(c.usage?.inputTokens??0),0)).toBe(200);registry.dispose();
  });
  it('retains failed attempts and their observed usage',async()=>{const inner:ModelAdapter={getModelName:()=> 'fixture',async *stream(){yield{type:'usage',usage:{inputTokens:7,outputTokens:0}};throw new Error('transport');}};const meter=instrumentCapabilityAdapter(inner,new AbortController().signal);await expect(async()=>{for await(const _ of meter.adapter.stream([],[],'test')){/* drain */}}).rejects.toThrow('transport');expect(meter.calls[0]).toMatchObject({status:'failed',usage:{inputTokens:7,outputTokens:0}});});
});
