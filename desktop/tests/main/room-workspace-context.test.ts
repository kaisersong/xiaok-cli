import { describe, expect, it } from 'vitest';
import { assembleRoomWorkspaceContext, resolveRoomWorkspaceContextLimit } from '../../electron/room-workspace-context.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { DEFAULT_MODEL_CAPABILITIES } from '../../../src/ai/runtime/model-capabilities.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import type { Config } from '../../../src/types.js';
const context={roomId:'r',workspaceId:'w',bindingId:'b',generation:1,contextScope:{kind:'room_only' as const},publishedInstructions:'完整强制规则：目录名称无内建语义。'};
const base={baseSystemPrompt:'Platform permissions are authoritative.',context,taskPrompt:'Write the requested document.',history:[],tools:[],contextLimit:10000};
describe('Room workspace context uses complete rules and authorized scoped metadata',()=>{
  it('uses the existing conservative budget for known Claude profiles without changing global runtime windows',()=>{
    for(const model of ['claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5']){
      const config={schemaVersion:2,defaultProvider:'anthropic',defaultModelId:'profile',providers:{anthropic:{type:'first_party',protocol:'anthropic',apiKey:'fixture'}},models:{profile:{provider:'anthropic',model,label:'profile'}}} as Config;
      const binding=resolveRuntimeModelBinding(config);
      expect(binding.runtimeOptions?.contextLimit).toBeUndefined();
      expect(resolveRoomWorkspaceContextLimit(binding)).toBe(DEFAULT_MODEL_CAPABILITIES.contextLimit);
      const outputTokenReserve=createAdapterFromBinding(binding).getOutputTokenReserve!();
      const tokens=assembleRoomWorkspaceContext({...base,outputTokenReserve}).estimatedInputTokens;
      expect(()=>assembleRoomWorkspaceContext({...base,outputTokenReserve,contextLimit:tokens+outputTokenReserve-1})).toThrow('workspace_instructions_exceed_context_budget');
      expect(()=>assembleRoomWorkspaceContext({...base,outputTokenReserve,contextLimit:tokens+outputTokenReserve})).not.toThrow();
      expect(()=>assembleRoomWorkspaceContext({...base,contextLimit:resolveRoomWorkspaceContextLimit(binding)})).not.toThrow();
      expect(resolveRoomWorkspaceContextLimit({...binding,providerType:'custom'})).toBe(0);
      expect(resolveRoomWorkspaceContextLimit({...binding,wireModel:'claude-unknown-future'})).toBe(0);
    }
  });
  it('keeps entire rules, confirmed decisions and exact file references without injecting other scopes',()=>{
    const result=assembleRoomWorkspaceContext({...base,context:{...context,confirmedDecisions:[
      {decisionId:'d',roomId:'r',contextScope:{kind:'room_only'},revision:1,text:'Use custom folder',confirmedBy:{kind:'user',userId:'u'}},
      {decisionId:'unconfirmed',roomId:'r',contextScope:{kind:'room_only'},revision:1,text:'INJECT UNCONFIRMED'},
      {decisionId:'other',roomId:'other',contextScope:{kind:'room_only'},revision:1,text:'OTHER ROOM',confirmedBy:{kind:'user',userId:'u'}},
    ],artifactRefs:[{roomId:'r',workspaceId:'w',bindingId:'b',generation:1,contextScope:{kind:'room_only'},artifactId:'a',versionId:'v',relativePath:'自定义/file.md',contentHash:'a'.repeat(64),state:'draft',content:'DO NOT INJECT',absolutePath:'/private/hidden'},
      {roomId:'r',workspaceId:'w',bindingId:'b',generation:1,contextScope:{kind:'project',projectId:'p'},artifactId:'other-project',versionId:'v2',relativePath:'hidden',contentHash:'b'.repeat(64)}]}});
    expect(result.systemPrompt).toContain(context.publishedInstructions);
    expect(result.systemPrompt.indexOf('Platform')).toBeLessThan(result.systemPrompt.indexOf(context.publishedInstructions));
    expect(result.userPrompt).toContain('Use custom folder');expect(result.userPrompt).toContain('自定义/file.md');
    for(const secret of ['UNCONFIRMED','OTHER ROOM','DO NOT INJECT','/private/hidden','other-project'])expect(result.userPrompt).not.toContain(secret);
  });
  it('rejects too-large mandatory published instructions before any model callback, never truncates them',()=>{
    expect(()=>assembleRoomWorkspaceContext({...base,context:{...context,publishedInstructions:'RULE'.repeat(1000)},contextLimit:100})).toThrow('workspace_instructions_exceed_context_budget');
    expect(()=>assembleRoomWorkspaceContext({...base,contextLimit:undefined as unknown as number})).toThrow('workspace_context_budget_unavailable');
  });
  it('counts tool schemas, history, images and output reservation in the actual request estimate',()=>{
    const result=assembleRoomWorkspaceContext(base);
    expect(()=>assembleRoomWorkspaceContext({...base,contextLimit:result.estimatedInputTokens+1,outputTokenReserve:100})).toThrow();
    expect(()=>assembleRoomWorkspaceContext({...base,contextLimit:result.estimatedInputTokens+10,tools:[{name:'huge',description:'x'.repeat(5000),inputSchema:{type:'object',properties:{}}}]})).toThrow();
    expect(()=>assembleRoomWorkspaceContext({...base,contextLimit:result.estimatedInputTokens+10,currentImageBlocks:[{type:'image',source:{type:'base64',media_type:'image/png',data:'x'.repeat(20000)}}]})).toThrow();
  });
  it('omits whole optional references with explicit counts when budget cannot fit, without cutting mandatory text',()=>{
    const c={...context,confirmedDecisions:Array.from({length:20},(_,i)=>({decisionId:`d${i}`,roomId:'r',contextScope:{kind:'room_only'},revision:1,text:'Decision '.repeat(100),confirmedBy:{kind:'user',userId:'u'}}))};
    const result=assembleRoomWorkspaceContext({...base,context:c,contextLimit:600});
    expect(result.omittedReferences).toBeGreaterThan(0);expect(result.userPrompt).toContain('omitted');
    expect(result.systemPrompt).toContain(context.publishedInstructions);expect(result.estimatedInputTokens).toBeLessThanOrEqual(600);
  });
});
