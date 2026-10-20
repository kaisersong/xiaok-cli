import {expect,test,_electron as electron,type ElectronApplication} from '@playwright/test';
import {createServer} from 'node:http';import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store';

for(const ending of ['revoke','delete'] as const)test(`CLI archive actual user loop and ${ending} denies dependent history`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-cli-archive-electron-'));mkdirSync(join(root,'workspace'));
 const store=new FileSessionStore(join(root,'config','sessions'));
 await store.save({sessionId:'cli_history_fixture',cwd:join(root,'workspace'),createdAt:1,updatedAt:2,lineage:['cli_history_fixture'],messages:[{role:'user',content:[{type:'text',text:'CLI_ARCHIVE_SHARED_TEXT'}]},{role:'assistant',content:[{type:'thinking',thinking:'CLI_PRIVATE_CANARY'},{type:'text',text:'CLI_ARCHIVE_SHARED_TEXT'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
 let sawResolver=false,sawNext=false,app:ElectronApplication|undefined;const pids:number[]=[],errors:string[]=[],calls:unknown[]=[];
 const server=createServer(async(request,response)=>{
  try{
   const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));const body=JSON.parse(Buffer.concat(parts).toString());calls.push(body);
   const messages=body.messages as Array<{role:string;content:unknown}>,lastUser=messages.findLastIndex(m=>m.role==='user'),user=JSON.stringify(messages[lastUser]?.content),tools=messages.slice(lastUser+1).filter(m=>m.role==='tool');
   response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   const send=(delta:unknown,finish:string)=>response.write(`data: ${JSON.stringify({id:'cli-archive',object:'chat.completion.chunk',created:1,model:'e2e-model',choices:[{index:0,delta,finish_reason:finish}]})}\n\n`);
   if(user.includes('CLI_TARGET_FOLLOWUP')){expect(JSON.stringify(messages)).toContain('CLI_RESOLVER_ANSWER');sawNext=true;send({content:'CLI_NEXT_ANSWER'},'stop');}
   else if(tools.length){expect(JSON.stringify(tools)).toContain('CLI_ARCHIVE_SHARED_TEXT');expect(JSON.stringify(tools)).toContain('user_claimed_archive');sawResolver=true;send({content:'CLI_RESOLVER_ANSWER'},'stop');}
   else{const refId=/xiaok:\/\/context\/v1\/([A-Za-z0-9_-]{32})/.exec(user)?.[1];if(!refId)throw new Error('expected exact reference');expect(body.tools.some((t:any)=>t.function.name==='resolve_context_reference')).toBe(true);send({tool_calls:[{index:0,id:'cli-reference',type:'function',function:{name:'resolve_context_reference',arguments:JSON.stringify({refId})}}]},'tool_calls');}
   response.end('data: [DONE]\n\n');
  }catch(error){errors.push(String(error));response.destroy();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  app=await electron.launch({args:[join(process.cwd(),'tests/e2e/fixtures/multi-agent-electron-main.mjs')],env:{...process.env,NODE_ENV:'test',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_E2E_USER_DATA:join(root,'profile'),XIAOK_MULTI_AGENT_E2E_ROOT:root,XIAOK_MULTI_AGENT_E2E_PROVIDER:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,XIAOK_E2E_BACKGROUND:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'1'}});
  pids.push(app.process().pid!);writeFileSync(join(root,'owned-processes.json'),JSON.stringify({pids}));const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('textarea').first()).toBeVisible();
  const target=await page.evaluate(()=>window.xiaokDesktop.createContextConversation({operationId:crypto.randomUUID(),title:'CLI target'}));await page.evaluate(id=>{location.hash=`#/t/${id}`;},target.id);
  await page.getByRole('button',{name:'搜索聊天历史',exact:true}).click();const panel=page.getByRole('region',{name:'搜索聊天历史'});
  await panel.getByRole('button',{name:'导入 CLI 历史',exact:true}).click();await panel.getByRole('button',{name:'cli_history_fixture',exact:true}).click();await expect(panel.getByText('CLI_ARCHIVE_SHARED_TEXT',{exact:true})).toBeVisible();
  await page.screenshot({path:join(root,'archive-import-preview.png')});
  await panel.getByRole('button',{name:'导入这些历史消息',exact:true}).click();await expect(panel.getByText('已导入 2 条历史消息，可在上方搜索后授权引用。')).toBeVisible();
  await panel.getByRole('textbox',{name:'历史关键词'}).fill('CLI_ARCHIVE_SHARED_TEXT');await panel.getByRole('button',{name:'搜索',exact:true}).click();await expect(panel.locator('article')).toHaveCount(2);
  // Find the second original message by its actual source locator, never equal text or search order.
  let selected=-1,sourceId='';for(let index=0;index<2;index++){
   const card=panel.locator('article').nth(index);await card.getByRole('button',{name:'展开引用'}).click();const href=await card.getByRole('link',{name:'前往原消息'}).getAttribute('href');expect(href).toMatch(/^#\/context\/[A-Za-z0-9_-]{32}$/);const original=await page.evaluate(refId=>window.xiaokDesktop.resolveContextReference({refId}),href!.split('/').at(-1)!);if(original.messages[0].sourceMessageId==='legacy_1'){selected=index;sourceId=original.conversationId;}
  }
  expect(selected).toBeGreaterThanOrEqual(0);const selectedCard=panel.locator('article').nth(selected);await selectedCard.getByRole('button',{name:'允许当前会话读取'}).click();await expect(selectedCard.getByRole('button',{name:'撤销当前授权'})).toBeVisible();
  const bound=await app.evaluate((_electron,{sourceId,targetId})=>{const db=(globalThis as any).multiAgentE2E.getServices().continuity.port().service.store.db;const row=db.prepare("SELECT g.id AS grantId,g.ref_id AS refId,a.id AS messageId FROM read_grants g JOIN context_ref_entries e ON e.ref_id=g.ref_id JOIN message_anchors a ON a.id=e.message_id WHERE g.target_conversation=? AND g.revoked=0 AND a.conversation_id=? AND a.source_message_id='legacy_1'").get(targetId,sourceId);if(!row)throw new Error('actual selected grant missing');return {...row,url:'xiaok://context/v1/'+row.refId,sourceId};},{sourceId,targetId:target.id});
  const exact=await page.evaluate(refId=>window.xiaokDesktop.resolveContextReference({refId}),bound.refId);expect(exact.messages.map(m=>m.sourceMessageId)).toEqual(['legacy_1']);expect(exact.messages[0].executionState).toBe('unknown');expect(JSON.stringify(exact)).not.toContain('CLI_PRIVATE_CANARY');
  await page.screenshot({path:join(root,'archive-search-authorized.png')});await page.setViewportSize({width:760,height:850});await page.screenshot({path:join(root,'archive-search-narrow.png')});await page.setViewportSize({width:1440,height:940});
  await selectedCard.getByRole('link',{name:'前往原消息'}).click();await expect(page).toHaveURL(new RegExp('#/context/'+bound.refId+'$'));const landing=page.getByRole('complementary',{name:'历史引用'});await landing.getByRole('button',{name:'展开引用'}).click();await expect(landing.getByText('CLI_ARCHIVE_SHARED_TEXT',{exact:true})).toBeVisible();await expect(landing.getByRole('link',{name:'前往原消息'})).toHaveCount(0);expect(await page.locator('body').innerText()).not.toContain('CLI_PRIVATE_CANARY');await page.screenshot({path:join(root,'archive-exact-source.png')});
  await page.evaluate(id=>{location.hash=`#/t/${id}`;},target.id);const input=page.locator('textarea').first();await input.fill(bound.url);await input.press('Enter');await expect(page.locator('.chat-right-main').getByText('CLI_RESOLVER_ANSWER',{exact:true})).toBeVisible();expect(sawResolver).toBe(true);
  const receipt=()=>app!.evaluate((_electron,id)=>{const db=(globalThis as any).multiAgentE2E.getServices().continuity.port().service.store.db;return db.prepare('SELECT i.task_id,i.status,r.task_id AS receipt FROM conversation_inputs i LEFT JOIN effect_owner_receipts r ON r.task_id=i.task_id WHERE i.conversation_id=? ORDER BY i.sequence').all(id);},target.id);
  await expect.poll(async()=>(await receipt()).map((r:any)=>[r.status,Boolean(r.receipt)])).toEqual([['completed',true]]);
  await input.fill('CLI_TARGET_FOLLOWUP');await input.press('Enter');await expect(page.locator('.chat-right-main').getByText('CLI_NEXT_ANSWER',{exact:true})).toBeVisible();expect(sawNext).toBe(true);
  await expect.poll(async()=>(await receipt()).map((r:any)=>[r.status,Boolean(r.receipt)])).toEqual([['completed',true],['completed',true]]);const taskIds=(await receipt()).map((r:any)=>r.task_id) as string[];
  // Use the real external MCP control and a genuine exact-grant credential.
  await page.evaluate(()=>window.xiaokDesktop.setContextMcpEnabled({enabled:true}));const issued=await page.evaluate(({refId,id})=>window.xiaokDesktop.issueContextMcpConfig({operationId:crypto.randomUUID(),targetConversationId:id,refIds:[refId]}),{refId:bound.refId,id:target.id}),config=JSON.parse(issued.clientConfig).mcpServers['xiaok-context'];
  const external=()=>fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'resolve_context_reference',arguments:{refId:bound.refId}}})});expect(await (await external()).text()).toContain('CLI_ARCHIVE_SHARED_TEXT');
  if(ending==='revoke')await page.evaluate(grantId=>window.xiaokDesktop.revokeContextGrant({grantId}),bound.grantId);
  else await app.evaluate((_electron,id)=>{const p=(globalThis as any).multiAgentE2E.getServices().continuity.port();p.service.tombstoneConversation(p.actor,id);},sourceId);
  const denied=await page.evaluate(async({taskIds,refId,ending})=>{
   const results:Record<string,boolean>={};for(const taskId of taskIds)for(const [name,call] of [['raw',()=>window.xiaokDesktop.recoverTask(taskId)],['history',()=>window.xiaokDesktop.readTaskHistory(taskId)]] as const){try{await call();results[taskId+name]=false;}catch{results[taskId+name]=true;}}
   if(ending==='delete'){try{await window.xiaokDesktop.resolveContextReference({refId});results.ref=false;}catch{results.ref=true;}}return results;
  },{taskIds,refId:bound.refId,ending});expect(Object.values(denied).every(Boolean)).toBe(true);
  const externalAfter=await external(),afterText=await externalAfter.text();expect(afterText).not.toContain('CLI_ARCHIVE_SHARED_TEXT');expect(externalAfter.status===401||afterText.includes('isError')).toBe(true);
  if(ending==='delete'){await expect(page.evaluate(()=>window.xiaokDesktop.previewCliArchive({sessionId:'cli_history_fixture',operationId:crypto.randomUUID()}))).rejects.toThrow();await page.evaluate(refId=>{location.hash=`#/context/${refId}`;},bound.refId);const deletedLanding=page.getByRole('complementary',{name:'历史引用'});await deletedLanding.getByRole('button',{name:'展开引用'}).click();await expect(deletedLanding.getByRole('alert')).toHaveText('引用不可读取、已删除或授权已撤销');await expect(deletedLanding.getByText('CLI_ARCHIVE_SHARED_TEXT',{exact:true})).toHaveCount(0);}
  expect(errors).toEqual([]);expect(JSON.stringify(calls)).not.toContain('CLI_PRIVATE_CANARY');writeFileSync(join(root,'result.json'),JSON.stringify({root,ending,sourceId,targetId:target.id,taskIds,sawResolver,sawNext,denied,calls:calls.length,errors,browser:'Browser plugin unavailable; actual Playwright Electron'},null,2));console.log('CLI_ARCHIVE_EVIDENCE='+root);
 }finally{await app?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));const remaining=pids.filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});writeFileSync(join(root,'reaped.json'),JSON.stringify({pids,remaining}));console.log('CLI_ARCHIVE_OWNED_PIDS='+JSON.stringify({root,pids,remaining}));expect(remaining).toEqual([]);}
});
