import {createHash} from 'node:crypto';
import {createIntentPlan} from '../../src/ai/intent-delegation/planner.js';
import {parseIntentBusinessContract} from '../../src/runtime/verification/intent-business-contract.js';
const H='a'.repeat(64),sha=(text:string)=>createHash('sha256').update(text).digest('hex');
export function intentApplicationCandidate(parent=false):any {
 const result=createIntentPlan({instanceId:'host',sessionId:'session',input:'请写报告，然后生成幻灯片',skills:[]});if(result.kind!=='plan')throw Error('fixture');
 const {instanceId,continuationMode,steps,...plan}=result.plan,definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'content',path:'result.md',sha256:sha('原文'),structure:'utf8'}]}}]};
 const contract=parseIntentBusinessContract({version:1,...plan,verification:definition,stages:plan.stages.map(s=>({...s,steps:s.steps.map(({status,...step})=>step),verification:definition}))}),stageId=contract.stages[0].stageId,subject={version:1,sessionId:contract.sessionId,intentId:contract.intentId,stageId:parent?null:stageId};
 const artifacts=[{artifactId:'original-artifact',stageId,kind:'report',label:'完整标题',summary:null,createdAt:100,content:{kind:'inline',text:'原文'},selection:{kind:'local',obligationId:'original',path:'result.md'},sha256:sha('原文'),size:Buffer.byteLength('原文')}];
 const body=parent?{kind:'intent-parent',summary:'完整结果',stages:contract.stages.map((stage,i)=>({subject:{...subject,stageId:stage.stageId},candidateId:`candidate-${i}`,candidateRevision:1,bindingHash:H,immutablePayloadHash:H,operationId:`publication-${i}`,fullTupleHash:H,committedBusinessRevision:1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1})),artifacts}:{kind:'intent-stage',stageId,summary:'原结果',executionReports:[{kind:'step',identity:contract.stages[0].steps[0].stepId,status:'completed',requestSource:'agent',recordedAt:100}],artifacts};
 return {version:1,kind:'intent',subject,candidateId:parent?'parent':'stage',candidateRevision:1,contract,body};
}
