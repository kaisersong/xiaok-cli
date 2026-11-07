// @vitest-environment node
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {TimedActionService} from '../../electron/timed-action-service.js';
import {createRoomTimedActionTools} from '../../electron/desktop-services.js';
import {createRoomScheduledTaskDispatch} from '../../electron/room-scheduled-task.js';
import type {TimedActionExecutor} from '../../electron/timed-action-types.js';

const target = {roomId:'own-room', logicalAgentId:'own-agent', bindingId:'own-binding', generation:1};
const ownerId = JSON.stringify([target.roomId, target.logicalAgentId]);
const agent = {requestSource:'agent' as const, ownerId};
const context = () => ({...target, protocolVersion:1, claimId:'own-claim', runId:'own-run',
  executorInstanceId:'own-executor', workspaceId:'own-workspace', contextScope:{kind:'room_only'},
  executionState:'admitted', authorizationState:'valid', effectiveCwd:'/fictional/workspace',
  localCommandsAllowed:true, instructionsRevision:0, publishedInstructions:'',
  parentClaimId:null, projectMappingRevision:null, taskId:null, originHostId:'own-host',
  hostPrincipal:'own-principal', hostIncarnation:1, workspaceRevision:1, instructionsDigest:null,
  membershipRevision:1, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z',
  acquireDigest:'own-digest', taskName:'Own worker', roomSequence:1,
  workspaceRoot:{canonicalRoot:'/fictional/workspace',identity:{dev:'1',ino:'1',birthtimeNs:'1'}},
  artifactRefs:[{relativePath:'own.txt'}], handoffRefs:[], confirmedDecisions:[]});
let root:string, store:TimedActionStore, service:TimedActionService;
beforeEach(() => {
  root=mkdtempSync(join(tmpdir(),'room-scheduled-context-'));
  store=new TimedActionStore(join(root,'own.sqlite'));
  service=new TimedActionService(store,{now:()=>1000});
});
afterEach(() => {store.close(); rmSync(root,{recursive:true,force:true});});
const db=()=> (store as unknown as {db:DatabaseSync}).db;
const snapshot=()=>JSON.stringify(['timed_actions','timed_action_runs','automation_store_metadata'].map(t=>db().prepare('SELECT * FROM '+t+' ORDER BY 1').all()));
const executorBytes=(id:string)=>(db().prepare('SELECT executor_json FROM timed_actions WHERE id=?').get(id) as {executor_json:string}).executor_json;
const legacy=(extraTarget:Record<string,unknown>={}, extraExecutor:Record<string,unknown>={})=>store.createAction({
  id:'own-legacy', title:'Own legacy schedule', trigger:{kind:'interval',intervalMinutes:5},
  executor:{kind:'agent_task',prompt:'Own prompt',roomTarget:{...context(),...extraTarget},...extraExecutor} as TimedActionExecutor,
  source:'agent',ownerKind:'agent_task',ownerId,status:'paused',userApprovedAuto:false,
  policy:{maxRuns:2,expiresAt:900000},now:1000,
});
const call=(scope:ReturnType<typeof context>)=>{
  const tools=createRoomTimedActionTools(service,scope);
  return (name:string,input:Record<string,unknown>)=>tools.find(t=>t.definition.name===name)!.execute(input);
};

it.each(['interval','once'] as const)('creates %s from the full runtime context and snapshots scope',async frequency=>{
  const scope=context(), execute=call(scope);
  scope.roomId='changed-room'; scope.bindingId='changed-binding'; scope.generation=2;
  const result=await execute('scheduled_task_create',{name:'Own task',prompt:'Own prompt',frequency,
    interval_minutes:5,schedule_at:5000,roomId:'forged-room',ownerId:'forged-owner',bindingId:'forged-binding'});
  expect(result).not.toContain('Error:');
  const created=JSON.parse(result), stored=JSON.parse(executorBytes(created.taskId));
  expect(stored.roomTarget).toEqual(target);
  expect(service.getActions()[0].ownerId).toBe(ownerId);
  expect(JSON.parse(await execute('scheduled_task_list',{}))).toHaveLength(1);
  const cancelled=JSON.parse(await execute('scheduled_task_cancel',{task_id:created.taskId}));
  expect(cancelled.ok).toBe(frequency==='interval');
  expect(service.getActions()).toHaveLength(frequency==='interval'?0:1);
});

it('projects legacy list targets without changing stored bytes or lifecycle facts',async()=>{
  legacy();const before=snapshot(), bytes=executorBytes('own-legacy');
  const [listed]=JSON.parse(await call(context())('scheduled_task_list',{}));
  expect(listed.executor.roomTarget).toEqual(target);
  expect(listed).toMatchObject({status:'paused',runCount:0,consecutiveFailures:0,userApprovedAuto:false,policy:{maxRuns:2,expiresAt:900000}});
  expect(executorBytes('own-legacy')).toBe(bytes);expect(snapshot()).toBe(before);
  expect(service.cancelScheduledTask('own-legacy','Own completed',agent)).toBe(true);
});

