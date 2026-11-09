import {createHash} from 'node:crypto';
import type {AssistantQualityBinding} from '../../src/runtime/assistant/quality-qualification.js';
import type {AssistantDesktopSnapshot} from './assistant-desktop-snapshot.js';
/** Main-private source population, independent of generated recommendations. */
export function buildAssistantQualityPopulation(input:{binding:AssistantQualityBinding;analysisContract:string;snapshot:AssistantDesktopSnapshot;knownSecrets?:readonly string[]}){
 const {binding,snapshot}=input;
 const visible=snapshot.coverage.filter(row=>row.status!=='disabled');
 const complete=visible.length>0&&visible.every(row=>row.status==='checked')&&snapshot.dropped.perScopeLimit===0&&snapshot.dropped.totalBytes===0;
 const redact=(value:string)=>{let text=value;for(const secret of input.knownSecrets??[])if(secret.length>=8)text=text.split(secret).join('[redacted]');return text.replace(/\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,'[redacted]').replace(/\bsk-[a-zA-Z0-9_-]{12,}/g,'[redacted]');};
 const facts=snapshot.items.map(item=>({
  id:createHash('sha256').update(JSON.stringify([binding.accountScopeHash,item.scope,item.reference.kind,item.reference.id])).digest('hex'),
  title:redact(item.summary).slice(0,200),status:item.scope,updatedAt:item.updatedAt,sourceReference:{kind:item.reference.kind,id:item.reference.id},
 }));
 const ids=facts.map(item=>item.id);
 return {binding,population:{complete:complete&&new Set(ids).size===ids.length,ids},
  protocol:{analysisContract:input.analysisContract,version:'assistant-quality-internal-v1',riskRulesDigest:createHash('sha256').update('human-review:frozen-deadline-or-loss-risk-before-prediction:v1').digest('hex'),firstAnnotator:'primary-human-reviewer',secondAnnotator:'secondary-human-reviewer',samplingSeed:createHash('sha256').update(JSON.stringify(binding)).digest('hex'),sampleSize:100},facts};
}
