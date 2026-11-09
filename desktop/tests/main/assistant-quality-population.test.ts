import {it,expect} from 'vitest';
import {buildAssistantQualityPopulation} from '../../electron/assistant-quality-population.js';
const binding={profileId:'default-personal-assistant' as const,sourceId:'internal',accountScopeHash:'a'.repeat(64),grantEpoch:1,window:{from:1,to:100}};
const snapshot={from:1,to:100,timeZone:'Asia/Shanghai',items:[{id:'x',scope:'tasks',updatedAt:20,summary:'Review this task',reference:{kind:'task_snapshot',id:'x'},priority:1}],dropped:{duplicate:0,perScopeLimit:0,totalBytes:0,outsideWindow:0},coverage:['task_snapshots','kswarm_projects','timed_actions','meeting_metadata','knowledge_source_metadata'].map(sourceId=>({sourceId,status:'checked',requestedWindow:{from:1,to:100},recordCount:0,includedCount:0,checkedAt:100,freshUntil:200}))};
it('freezes actual source references independently of model suggestions and never trusts a partial population',()=>{
 const result=buildAssistantQualityPopulation({binding,analysisContract:'actual-test',snapshot:snapshot as any});expect(result.population).toMatchObject({complete:true});expect(result.population.ids).toHaveLength(1);expect(result.facts[0]?.title).toBe('Review this task');expect(result.facts[0]).toHaveProperty('sourceReference',{kind:'task_snapshot',id:'x'});
 expect(buildAssistantQualityPopulation({binding,analysisContract:'actual-test',snapshot:{...snapshot,coverage:snapshot.coverage.map((row,i)=>i===0?{...row,status:'partial'}:row)} as any}).population.complete).toBe(false);
 expect(buildAssistantQualityPopulation({binding,analysisContract:'actual-test',snapshot:{...snapshot,dropped:{...snapshot.dropped,totalBytes:1}} as any}).population.complete).toBe(false);
});
it('redacts configured credentials and common token assignments from exported review facts',()=>{
 const result=buildAssistantQualityPopulation({binding,analysisContract:'actual-test',snapshot:{...snapshot,items:[{...snapshot.items[0],summary:'API_KEY=sk-test-super-secret-1234567890 another-configured-secret'}]} as any,knownSecrets:['another-configured-secret']});
 expect(JSON.stringify(result.facts)).not.toContain('sk-test-super-secret');expect(JSON.stringify(result.facts)).not.toContain('another-configured-secret');
});
