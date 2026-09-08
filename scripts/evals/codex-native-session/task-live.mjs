import { CodexTaskBridge } from '../../../desktop/dist/main/desktop/electron/codex-task-bridge.js';
import { MaterialRegistry } from '../../../desktop/dist/main/src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../desktop/dist/main/src/runtime/task-host/snapshot-store.js';
import { mkdtemp, writeFile } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';
if(!process.argv.includes('--live'))process.exit(0);
const dir=await mkdtemp(join(tmpdir(),'xiaok-standard-codex-'));const actor={requestSource:'user',actorId:'u'};
const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks'))});
let taskId;const events=[];
try{
 const result=await bridge.create({prompt:'[Standard task UI test] No tools. Reply only with STANDARD_CODEX_READY.',materials:[],context:{threadId:'standard-thread'}},actor);taskId=result.taskId;
 for await(const event of bridge.host.subscribeTask(taskId)){events.push(event);if(['task_terminal','task_cancelled'].includes(event.type))break;}
 const {snapshot}=await bridge.host.recoverTask(taskId);console.log(JSON.stringify({dir,taskId,status:snapshot.status,summary:snapshot.result?.summary,events:events.map(e=>e.type)}));
 await writeFile(join(dir,'result.json'),JSON.stringify({taskId,status:snapshot.status,events},null,2));
 if(snapshot.status!=='completed'||!snapshot.result?.summary.includes('STANDARD_CODEX_READY'))process.exitCode=1;
}finally{await bridge.dispose();}
