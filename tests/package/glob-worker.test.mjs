import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {types} from 'node:util';
import {build} from 'esbuild';
import { grepTool } from '../../dist/ai/tools/grep.js';
import {getSearchScope,withSearchScope} from '../../dist/ai/tools/search-scope-context.js';
import {getSandboxSearchGuard,withSandboxSearchScope} from '../../dist/platform/sandbox/search-scope.js';
import {createNativeReadonlyExecutionContext,isNativeReadonlyExecutionContext} from '../../dist/ai/tools/native-readonly-context.js';
import { globTool } from '../../dist/ai/tools/glob.js';
import {buildToolList,ToolRegistry} from '../../dist/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../dist/ai/tools/native-tool-identity.js';
import {applySandboxToTools,isScopedSandboxReadonlyTool,inheritCompoundSandboxPreparation} from '../../dist/platform/sandbox/tool-wrappers.js';
import {createSandboxEnforcer} from '../../dist/platform/sandbox/enforcer.js';
import {createSandboxPolicy} from '../../dist/platform/sandbox/policy.js';

test('CLI built worker matches source bytes and executes with the built tool', async () => {
  assert.deepEqual(readFileSync(new URL('../../dist/ai/tools/glob-worker.mjs', import.meta.url)), readFileSync(new URL('../../src/ai/tools/glob-worker.mjs', import.meta.url)));
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-glob-package-'));
  try {
    writeFileSync(join(dir, 'expected.txt'), '');
    assert.equal(await globTool.execute({path:dir,pattern:'*.txt'}), join(dir, 'expected.txt').replace(/\\/g, '/'));
  } finally { rmSync(dir, {recursive:true,force:true,maxRetries:3}); }
});

test('built readonly registry denies outside read/grep/glob and preserves approved searches',async t=>{
  const root=mkdtempSync(join(tmpdir(),'xiaok-search-package-'));
  let registry;
  try{
    const approved=join(root,'approved'),outside=join(root,'outside');
    mkdirSync(approved);mkdirSync(outside);
    const secret=join(outside,'excluded-marker.txt');
    writeFileSync(secret,'SYNTHETIC_PACKAGE_SCOPE_MARKER');writeFileSync(join(approved,'public.txt'),'hello approved');
    const tools=buildToolList(undefined,{cwd:root}).filter(tool=>getBuiltinToolIdentity(tool)==='readonly');
    registry=new ToolRegistry({autoMode:true,nativeReadonlyOnly:true},applySandboxToTools(tools,createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[approved],network:'deny'}))));
    for(const [name,input] of [['read',{file_path:secret}],['grep',{path:secret,pattern:'SYNTHETIC_PACKAGE_SCOPE_MARKER'}],['glob',{path:outside,pattern:'*.txt'}]]){
      await t.test(`built ${name} rejects unapproved paths`,async()=>{
        const result=await registry.executeTool(name,input);
        assert.match(result,/sandbox denied/);assert.doesNotMatch(result,/SYNTHETIC_PACKAGE_SCOPE_MARKER|excluded-marker/);
      });
    }
    await t.test('built grep finds approved content',async()=>assert.match(await registry.executeTool('grep',{path:approved,pattern:'hello'}),/hello approved/));
    await t.test('built glob finds approved filenames',async()=>assert.match(await registry.executeTool('glob',{path:approved,pattern:'*.txt'}),/public\.txt/));
  }finally{registry?.dispose();rmSync(root,{recursive:true,force:true,maxRetries:3});}
});

test('built scoped grep uses the packaged worker and preserves positive and denied paths', async () => {
  const dir=mkdtempSync(join(tmpdir(),'xiaok-scoped-grep-package-'));
  try {
    const allowed=join(dir,'allowed'),denied=join(allowed,'denied');mkdirSync(denied,{recursive:true});
    writeFileSync(join(allowed,'public.txt'),'PUBLIC_MATCH');writeFileSync(join(denied,'private.txt'),'PRIVATE_MATCH');
    const [tool]=applySandboxToTools([grepTool],createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[allowed],pathDenylist:[denied],network:'deny'})));
    const result=await tool.execute({path:allowed,pattern:'MATCH'});
    assert.match(result,/PUBLIC_MATCH/);assert.doesNotMatch(result,/PRIVATE_MATCH/);
    assert.match(await tool.execute({path:dir,pattern:'MATCH'}),/denied/);
  } finally {rmSync(dir,{recursive:true,force:true,maxRetries:3});}
});

