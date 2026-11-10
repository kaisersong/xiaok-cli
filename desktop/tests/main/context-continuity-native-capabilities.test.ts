// @vitest-environment node
import { afterEach,expect,it } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionProbe } from '../../electron/codex-native-transport.js';
const roots:string[]=[];afterEach(()=>{roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));});
const safeFeatures={apps:false,multi_agent:false,goals:false,hooks:false,memories:false,remote_plugin:false};
async function probe(config:unknown,inventory:unknown={data:[],nextCursor:null},plugins:unknown={marketplaces:[],marketplaceLoadErrors:[]}){
 const root=mkdtempSync(join(tmpdir(),'native-capability-parser-'));roots.push(root);
 writeFileSync(join(root,'responses.json'),JSON.stringify({config,inventory,plugins}));
 writeFileSync(join(root,'protocol.mjs'),`import {createInterface} from 'node:readline';import {readFileSync} from 'node:fs';const r=JSON.parse(readFileSync(process.argv[2],'utf8'));for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.id===undefined)continue;const result=m.method==='config/read'?{config:r.config}:m.method==='mcpServerStatus/list'?r.inventory:m.method==='plugin/list'?r.plugins:m.method==='thread/start'?{thread:{id:'thread'}}:{};process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');}`);
 const p=new SessionProbe({executable:process.execPath,prefixArgs:[join(root,'protocol.mjs'),join(root,'responses.json')],cwd:root,timeoutMs:1000});await p.connect();return p;
}
it.each([{},null,[],{features:[]},{features:{apps:'false'}},{features:safeFeatures,apps:[]},{features:safeFeatures,apps:{_default:{enabled:'false'}}},{features:safeFeatures,mcp_servers:{server:{}}},{features:safeFeatures,plugins:{plugin:{enabled:true}}}])('refuses an unknown/default-enabled external tool configuration through real transport IO (%j)',async config=>{
 const p=await probe(config);try{await expect(p.assertNoExternalTools()).rejects.toThrow(/native_(capabilities_unknown|external_tools_unsupported)/);}finally{await p.close();}
});
it('requires an empty exact thread inventory and rejects unknown pagination or enabled plugins',async()=>{
 for(const inventory of [{data:[{name:'context'}],nextCursor:null},{data:[]},{data:[],nextCursor:'more'}]){
  const p=await probe({features:safeFeatures},inventory);try{await p.create();await expect(p.assertNoExternalTools()).rejects.toThrow('native_external_tools_unsupported');}finally{await p.close();}
 }
 const p=await probe({features:safeFeatures},undefined,{marketplaces:[{plugins:[{enabled:true,installed:true}]}],marketplaceLoadErrors:[]});
 try{await expect(p.assertNoExternalTools()).rejects.toThrow('native_external_tools_unsupported');}finally{await p.close();}
});
it('qualifies only explicitly disabled apps, no enabled plugins, and an empty thread-scoped MCP inventory',async()=>{
 const p=await probe({features:safeFeatures,apps:{_default:{enabled:false}},mcp_servers:{disabled:{enabled:false}},plugins:{disabled:{enabled:false}}});
 try{await p.assertNoExternalTools();await p.create();await expect(p.assertNoExternalTools()).resolves.toBeUndefined();}finally{await p.close();}
});
it.each(['multi_agent','goals','hooks','memories','remote_plugin'])('rejects unmanaged autonomous capability %s even without MCP/apps/plugins',async feature=>{
 const p=await probe({features:{...safeFeatures,[feature]:true}});
 try{await expect(p.assertNoExternalTools()).rejects.toThrow('native_capabilities_unknown');}finally{await p.close();}
});
