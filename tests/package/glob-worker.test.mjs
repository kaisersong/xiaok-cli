import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globTool } from '../../dist/ai/tools/glob.js';
import {buildToolList,ToolRegistry} from '../../dist/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../dist/ai/tools/native-tool-identity.js';
import {applySandboxToTools} from '../../dist/platform/sandbox/tool-wrappers.js';
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
