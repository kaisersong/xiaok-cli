// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { createContextResolverTool } from '../../electron/context-continuity/tool.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { runDesktopToolLoop } from '../../electron/desktop-services.js';

it.each([false, true])('rechecks consumed context before the next provider request or sibling tool (sibling=%s)', async sibling => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-admission-'));
  const service = new ContinuityService({ dbPath: join(root, 'continuity.sqlite'), profileId: 'p' });
  const actor = { requestSource: 'user' as const, actorId: 'desktop-user:p', profileId: 'p' };
  const source = service.createConversation(actor, { operationId: 'source' }), target = service.createConversation(actor, { operationId: 'target' });
  service.recordMessage(actor, { conversationId: source.id, sourceId: 'source', sourceKind: 'desktop_task', sourceDataEpoch: 'epoch', sourceMessageId: 'answer', sourceRevision: 1, role: 'assistant', text: 'PRIVATE_CANARY', executionState: 'settled' });
  const ref = service.createReference(actor, { conversationId: source.id, expectedRevision: service.getConversation(actor, source.id)!.revision, operationId: 'ref' });
  const grant = service.attachReference(actor, { refId: ref.refId, targetConversationId: target.id, operationId: 'grant' });
  service.bindTask(actor, { conversationId: target.id, taskId: 'consumer' });
  const resolver = createContextResolverTool(() => ({ service, actor })), execute = resolver.execute;
  resolver.execute = async (input, context) => { const result = await execute(input, context); expect(result).toContain('PRIVATE_CANARY'); service.revokeGrant(actor, grant); return result; };
  const sideEffect = vi.fn(async () => 'done');
  const registry = new ToolRegistry({ autoMode: true }, [resolver, { permission: 'safe', definition: { name: 'side_effect', description: 'fixture', inputSchema: { type: 'object', properties: {} } }, execute: sideEffect }]);
  let calls = 0;
  try {
    await expect(runDesktopToolLoop({
      adapter: { async *stream() { if (++calls === 1) { yield { type: 'tool_use' as const, id: 'read', name: 'resolve_context_reference', input: { refId: ref.refId } }; if (sibling) yield { type: 'tool_use' as const, id: 'effect', name: 'side_effect', input: {} }; } else yield { type: 'text' as const, delta: 'leaked' }; yield { type: 'done' as const }; } },
      authorizeContext: () => service.assertTaskReadable('consumer'),
      registry, allToolDefs: registry.getToolDefinitions(), messages: [{ role: 'user', content: [{ type: 'text', text: ref.url }] }],
      systemPrompt: '', signal: new AbortController().signal, taskDeadline: Date.now() + 30000, sessionId: 'session', turnId: 'turn', taskId: 'consumer', intentId: 'intent', stepId: 'step', materials: [], emitRuntimeEvent: async () => {}, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(),
      strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: m => m, processToolResult: r => r, trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
    })).rejects.toThrow('not_readable');
    expect(calls).toBe(1); expect(sideEffect).not.toHaveBeenCalled();
  } finally { registry.dispose(); service.close(); rmSync(root, { recursive: true, force: true }); }
});

it('the original no-tools finalization sink rejects source permission revoked after its actual provider admission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-summary-sink-')),service=new ContinuityService({dbPath:join(root,'continuity.sqlite'),profileId:'p'}),actor={requestSource:'user' as const,actorId:'desktop-user:p',profileId:'p'},source=service.createConversation(actor,{operationId:'s'}),target=service.createConversation(actor,{operationId:'t'});
 service.recordMessage(actor,{conversationId:source.id,sourceId:'source',sourceKind:'desktop_task',sourceDataEpoch:'epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'source',executionState:'settled'});const ref=service.createReference(actor,{conversationId:source.id,expectedRevision:service.getConversation(actor,source.id)!.revision,operationId:'ref'}),grant=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});service.bindTask(actor,{conversationId:target.id,taskId:'consumer'});await createContextResolverTool(()=>({service,actor})).execute({refId:ref.refId},{taskId:'consumer'} as never);
 const events:unknown[]=[],registry=new ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'probe',description:'read-only fixture',inputSchema:{type:'object',properties:{}}},execute:async()=> 'harmless result'}]);let summary=false;
 try{await expect(runDesktopToolLoop({adapter:{async *stream(_messages,tools){if(tools.length)yield {type:'tool_use' as const,id:'read',name:'probe',input:{}};else{summary=true;service.revokeGrant(actor,grant);yield {type:'text' as const,delta:'REVOKED_FINALIZATION'};}yield {type:'done' as const};}},authorizeContext:()=>service.assertTaskReadable('consumer'),registry,allToolDefs:registry.getToolDefinitions(),messages:[{role:'user',content:[{type:'text',text:'work'}]}],systemPrompt:'',signal:new AbortController().signal,taskDeadline:Date.now()+10000,sessionId:'session',turnId:'turn',taskId:'consumer',intentId:'intent',stepId:'step',materials:[],emitRuntimeEvent:async event=>{if(event.type==='assistant_delta')events.push(event);},skillInvocation:null,skillCatalog:{} as never,dataRoot:root,taskStartTime:Date.now(),maxIterations:1,strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}})).rejects.toThrow('not_readable');expect(summary).toBe(true);expect(events).toEqual([]);}finally{console.info('SUMMARY_SINK_OBSERVED',JSON.stringify({summary,publicOutputCount:events.length}));registry.dispose();service.close();rmSync(root,{recursive:true,force:true});}
});
