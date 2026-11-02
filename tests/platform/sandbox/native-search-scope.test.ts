import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildToolList, ToolRegistry} from '../../../src/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {applySandboxToTools} from '../../../src/platform/sandbox/tool-wrappers.js';
import {createSandboxEnforcer} from '../../../src/platform/sandbox/enforcer.js';
import {createSandboxPolicy} from '../../../src/platform/sandbox/policy.js';
import {createBoundedGlobRunner} from '../../../src/ai/tools/bounded-glob.js';
import {spawnSync} from 'child_process';
vi.mock('child_process',async importOriginal=>{
  const actual=await importOriginal<typeof import('child_process')>();
  return {...actual,spawnSync:vi.fn(actual.spawnSync)};
});

const roots:string[]=[];
const registries:ToolRegistry[]=[];
afterEach(()=>{
  vi.restoreAllMocks();
  for(const registry of registries.splice(0)) registry.dispose();
  for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true,maxRetries:3});
});
function fixture(nativeReadonlyOnly=true){
  const root=mkdtempSync(join(tmpdir(),'xiaok-search-scope-'));roots.push(root);
  const approved=join(root,'approved'),outside=join(root,'outside'),denied=join(approved,'private');
  for(const dir of [approved,outside,denied]) mkdirSync(dir,{recursive:true});
  const good=join(approved,'public.ts'),secret=join(outside,'excluded-marker.txt'),nested=join(denied,'nested-marker.txt');
  writeFileSync(good,'hello approved\ncontext line\nhello again\n');
  writeFileSync(secret,'SYNTHETIC_SCOPE_MARKER_ONLY\n');writeFileSync(nested,'SYNTHETIC_SCOPE_MARKER_ONLY\n');
  const policy=createSandboxPolicy({pathAllowlist:[approved],pathDenylist:[denied],network:'deny'});
  const tools=buildToolList(undefined,{cwd:root}).filter(tool=>getBuiltinToolIdentity(tool)==='readonly');
  const registry=new ToolRegistry({autoMode:true,nativeReadonlyOnly},applySandboxToTools(tools,createSandboxEnforcer(policy)));
  registries.push(registry);return {root,approved,outside,denied,good,secret,nested,registry,policy};
}
describe.each([true,false])('sandbox native tools (nativeReadonlyOnly=%s)',native=>{
  it.each(['read','grep','glob'] as const)('denies explicit outside root for %s',async name=>{
    const f=fixture(native);const input=name==='read'?{file_path:f.secret}:name==='grep'?{path:f.secret,pattern:'SYNTHETIC_SCOPE_MARKER_ONLY'}:{path:f.outside,pattern:'*.txt'};
    const result=await f.registry.executeTool(name,input);
    expect(result).toMatch(/sandbox denied/);
    expect(result).not.toContain('SYNTHETIC_SCOPE_MARKER_ONLY');expect(result).not.toContain('excluded-marker.txt');
  });
  it.each(['grep','glob'] as const)('keeps approved %s useful and prunes denied children',async name=>{
    const f=fixture(native);const result=await f.registry.executeTool(name,name==='grep'?{path:f.approved,pattern:'hello|SYNTHETIC_SCOPE_MARKER_ONLY'}:{path:f.approved,pattern:'**/*'});
    expect(result).toContain(name==='grep'?'hello approved':'public.ts');
    expect(result).not.toContain('SYNTHETIC_SCOPE_MARKER_ONLY');expect(result).not.toContain('nested-marker');
  });
  it.each(['grep','glob'] as const)('checks default cwd for %s',async name=>{
    const f=fixture(native);vi.spyOn(process,'cwd').mockReturnValue(f.outside);
    const result=await f.registry.executeTool(name,name==='grep'?{pattern:'SYNTHETIC_SCOPE_MARKER_ONLY'}:{pattern:'*.txt'});
    expect(result).toMatch(/sandbox denied/);expect(result).not.toContain('excluded-marker');
  });
  it('resolves relative search roots before dispatch',async()=>{
    const f=fixture(native);const result=await f.registry.executeTool('grep',{path:relative(process.cwd(),f.approved),pattern:'hello'});
    expect(result).toContain('hello approved');expect(result).not.toContain('SYNTHETIC_SCOPE_MARKER_ONLY');
  });
  it.each(['../outside/*.txt','{../outside/excluded-marker.txt,public.ts}','private/nested-marker.txt'])('does not escape via glob selector %s',async pattern=>{
    const f=fixture(native);const result=await f.registry.executeTool('glob',{path:f.approved,pattern});
    expect(result).not.toContain('excluded-marker');expect(result).not.toContain('nested-marker');
    expect(result).toMatch(/sandbox denied|无匹配/);
  });
  it('does not escape via an absolute glob selector',async()=>{
    const f=fixture(native);const result=await f.registry.executeTool('glob',{path:f.approved,pattern:f.secret.replace(/\\/g,'/')});
    expect(result).not.toContain('excluded-marker');expect(result).toMatch(/sandbox denied|无匹配/);
  });
  it.skipIf(process.platform==='win32')('does not read linked external files or directories',async()=>{
    const f=fixture(native);symlinkSync(f.secret,join(f.approved,'file-link.txt'));symlinkSync(f.outside,join(f.approved,'dir-link'));
    const result=await f.registry.executeTool('grep',{path:f.approved,pattern:'hello|SYNTHETIC_SCOPE_MARKER_ONLY'});
    expect(result).toContain('hello approved');expect(result).not.toContain('SYNTHETIC_SCOPE_MARKER_ONLY');
    const direct=await f.registry.executeTool('glob',{path:join(f.approved,'dir-link'),pattern:'*.txt'});
    expect(direct).toMatch(/sandbox denied/);expect(direct).not.toContain('excluded-marker');
  });
});
it.each(['lines','files','count'])('preserves grep output mode %s and filtering',async output_mode=>{
  const f=fixture();const result=await f.registry.executeTool('grep',{path:f.approved,pattern:'hello',type:'ts',glob:'*.ts',context:1,output_mode});
  expect(result).toContain(output_mode==='files'?'public.ts':output_mode==='count'?'public.ts:2':'hello approved');
  if(output_mode==='lines') expect(result).toContain('context line');
});
it('preserves readonly sandbox enforcement in observation forks',async()=>{
  const f=fixture();const fork=f.registry.forkForObservation([],['read','grep','glob']);registries.push(fork);
  expect(await fork.executeTool('grep',{path:f.secret,pattern:'SYNTHETIC_SCOPE_MARKER_ONLY'})).toMatch(/sandbox denied/);
  expect(await fork.executeTool('glob',{path:f.approved,pattern:'*.ts'})).toContain('public.ts');
});
it('does not dispatch a pre-cancelled sandbox grep',async()=>{
  const f=fixture();const controller=new AbortController();controller.abort(new Error('host cancelled'));
  const result=await f.registry.executeTool('grep',{path:f.approved,pattern:'hello'},{signal:controller.signal} as any).catch(String);
  expect(result).toMatch(/cancel|abort/i);expect(result).not.toContain('hello approved');
});
it('prunes denied directories before their contents are enumerated',async()=>{
  const f=fixture();const visits:string[]=[];
  const runner=createBoundedGlobRunner();
  const result=await runner.search({patterns:'**/*',cwd:f.approved},undefined,path=>{
    visits.push(path);return f.policy.checkPath(path).allowed;
  });
  expect(result.map(entry=>entry.path)).toContain(f.good.replace(/\\/g,'/'));
  expect(result.map(entry=>entry.path)).not.toContain(f.nested.replace(/\\/g,'/'));
  expect(visits).not.toContain(f.nested);expect(runner.activeCount).toBe(0);
});
it('fails closed when a live path grant is withdrawn before returning worker results',async()=>{
  const f=fixture();const visits=new Map<string,number>();const runner=createBoundedGlobRunner();
  await expect(runner.search({patterns:'public.ts',cwd:f.approved},undefined,path=>{
    path=resolve(path);
    const count=(visits.get(path)??0)+1;visits.set(path,count);
    return path!==f.good || count===1;
  })).rejects.toThrow(/sandbox denied/);
  expect(runner.activeCount).toBe(0);
});
it('runs fallback regex off the caller thread and reaps a CPU-bound grep worker',async()=>{
  const f=fixture();writeFileSync(f.good,'a'.repeat(20_000)+'!');
  const runner=createBoundedGlobRunner({timeoutMs:150});let progressed=false;
  const timer=setTimeout(()=>{progressed=true;},20);
  try{
    await expect(runner.grep({cwd:f.approved,patterns:'public.ts',grep:{pattern:'(a+)+$',context:0,outputMode:'lines'}})).rejects.toThrow(/glob_timeout/);
    expect(progressed).toBe(true);expect(runner.activeCount).toBe(0);
  }finally{clearTimeout(timer);}
});
it('does not probe or invoke external search programs under sandbox',async()=>{
  const f=fixture(false);vi.mocked(spawnSync).mockClear();
  expect(await f.registry.executeTool('grep',{path:f.approved,pattern:'hello'})).toContain('hello approved');
  expect(spawnSync).not.toHaveBeenCalled();
});
it('distinguishes invalid regex and read failures from a successful empty search',async()=>{
  const f=fixture();
  expect(await f.registry.executeTool('grep',{path:f.good,pattern:'['})).toContain('grep_invalid_regex');
  expect(await f.registry.executeTool('grep',{path:join(f.approved,'missing.txt'),pattern:'hello'})).toContain('grep_read_failed');
  expect(await f.registry.executeTool('grep',{path:f.good,pattern:'no-such-match'})).toContain('无匹配');
});
it.skipIf(process.platform==='win32')('rejects FIFO before opening it rather than hanging or reporting no match',async()=>{
  const f=fixture();const fifo=join(f.approved,'fifo');
  expect(spawnSync('mkfifo',[fifo]).status).toBe(0);
  expect(await f.registry.executeTool('grep',{path:fifo,pattern:'hello'})).toContain('grep_read_failed');
});
it.skipIf(process.platform==='win32')('checks structured paths and escapes newline filenames before display',async()=>{
  const f=fixture();const file=join(f.approved,'split\nforged:1:marker.txt');writeFileSync(file,'hello controlled');
  const result=await f.registry.executeTool('grep',{path:file,pattern:'hello'});
  expect(result).toContain('hello controlled');expect(result).toContain('split\\nforged:1:marker.txt');
  expect(result).not.toContain('\nforged:1:marker.txt');
});
it('keeps the worker wall deadline when the caller event loop is temporarily busy',async()=>{
  const f=fixture();const runner=createBoundedGlobRunner({timeoutMs:30});
  const pending=runner.search({patterns:'*.ts',cwd:f.approved},undefined,()=>true);
  const until=Date.now()+80;while(Date.now()<until) { /* simulate another synchronous host task */ }
  await expect(pending).rejects.toThrow('glob_timeout');expect(runner.activeCount).toBe(0);
});
it('handles a directory larger than one authorization batch with live policy checks',async()=>{
  const f=fixture();for(let i=0;i<600;i++)writeFileSync(join(f.approved,`batch-${i}.txt`),'hello');
  const runner=createBoundedGlobRunner();
  const result=await runner.search({cwd:f.approved,patterns:'batch-*.txt'},undefined,path=>f.policy.checkPath(path).allowed);
  expect(result).toHaveLength(600);expect(runner.activeCount).toBe(0);
});
it('rejects oversized authorization messages before invoking host policy',async()=>{
  const f=fixture();const script=join(f.approved,'oversized-worker.mjs');
  writeFileSync(script,"import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'authorize',id:1,paths:Array(257).fill('x')});");
  const runner=createBoundedGlobRunner({workerUrl:pathToFileURL(script)});const guard=vi.fn(()=>true);
  await expect(runner.search({cwd:f.approved,patterns:'*.ts'},undefined,guard)).rejects.toThrow('glob_worker_failed');
  expect(guard).not.toHaveBeenCalled();expect(runner.activeCount).toBe(0);
});
it('rejects oversized input files without treating them as a successful empty search',async()=>{
  const f=fixture();writeFileSync(f.good,Buffer.alloc(8*1024*1024+1,97));
  expect(await f.registry.executeTool('grep',{path:f.good,pattern:'not-present'})).toContain('grep_read_limit');
});
it('revalidates paths that contributed a zero-match search before returning that fact',async()=>{
  const f=fixture();const runner=createBoundedGlobRunner();let calls=0;
  await expect(runner.grep({cwd:f.good,patterns:'**/*',grep:{pattern:'no-match',context:0,outputMode:'lines'}},undefined,()=>++calls<=4))
    .rejects.toThrow(/sandbox denied/);
  expect(runner.activeCount).toBe(0);
});
it('cancels while the worker is waiting for search authorization without leaking a slot',async()=>{
  const f=fixture();const runner=createBoundedGlobRunner();const controller=new AbortController();
  await expect(runner.search({patterns:'**/*',cwd:f.approved},controller.signal,()=>{
    controller.abort(new Error('guard cancelled'));return true;
  })).rejects.toThrow(/guard cancelled/);
  expect(runner.activeCount).toBe(0);
});
