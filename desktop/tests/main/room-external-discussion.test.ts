import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createRoomExternalDiscussionAdapter } from '../../electron/room-external-discussion-adapter.js';

const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
describe('external discussion platform boundary', () => {
  it('rejects Windows before probing or spawning a configured external executable', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
    try {
      const adapter = createRoomExternalDiscussionAdapter({ profiles: { xiaok: { executable: process.execPath } } });
      expect(await adapter.probe('xiaok')).toMatchObject({ supported: false, reason: 'room_discussion_process_group_unsupported' });
      const prepared = vi.fn();
      await expect(adapter.execute({ operationId: 'windows', runtime: 'xiaok', prompt: 'discussion', signal: new AbortController().signal, onPrepared: prepared, onStarted: vi.fn(), onExited: vi.fn() })).rejects.toThrow('room_discussion_unsupported');
      expect(prepared).not.toHaveBeenCalled();
    } finally { Object.defineProperty(process, 'platform', original); }
  });
});
describe.skipIf(process.platform === 'win32')('owned external Room discussion adapter',()=>{
  it('runs the real dedicated xiaok CLI with zero tools, no previous context and a durable input gate',async()=>{
    const root=await mkdtemp(join(tmpdir(),'room-external-cli-'));roots.push(root);const configRoot=join(root,'config');await mkdir(configRoot);
    const requests:any[]=[];
    const server=createServer(async(req,res)=>{let raw='';for await(const data of req)raw+=data;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'external real reply'},finish_reason:null}]})+'\n\ndata: [DONE]\n\n');});
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const address=server.address() as {port:number};
    await writeFile(join(configRoot,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'fixture',defaultModelId:'fixture',providers:{fixture:{type:'custom',protocol:'openai_legacy',baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:'fixture'}},models:{fixture:{provider:'fixture',model:'fixture',label:'fixture'}},defaultMode:'interactive',channels:{}}));
    await writeFile(join(configRoot,'private-session.txt'),'PRIVATE_HISTORY_SENTINEL');
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:['--import',createRequire(import.meta.url).resolve('tsx'),resolve('../src/index.ts')]}},env:{...process.env,XIAOK_CONFIG_DIR:configRoot,INTENT_BROKER_ROOM_TOKEN:'MUST_NOT_REACH_CLI'},temporaryRoot:root});
    try{
      expect((await adapter.probe('xiaok')).supported).toBe(true);expect((await adapter.probe('kiro')).supported).toBe(false);
      let prepared:any,started:any,exited:any;
      const result=await adapter.execute({operationId:'real',runtime:'xiaok',prompt:'FRESH_ROOM_ONLY_TEXT',signal:new AbortController().signal,
        onPrepared:async value=>{prepared=value;expect(requests).toHaveLength(0);},
        onStarted:async value=>{started=value;expect(requests).toHaveLength(0);},onExited:async value=>{exited=value;}}).catch(error=>{throw new Error(`${error.message}: ${error.cause??''}`);});
      expect(result).toEqual({text:'external real reply',resourcesReleased:true});expect(started.pid).toBe(started.processGroupId);expect(started.processStartIdentity).toBeTruthy();expect(exited.groupExitVerified).toBe(true);
      expect(JSON.stringify(requests)).toContain('FRESH_ROOM_ONLY_TEXT');expect(JSON.stringify(requests)).not.toContain('PRIVATE_HISTORY_SENTINEL');
      expect(requests[0].tools??[]).toEqual([]);await expect(readFile(prepared.neutralRoot)).rejects.toThrow();
    }finally{await new Promise<void>(done=>server.close(()=>done()));}
  });
  it('does not spawn an unsupported runtime or accept caller supplied executable authority',async()=>{
    const adapter=createRoomExternalDiscussionAdapter({profiles:{}});let prepared=false;
    await expect(adapter.execute({operationId:'bad',runtime:'kiro',prompt:'x',signal:new AbortController().signal,onPrepared:async()=>{prepared=true;},onStarted:async()=>{},onExited:async()=>{}})).rejects.toThrow('room_discussion_unsupported');
    expect(prepared).toBe(false);
  });
  it('kills the owned process group including a spawned descendant before deleting its neutral root',async()=>{
    const root=await mkdtemp(join(tmpdir(),'room-external-group-'));roots.push(root);
    const fixture=join(root,'process-fixture.cjs');
    await writeFile(fixture,`const fs=require('node:fs'),cp=require('node:child_process');if(process.argv.includes('--probe')){console.log(JSON.stringify({protocol:'room_discussion_v1',runtime:'xiaok',freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}));}else{process.stdin.resume();process.stdin.on('end',()=>{const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('descendant.pid',String(child.pid));setInterval(()=>{},1000);});}`);
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:[fixture]}},temporaryRoot:root});
    const controller=new AbortController();let started:any,exited=false;
    const run=adapter.execute({operationId:'group',runtime:'xiaok',prompt:'ignored lifecycle fixture',signal:controller.signal,onPrepared:async()=>{},onStarted:async record=>{started=record;},onExited:async record=>{expect(record.groupExitVerified).toBe(true);expect((await readFile(join(record.neutralRoot,'descendant.pid'),'utf8')).length).toBeGreaterThan(0);exited=true;}});
    const outcome=run.catch(error=>error);
    let descendant=0;
    for(let attempt=0;attempt<300;attempt++){if(started){try{descendant=Number(await readFile(join(started.neutralRoot,'descendant.pid'),'utf8'));break;}catch{}}await new Promise(done=>setTimeout(done,10));}
    expect(descendant).toBeGreaterThan(0);controller.abort(new Error('cancel-test'));
    expect((await outcome).message).toBe('cancel-test');expect(exited).toBe(true);
    expect(()=>process.kill(-started.processGroupId,0)).toThrow();await expect(readFile(join(started.neutralRoot,'descendant.pid'))).rejects.toThrow();
  });
  it('a failed durable started callback never delivers model input but still reports verified group cleanup',async()=>{
    const root=await mkdtemp(join(tmpdir(),'room-external-gate-'));roots.push(root);const fixture=join(root,'gate-fixture.cjs');
    await writeFile(fixture,`if(process.argv.includes('--probe'))console.log(JSON.stringify({protocol:'room_discussion_v1',runtime:'xiaok',freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}));else require('node:fs').writeFileSync(${JSON.stringify(join(root,'model-started'))},'bad');`);
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:[fixture]}},temporaryRoot:root});let exited=false;
    await expect(adapter.execute({operationId:'gate',runtime:'xiaok',prompt:'not delivered',signal:new AbortController().signal,onPrepared:async()=>{},onStarted:async()=>{throw new Error('journal failed');},onExited:async()=>{exited=true;}})).rejects.toThrow('journal failed');
    expect(exited).toBe(true);await expect(readFile(join(root,'model-started'))).rejects.toThrow();
  });
  it('records the live no-spawn fact and removes only its own neutral directory when preparation fails',async()=>{
    const root=await mkdtemp(join(tmpdir(),'room-external-no-spawn-'));roots.push(root);const fixture=join(root,'probe.cjs');
    await writeFile(fixture,`console.log(JSON.stringify({protocol:'room_discussion_v1',runtime:'xiaok',freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}));`);
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:[fixture]}},temporaryRoot:root});let receipt:any;
    await expect(adapter.execute({operationId:'no-spawn',runtime:'xiaok',prompt:'x',signal:new AbortController().signal,onPrepared:async()=>{throw new Error('prepared failed');},onStarted:async()=>{throw new Error('must not start');},onExited:async()=>{throw new Error('must not fake PID');},onNotSpawned:async value=>{receipt=value;}})).rejects.toThrow('prepared failed');
    expect(receipt.noSpawnVerified).toBe(true);await expect(readFile(receipt.neutralRoot)).rejects.toThrow();expect(await readFile(fixture,'utf8')).toContain('room_discussion_v1');
  });
  it('handles EPERM from an abort callback without uncaught exceptions and verifies eventual group exit',async()=>{
    const root=await mkdtemp(join(tmpdir(),'room-external-signal-'));roots.push(root);const fixture=join(root,'probe.cjs');
    await writeFile(fixture,`console.log(JSON.stringify({protocol:'room_discussion_v1',runtime:'xiaok',freshSession:true,toolsDisabled:true,mcpDisabled:true,hooksDisabled:true}));`);
    const adapter=createRoomExternalDiscussionAdapter({profiles:{xiaok:{executable:process.execPath,argsPrefix:[fixture]}},temporaryRoot:root});const controller=new AbortController();let exited=false,denied=false;
    const originalKill=process.kill.bind(process);let spy:ReturnType<typeof vi.spyOn>|undefined;
    try{
      await expect(adapter.execute({operationId:'ep',runtime:'xiaok',prompt:'x',signal:controller.signal,onPrepared:async()=>{},onStarted:async record=>{
        spy=vi.spyOn(process,'kill').mockImplementation(((pid:number,signal?:NodeJS.Signals|number)=>{if(pid===-record.pid&&signal==='SIGTERM'&&!denied){denied=true;throw Object.assign(new Error('denied'),{code:'EPERM'});}return originalKill(pid,signal);}) as typeof process.kill);
        controller.abort(new Error('test abort'));
      },onExited:async()=>{exited=true;}})).rejects.toThrow('test abort');
      expect(denied).toBe(true);expect(exited).toBe(true);
    }finally{spy?.mockRestore();}
  });
});