it.each([
  {contextScope:undefined},{contextScope:{kind:'project',projectId:'own-project'}},
  {contextScope:{kind:'room_only',unknown:true}}, {claimId:''},{runId:undefined},
  {executorInstanceId:null},{workspaceId:5},{unexpected:'unknown'},
  {roomId:''},{logicalAgentId:5},{bindingId:undefined},{generation:0},
  {generation:-1},{generation:1.5},{generation:Number.MAX_SAFE_INTEGER+1},
])('retains rejection for malformed or unrecognized legacy target %j',changes=>{
  legacy(changes);const before=snapshot();
  expect(()=>service.cancelScheduledTask('own-legacy','Own completed',agent)).toThrow('scheduled_projection_unavailable');
  expect(snapshot()).toBe(before);
});

it('retains unknown outer executor fields for strict mutation rejection',()=>{
  legacy({}, {unexpected:'unknown'});const before=snapshot();
  expect(()=>service.cancelScheduledTask('own-legacy','Own completed',agent)).toThrow('scheduled_projection_unavailable');
  expect(snapshot()).toBe(before);
});

it.each(['trigger_json','policy_json','source','owner_kind'] as const)('does not hide malformed %s during legacy projection',column=>{
  legacy();db().prepare('UPDATE timed_actions SET '+column+'=? WHERE id=?').run(
    column==='trigger_json'?'{"kind":"interval","intervalMinutes":null}':column==='policy_json'?'{"maxRuns":null}':'invalid','own-legacy');
  const before=snapshot();
  expect(()=>service.cancelScheduledTask('own-legacy','Own completed',agent)).toThrow('scheduled_projection_unavailable');
  expect(snapshot()).toBe(before);
});

it.each(['other-agent','other-room','user','assistant'] as const)('preserves %s ownership rejection after legacy projection',kind=>{
  legacy();if(kind==='user'||kind==='assistant')db().prepare('UPDATE timed_actions SET source=?,owner_kind=? WHERE id=?').run(kind==='user'?'user':'system',kind,'own-legacy');
  const before=snapshot(),request=kind==='other-agent'||kind==='other-room'?{...agent,ownerId:JSON.stringify([kind==='other-room'?'other-room':target.roomId,kind==='other-agent'?'other-agent':target.logicalAgentId])}:agent;
  expect(service.cancelScheduledTask('own-legacy','Own completed',request)).toBe(false);
  expect(snapshot()).toBe(before);
});

it('still rejects full contexts passed directly to the new service API',()=>{
  const before=snapshot();
  expect(()=>service.createRoomScheduledTask({name:'Own task',prompt:'Own prompt',trigger:{kind:'interval',intervalMinutes:5}},context(),agent)).toThrow('scheduled_input_invalid');
  expect(snapshot()).toBe(before);
});

it('preserves legacy failures, locks and expiry on read',()=>{
  legacy();db().prepare('UPDATE timed_actions SET run_count=43,consecutive_failures=3,last_error=?,locked_run_id=?,locked_at=? WHERE id=?').run('room_schedule_binding_unavailable','own-held-run',800,'own-legacy');
  const before=snapshot();
  expect(service.getActions()[0]).toMatchObject({status:'paused',runCount:43,consecutiveFailures:3,
    lastError:'room_schedule_binding_unavailable',lockedRunId:'own-held-run',lockedAt:800,
    userApprovedAuto:false,policy:{expiresAt:900000}});
  expect(snapshot()).toBe(before);
});

it.each([{bindingId:'old-binding'},{generation:2}])('does not rebind legacy dispatch %j',oldTarget=>{
  legacy(oldTarget);db().prepare('UPDATE timed_actions SET user_approved_auto=1 WHERE id=?').run('own-legacy');
  const action=service.getActions()[0],sendWake=vi.fn(),dispatch=vi.fn();
  const run=createRoomScheduledTaskDispatch({
    getWorkspace:async()=>({ok:true,phase:'active',revision:1,bindingId:target.bindingId,generation:target.generation,
      permissions:{canRead:true,canManage:true},claims:[],artifacts:[]}),sendWake,dispatch,
  });
  return expect(run(action,{scheduledDueAt:1000,claimedAt:1000,overdueMs:0,recoveryReason:'normal_tick'}))
    .rejects.toThrow('room_schedule_binding_unavailable').then(()=>{expect(sendWake).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();});
});
