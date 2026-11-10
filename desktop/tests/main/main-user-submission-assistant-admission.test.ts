// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {LOCAL_CODEX_MODEL} from '../../electron/codex-task-bridge.js';
import {expandSelectedMaterialPaths} from '../../electron/material-selection.js';

// This Node-only test has no Electron capability and never claims Main coverage.
vi.mock('electron',()=>({app:undefined,BrowserWindow:undefined,webContents:undefined}));

vi.mock('../../electron/material-selection.js',async load=>{
  const actual=await load<typeof import('../../electron/material-selection.js')>();
  return {...actual,expandSelectedMaterialPaths:vi.fn(actual.expandSelectedMaterialPaths)};
});

it.each(['thread','watch','revoked'] as const)('rejects %s submission before selected file enumeration',async kind=>{
  const root=mkdtempSync(join(tmpdir(),'main-assistant-admission-'));
  const config=join(root,'config'),dataRoot=join(root,'data'),workspace=join(root,'workspace');
  mkdirSync(config);mkdirSync(workspace);writeFileSync(join(workspace,'input.txt'),'private fixture');
  const previous=new Map(['XIAOK_CONFIG_DIR','XIAOK_DISABLE_GLOBAL_PLUGINS','XIAOK_CONVERSATION_ACTIVITY'].map(key=>[key,process.env[key]]));
  process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';process.env.XIAOK_CONVERSATION_ACTIVITY='0';
  writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-only',model:'fixture'}},defaultMode:'interactive',channels:{}}));
  let services:ReturnType<typeof createDesktopServices>|undefined;
  try{
    services=createDesktopServices({dataRoot,workspaceRoot:workspace,knowledgeDbPath:join(root,'knowledge.db'),kswarmService:{request:vi.fn(async()=>Response.json({agents:[],projects:[]})),getDesktopMutationToken:()=> 'fixture-only',getStatus:()=>({running:false}),onStatusChange:()=>()=>{}} as never});
    const actor={requestSource:'user' as const,actorId:`desktop-user:${services.multiAgent!.profileId}`};
    await services.saveModelConfig({providerId:LOCAL_CODEX_MODEL,modelId:LOCAL_CODEX_MODEL},actor,'user');
    vi.mocked(expandSelectedMaterialPaths).mockClear();
    const prompt=kind==='watch'?'[xiaok-assistant-watch:mail] Read mail':'Summarize material';
    const threadId=kind==='thread'?'a0c22222-1111-4111-8111-111111111111':'user-thread';
    const recheck=kind==='revoked'?()=>{throw Error('sender_revoked_before_file_selection');}:undefined;
    await expect(services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:{kind:'files',prompt,filePaths:[workspace],context:{threadId}}},actor,recheck)).rejects.toThrow(kind==='revoked'?'sender_revoked_before_file_selection':'assistant_executor_unavailable');
    expect(expandSelectedMaterialPaths).not.toHaveBeenCalled();
  }finally{
    try{
      if(services){services.goalShutdown.ingress.stopAccepting();await services.goalShutdown.ingress.drain(3000);await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();}
    }finally{
      for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}
      rmSync(root,{recursive:true,force:true});
    }
  }
},20000);
