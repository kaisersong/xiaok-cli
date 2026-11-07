// @vitest-environment node
import {it,expect} from 'vitest';
import {join} from 'node:path';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
for(const format of ['markdown','html'] as const)it(`actual Main reviews the current ${format} task against its own stored contract`,async()=>{
 const owned=await openOwnedWorkflowNormalCase({project:{id:'fictional-review',name:'Fictional report',goal:'Deliver a final HTML report'},workflowName:'review_scope_fixture',phaseTitle:'Read',prompt:'Read current project state',label:'Review scope fixture',reviewFormat:format});
 let services:ReturnType<typeof createDesktopServices>|undefined;let captured='';
 try{
  const path='/projects/fictional-review';const before=await (await owned.kswarmService.request(path)).json();
  const task=before.tasks[0];expect(task.status).toBe('submitted');
  services=createDesktopServices({dataRoot:join(owned.fixture.root,'desktop'),kswarmService:owned.kswarmService,runner:async({sessionId,prompt,emitRuntimeEvent})=>{captured=prompt;await emitRuntimeEvent({type:'receipt_emitted',sessionId,turnId:'turn',intentId:'intent',stepId:'step',note:JSON.stringify({passed:false,feedback:'Fictional reviewer keeps the original independent gate active.',failureClass:'quality_content_failed',planRevisionNeeded:false})});}});
  const outcome=await services.runKSwarmReviewSubmission({payload:{projectId:'fictional-review',taskId:task.id,result:task.result,sourceTask:{acceptanceCriteria:'FORGED_EARLY_HTML_REQUIREMENT'}}});expect(outcome).toEqual({ok:true});
  const line=captured.split('\n').find(value=>value.startsWith('当前源任务（唯一验收范围）：'));expect(line).toBeDefined();
  const scope=JSON.parse(line!.slice('当前源任务（唯一验收范围）：'.length));expect(scope.id).toBe(task.id);expect(scope.acceptanceCriteria).toBe(task.acceptanceCriteria);expect(scope.requiredOutputs).toEqual(task.requiredOutputs);expect(captured).not.toContain('FORGED_EARLY_HTML_REQUIREMENT');expect(captured).toContain('不得把后续任务的 HTML');expect(captured).toContain('当前源任务明确要求 HTML');
  const posts=owned.fixture.requestLog.filter(call=>call.method==='POST'&&call.path.endsWith('/review'));expect(posts).toHaveLength(1);
  const after=await (await owned.kswarmService.request(path)).json();expect(after.tasks[0].status).toBe('pending');expect(after.tasks[0].qualityReviewHistory.at(-1).passed).toBe(false);expect(after.tasks[1].status).toBe('pending');
 }finally{await owned.close(services);}
},10000);