test('derived sandbox search context keeps both private scopes and readonly identity without accepting DTO copies',()=>{
  const dir=mkdtempSync(join(tmpdir(),'xiaok-search-derived-'));
  try{
    const scope=Object.freeze({allowedPaths:Object.freeze([dir]),deniedPaths:Object.freeze([])});
    const original=withSearchScope(createNativeReadonlyExecutionContext({}),scope);
    const derived=withSandboxSearchScope(original,createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[dir],network:'deny'})));
    assert.equal(getSearchScope(derived),scope);assert.equal(isNativeReadonlyExecutionContext(derived),true);
    assert.equal(getSandboxSearchGuard(derived)(dir),true);assert.equal(getSandboxSearchGuard(derived)(join(dir,'..','outside')),false);
    const [wrapped]=applySandboxToTools([grepTool],createSandboxEnforcer(createSandboxPolicy({pathAllowlist:[dir],network:'deny'})));
    assert.equal(isScopedSandboxReadonlyTool(wrapped),true);
    const fake={...wrapped};assert.equal(isScopedSandboxReadonlyTool(fake),false);
    inheritCompoundSandboxPreparation(wrapped,fake);assert.equal(isScopedSandboxReadonlyTool(fake),true);
    for(const copied of [{...derived},{searchScope:scope,guard:()=>true}]){
      assert.equal(getSearchScope(copied),undefined);assert.equal(getSandboxSearchGuard(copied),undefined);
      assert.equal(isNativeReadonlyExecutionContext(copied),false);
    }
  }finally{rmSync(dir,{recursive:true,force:true,maxRetries:3});}
});

test('instrumented installed branch preserves the captured proxy check and original Source refusal without legacy fallback',async()=>{
  // Dependency instrumentation tests branch wiring only. The stub always
  // refuses: it is not a Main installation/Source/P permit or Native test.
  const root=mkdtempSync(join(tmpdir(),'xiaok-search-installed-refusal-'));
  try{
    const output=join(root,'installed-branch.mjs');
    const source=fileURLToPath(new URL('../../src/ai/tools/bounded-glob.ts',import.meta.url));
    await build({stdin:{contents:`export {createBoundedGlobRunner} from ${JSON.stringify(source)};export {calls} from 'search-merge-sdk-test';`,resolveDir:root,loader:'ts'},
      outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'fixed-refusal-dependencies',setup(plugin){
        plugin.onResolve({filter:/original-main-sdk-bridge\.js$/},()=>({path:'installed-fact',namespace:'search-test'}));
        plugin.onResolve({filter:/original-process-sdk-loader\.js$|^search-merge-sdk-test$/},()=>({path:'sdk-refusal',namespace:'search-test'}));
        plugin.onLoad({filter:/.*/,namespace:'search-test'},args=>({loader:'js',contents:args.path==='installed-fact'
          ?'export function hasOriginalMainSdkBridgeInstallation(){return true;}'
          :'let count=0;export function calls(){return count;}export async function loadOriginalProcessSdk(){count++;return {runOriginalBoundedReadonlyLeaf(){throw undefined;}};}'}));
      }}]});
    const loaded=await import(pathToFileURL(output).href),runner=loaded.createBoundedGlobRunner();
    const original=Object.getOwnPropertyDescriptor(types,'isProxy');let getterCalls=0;
    let rejected=false,first;
    try{
      Object.defineProperty(types,'isProxy',{configurable:true,get(){getterCalls++;return original.value;}});
      try{await runner.search({patterns:'*.txt',cwd:root});}catch(raw){rejected=true;first=raw;}
    }finally{Object.defineProperty(types,'isProxy',original);}
    assert.equal(rejected,true);assert.equal(first,undefined);assert.equal(loaded.calls(),1);
    assert.equal(runner.activeCount,0);assert.equal(getterCalls,0);
  }finally{rmSync(root,{recursive:true,force:true,maxRetries:3});}
});
