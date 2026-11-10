import {it,expect} from 'vitest';
import {evaluateAssistantQuality,issueAssistantQualityQualification,readAssistantQualityQualification} from '../../../src/runtime/assistant/quality-qualification.js';
function dataset(){const population=Array.from({length:100},(_,i)=>'event-'+i);return {binding:{profileId:'default-personal-assistant' as const,sourceId:'internal-tasks',accountScopeHash:'a'.repeat(64),grantEpoch:1,window:{from:1,to:2}},population:{complete:true,ids:population},protocol:{analysisContract:'qualified-test',version:'frozen-v1',riskRulesDigest:'b'.repeat(64),firstAnnotator:'person-a',secondAnnotator:'person-b'},cases:population.map((id,i)=>({id,firstLabel:i<30?'needs_action' as const:'wait' as const,secondLabel:i<30?'needs_action' as const:'wait' as const,prediction:i<30?'needs_action' as const:'wait' as const,severe:i===0}))};}
it('qualifies only a complete independently labeled population with all required raw counts',()=>{
 const data=dataset(),report=evaluateAssistantQuality(data);expect(report).toMatchObject({passed:true,total:100,needsAction:30,tp:30,fn:0,fp:0,seriousMisses:0,unknownLabels:0});expect(report.precision.value).toBe(1);expect(report.recall.value).toBe(1);expect(report.recall.lower).toBeLessThan(1);
 const token=issueAssistantQualityQualification(data);expect(readAssistantQualityQualification(token,data.binding)?.reportDigest).toMatch(/^[a-f0-9]{64}$/);
 expect(readAssistantQualityQualification(JSON.parse(JSON.stringify(token)),data.binding)).toBeUndefined();
 expect(readAssistantQualityQualification(token,{...data.binding,grantEpoch:2})).toBeUndefined();
});
it('counts unclassified actionable output as a miss and rejects any severe miss',()=>{
 const data=dataset();data.cases[0]!.prediction='unknown' as any;
 expect(evaluateAssistantQuality(data)).toMatchObject({passed:false,tp:29,fn:1,seriousMisses:1});expect(()=>issueAssistantQualityQualification(data)).toThrow('unverified');
});
it('rejects incomplete enumeration, too few real labels, and label disagreements without user adjudication',()=>{
 const data=dataset();expect(evaluateAssistantQuality({...data,population:{...data.population,complete:false}}).passed).toBe(false);
 expect(evaluateAssistantQuality({...data,cases:data.cases.slice(0,99)}).passed).toBe(false);
 for(let i=0;i<11;i++)data.cases[i]!.secondLabel='unknown' as any;
 expect(evaluateAssistantQuality(data)).toMatchObject({passed:false,unknownLabels:11});
});
