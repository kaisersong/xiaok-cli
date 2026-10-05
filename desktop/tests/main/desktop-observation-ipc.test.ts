// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
const mocks=vi.hoisted(()=>({picker:vi.fn(),confirm:vi.fn()}));
vi.mock('electron',()=>({app:{getPath:()=>'/tmp',getLocale:()=> 'zh'},BrowserWindow:{getAllWindows:()=>[],fromWebContents:(sender:any)=>({webContents:sender})},clipboard:{read:vi.fn()},dialog:{showOpenDialog:mocks.picker,showMessageBox:mocks.confirm},shell:{}}));
import {registerDesktopIpc} from '../../electron/ipc.js';
import {consumeDesktopObservationApproval} from '../../electron/desktop-observation-approval.js';
const roots:string[]=[];afterEach(()=>{roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));vi.clearAllMocks();});
describe('Desktop native observation IPC authority',()=>{
 it('requires native confirmation and refuses forged fields, cross-sender drafts and controls',async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'observation-ipc-')));roots.push(root);const file=join(root,'input.txt'),policy=join(root,'policy.json');writeFileSync(file,'fixture');
  writeFileSync(policy,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[]}));
  mocks.picker.mockResolvedValue({canceled:false,filePaths:[policy]});mocks.confirm.mockResolvedValue({response:1});
  const sender=Object.assign(new EventEmitter(),{id:1,isDestroyed:()=>false,send:vi.fn()}),other=Object.assign(new EventEmitter(),{id:2,isDestroyed:()=>false,send:vi.fn()});
  const handlers=new Map<string,any>(),control={};
  const create=vi.fn(async(input:any,authority:any)=>{expect(input).toEqual({prompt:'read input',materials:[],permissionMode:'default'});expect(authority.requestSource).toBe('user');expect(authority.authorizeValidationMaterials).toEqual(expect.any(Function));expect(consumeDesktopObservationApproval(authority.approval)).toBeTruthy();expect(await authority.onPrompt('read',{file_path:file})).toBe(true);return {taskId:'task',control};});
  const stop=vi.fn();
  const services:any={getDataRoot:()=>root,createObservationTask:create,stopObservationTask:stop,revokeObservationTask:vi.fn(),observationTaskStatus:async()=> 'active'};
  await registerDesktopIpc({handle:(name:string,handler:any)=>handlers.set(name,handler)} as any,{webContents:sender,isDestroyed:()=>false,once:vi.fn()} as any,services, {multiAgentAuthorize:(event:any)=>event.sender===sender||event.sender===other?{actorId:'user'}:null});
  await expect(handlers.get('desktop:prepareObservationTask')({sender}, {policyPath:policy})).rejects.toThrow(/input/);
  const draft=await handlers.get('desktop:prepareObservationTask')({sender});expect(mocks.confirm).toHaveBeenCalledTimes(2);
  await expect(handlers.get('desktop:createObservationTask')({sender:other},{draftId:draft.draftId,prompt:'read input'})).rejects.toThrow(/sender/);
  await expect(handlers.get('desktop:createObservationTask')({sender},{draftId:draft.draftId,prompt:'read input',requestSource:'user'})).rejects.toThrow(/input/);
  expect(await handlers.get('desktop:createObservationTask')({sender},{draftId:draft.draftId,prompt:'read input'})).toEqual({taskId:'task'});
  expect(create).toHaveBeenCalledOnce();expect(mocks.confirm).toHaveBeenCalledTimes(3);
  await expect(handlers.get('desktop:stopObservationTask')({sender:other},{taskId:'task'})).rejects.toThrow(/owner/);
  await handlers.get('desktop:stopObservationTask')({sender},{taskId:'task'});expect(stop).toHaveBeenCalledWith('task',{requestSource:'user',control});
  const semantic={mode:'mechanism-experiment',state:'compacted',attempts:1,maxAttempts:2,reservedCostUnits:1000,maxCostUnits:50000000};
  const compound={mode:'mechanism-experiment',edit:'succeeded',validation:'unknown',pendingOperations:0,unknownOperations:1,completedOperations:0};
  services.observationTaskDiagnostics=()=>({semantic,compound});
  expect(await handlers.get('desktop:getObservationTaskStatus')({sender},{taskId:'task'})).toEqual({mode:'active',semantic,compound});
 // Real IPC registration dynamically imports its full main-process dependencies;
 // allow the same bounded setup budget as bootstrap tests under parallel suites.
 },20000);
});
