import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Real B Hub, original creator/board/candidate and SQLite; no model runner. */
export function originalProjectDeliveryFixture(kswarmRoot=resolve('..','kswarm')){
 const root=mkdtempSync(join(tmpdir(),'original-core-delivery-'));
 const script=String.raw`
 const{createHub}=await import(process.argv[1]),{createProjectInputAuthority}=await import(process.argv[2]);
 const fs=await import('node:fs'),{join}=await import('node:path'),root=process.argv[3],file=join(root,'report.md');fs.writeFileSync(file,'# Actual original candidate');
 const authority=createProjectInputAuthority({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)}),hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},members:['po','worker'].map(logicalAgentId=>({status:'active',subject:{kind:'agent',logicalAgentId}}))};},async acquireRoomMembershipLease(){return{ok:true};}}});
 try{
  await hub.createProject({id:'p',name:'P',goal:'Original delivery',poAgent:'po',members:['worker'],primaryRoomId:'room',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('create-p')});
  const state=hub.readInitialPlanInputs('p',authority.reader());if(!state.ok)throw Error(JSON.stringify(state));
  const request={enqueueKey:state.enqueueKey,planRunId:'fixture-plan',planGeneration:state.planGeneration,expectedPlanInputRevision:state.planInputRevision,startPolicy:state.startPolicy},claimed=hub.claimInitialPlanInputs('p',request,authority.planner());if(!claimed.ok)throw Error(JSON.stringify(claimed));
  const planned=hub.commitInitialPlan('p',{reservationId:claimed.reservation.id,planRunId:request.planRunId,enqueueKey:request.enqueueKey,commandId:claimed.reservation.commitCommandId,expectedProjectRevision:claimed.reservation.ownerRevision,fromAgent:'po',plan:{analysis:'Original fixture plan',phases:[]},tasks:[{id:'task',title:'Write',assignedAgent:'worker',dependencies:[]}]},authority.planner());if(!planned.ok)throw Error(JSON.stringify(planned));hub.handleApprove('p');
  const board=hub.getBoard('p'),task=board.getAllTasks()[0];board.transition(task.id,'dispatched',{assignedAgent:'worker',runId:'run'});board.transition(task.id,'accepted',{assignedAgent:'worker'});board.transition(task.id,'in_progress');
  for(const result of [hub.handleSubmitResult('p',task.id,{summary:'Done',workFolder:root,artifacts:[{artifactId:'report',path:file}]},'worker','run'),hub.handleQualityReview('p',task.id,{passed:true,feedback:'Reviewed'},'po'),hub.handleDeliver('p',{summary:'Review',artifactRef:{path:file,artifactId:'report'}},'po',{taskId:task.id,workFolder:root,expectedFormat:'markdown'})])if(!result.ok)throw Error(JSON.stringify(result));
  const first=hub.readScopedProjectActivity('p',{after:0,limit:200},authority.reader());if(!first.ok||first.page.delivery.status!=='current'||first.page.delivery.head.core.stage!=='ready_for_acceptance')throw Error(JSON.stringify(first));
  hub.mutateProjectState('p',()=>{hub.getProject('p').planRevisionRequired={taskId:task.id};});const middle=hub.readScopedProjectActivity('p',{after:first.page.headSeq,limit:200},authority.reader());
  hub.mutateProjectState('p',()=>{delete hub.getProject('p').planRevisionRequired;});const again=hub.readScopedProjectActivity('p',{after:first.page.headSeq,limit:200},authority.reader());
  fs.writeFileSync(join(root,'fixture.json'),JSON.stringify({first,middle,again}));
 }finally{hub.closePersistence();}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,...['hub.js','project-input-authority.js'].map(name=>pathToFileURL(resolve(kswarmRoot,'src','core',name)).href),root],{encoding:'utf8',timeout:10000});
 console.log(JSON.stringify({test:'original-core-delivery-B-producer',pid:child.pid,status:child.status,signal:child.signal,reaped:true}));
 try{if(child.error)throw child.error;if(child.status!==0)throw Error(child.stderr||child.stdout);const pages=JSON.parse(readFileSync(join(root,'fixture.json'),'utf8'));return{root,pages,close:()=>rmSync(root,{recursive:true,force:true})};}
 catch(error){rmSync(root,{recursive:true,force:true});throw error;}
}
