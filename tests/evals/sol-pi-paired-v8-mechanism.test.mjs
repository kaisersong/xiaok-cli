import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createPairedMechanism} from '../../scripts/evals/sol-pi/paired-mechanism.mjs';
import {AgentSessionState} from '../../src/ai/runtime/session.ts';
import {createReadTool} from '../../src/ai/tools/read.ts';
import {ToolRegistry} from '../../src/ai/tools/index.ts';
import {mcpTestContext} from '../support/mcp-cancellation-context.ts';
const sourceRoot=resolve('.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const environmentPath=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json');
const manifestPath=join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/manifest.json');
test('actual official environment creates candidate owner and production recall rejects extra authority fields',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'solpi-v8-mechanism-')));let mechanism,registry;
 try{
  const workspace=join(root,'workspace');await fs.mkdir(workspace);await fs.writeFile(join(workspace,'fixture.txt'),'ACTUAL_FIXTURE');
  const environmentBytes=await fs.readFile(environmentPath),manifestBytes=await fs.readFile(manifestPath);
  const recipeEnvironment={environmentPath:await fs.realpath(environmentPath),manifestPath:await fs.realpath(manifestPath),environmentSha256:sha(environmentBytes),manifestFileSha256:sha(manifestBytes),manifestSemanticSha256:JSON.parse(manifestBytes).sha256};
  const session=new AgentSessionState();mechanism=await createPairedMechanism({sourceRoot,runDirectory:root,workspace,task:{files:{'fixture.txt':'ACTUAL_FIXTURE'}},session,command:null,recipeEnvironment,protocol:'openai_legacy',profileId:'generic-openai',destination:{provider:'test',model:'deepseek-flash',url:'https://api.deepseek.com/chat/completions'}});
  const tool=createReadTool({cwd:workspace}),context=mcpTestContext(new AbortController().signal,{observationCollector:mechanism.owner.collectorFor('native-read')});
  const native=await tool.execute({file_path:join(workspace,'fixture.txt')},context);
  const projected=await mechanism.owner.projectToolResult('native-read',native);assert.match(projected,/ACTUAL_FIXTURE/);
  const facts=mechanism.diagnostics();assert.equal(facts.qualified,true);assert.equal(facts.captures,1);assert.equal(facts.finalized.length,1);
  const id=facts.finalized[0].id;registry=new ToolRegistry({autoMode:true},[mechanism.recallTool]);
  const rejected=await registry.executeTool('observation_read',{id,offset:0,maxBytes:64,provider:'other'});
  assert.match(rejected,/Error|invalid|Invalid/);assert.equal(mechanism.diagnostics().recallCalls,0);
  const recalled=await registry.executeTool('observation_read',{id,offset:0,maxBytes:64});assert.match(recalled,/ACTUAL_FIXTURE/);
  assert.equal(mechanism.diagnostics().recallCompleted,1);assert.equal(mechanism.diagnostics().counters[0].fullLogicalSendCount,0);
  await fs.writeFile(join(workspace,'outside.txt'),'NO_GRANT');
  const outside=await tool.execute({file_path:join(workspace,'outside.txt')},mcpTestContext(new AbortController().signal,{observationCollector:mechanism.owner.collectorFor('outside')}));
  assert.doesNotMatch(await mechanism.owner.projectToolResult('outside',outside),/NO_GRANT/);
 }finally{registry?.dispose();mechanism?.dispose();await fs.rm(root,{recursive:true,force:true});}
});
