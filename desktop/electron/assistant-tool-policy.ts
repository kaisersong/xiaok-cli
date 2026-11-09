import { isAssistantThread } from '../shared/assistant-inbox-contract.js';
import { mkdirSync,readdirSync } from 'node:fs';
import { buildToolList } from '../../src/ai/tools/index.js';
import type { Tool } from '../../src/types.js';
import { DesktopOwnedToolRegistry } from './desktop-multi-agent-catalog-bridge.js';
const NATIVE_NAMES=new Set(['read','write','edit','web_search','kim_judge_messages','kim_model_status']);
const EXTRA_NAMES=new Set(['mail_list_accounts','mail_search','mail_read','mail_send','assistant_read_sources','assistant_analyze_messages','assistant_prepare_reply','assistant_list_calendar_events','assistant_prepare_calendar_event']);
/** Construct from native factories, never from the broad host/MCP registry. */
export function createAssistantRegistry(root:string,extras:Tool[]):DesktopOwnedToolRegistry{
 mkdirSync(root,{recursive:true,mode:0o700});const native=buildToolList(undefined,{cwd:root,allowOutsideCwd:false}).filter(tool=>NATIVE_NAMES.has(tool.definition.name));
 const tools=[...native,...extras.filter(tool=>EXTRA_NAMES.has(tool.definition.name)),{permission:'safe' as const,definition:{name:'assistant_list_files',description:'只列出小K助理工作目录的文件名。严禁读取或配置凭据。',inputSchema:{type:'object',properties:{},additionalProperties:false}},execute:async()=>JSON.stringify(readdirSync(root,{withFileTypes:true}).filter(e=>!e.isSymbolicLink()).slice(0,100).map(e=>({name:e.name,directory:e.isDirectory()})))}];
 const registry=new DesktopOwnedToolRegistry({autoMode:true},tools);registry.unregisterTool('tool_search');
 for(const name of ['read','write','edit']){const tool=registry.getRegisteredTool(name)!;registry.registerOwnedTool(tool,{...registry.ownerOf(name)!,binding:'custom',verifiedReadOnly:false,bindInvocation:authority=>{if(authority.agentId!==`root_${authority.groupId}`)throw Error('tool_scope_unsupported');return tool.execute;}});}
 return registry;
}
/** Close both discovery and execution on the root runtime's derived registry. */
export function constrainAssistantInvocation(source:import('../../src/ai/tools/index.js').ToolRegistry,target:import('../../src/ai/tools/index.js').ToolRegistry):void {const allowed=new Set(source.getToolDiscoveries().map(d=>d.coreDefinition.name));for(const d of target.getToolDiscoveries())if(!allowed.has(d.coreDefinition.name))target.unregisterTool(d.coreDefinition.name);target.setAllowedTools([...allowed]);}

/** External executors cannot prove the assistant’s closed tool boundary. */
export function assertAssistantExecutorInput(input:{prompt?:string;threadId?:string;context?:{threadId?:string}},external:boolean):void {if(external&&(isAssistantThread(input.threadId??input.context?.threadId)||input.prompt?.startsWith('[xiaok-assistant-watch:')))throw Error('assistant_executor_unavailable');}
