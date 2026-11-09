// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopAssistantInbox} from '../../electron/desktop-assistant-inbox.js';
import {createAssistantRegistry} from '../../electron/assistant-tool-policy.js';

it('composes the real inbox calendar/message tools into the closed assistant registry without external IO',async()=>{
 const root=mkdtempSync(join(tmpdir(),'assistant-composition-'));
 const forbidden=vi.fn(async()=>{throw Error('unexpected_external_io');});
 const inbox=createDesktopAssistantInbox({
  dataRoot:root,
  crypto:{isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()},
  mail:{list:()=>[],getSendReceipt:()=>undefined,send:forbidden} as never,
  llm:{generate:forbidden} as never,
  profile:()=>({active:false,timeZone:'UTC'}),
  search:forbidden,launch:forbidden,canLaunch:()=>{},changed:()=>{},
  internal:async()=>[],facts:()=>[],reminders:{create:()=>{throw Error('unexpected_reminder');},cancel:()=>{throw Error('unexpected_reminder');}},
 });
 let registry:ReturnType<typeof createAssistantRegistry>|undefined;
 try{
  registry=createAssistantRegistry(join(root,'workspace'),inbox.tools);
  const names=registry.getToolDefinitions().map(tool=>tool.name);
  for(const name of ['assistant_read_sources','assistant_prepare_reply','assistant_list_calendar_events','assistant_prepare_calendar_event','assistant_analyze_messages','kim_model_status'])expect(names).toContain(name);
  for(const name of ['bash','tool_search','mcp_call','scheduled_task_cancel'])expect(names).not.toContain(name);
  expect(forbidden).not.toHaveBeenCalled();
 }finally{
  inbox.dispose();
  try{await inbox.drain();}finally{try{registry?.dispose();}finally{try{inbox.close();}finally{rmSync(root,{recursive:true,force:true});}}}
 }
});
