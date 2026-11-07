// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { registerEnterpriseCliIpc } from '../../electron/enterprise-cli-typed-ipc.js';
function fixture() {
 const handlers = new Map<string, Function>();
 const services = Object.fromEntries(['dingtalk','feishu','wecom'].map(provider => [provider,{getState:vi.fn(()=>({provider,phase:'notInstalled',revision:0,installed:false})),control:vi.fn(async()=>({provider,phase:'installing',revision:1,installed:false}))}]));
 registerEnterpriseCliIpc({handle:(channel,fn)=>handlers.set(channel,fn)},services as any,event=>(event as any).trusted===true);return {handlers,services};
}
describe('enterprise CLI semantic IPC',()=>{
 it('lists fixed providers and derives user source for install',async()=>{const f=fixture();expect(await f.handlers.get('desktop:getEnterpriseCliConnectors')!({trusted:true})).toHaveLength(3);await f.handlers.get('desktop:controlEnterpriseCliConnector')!({trusted:true},'dingtalk','install');expect(f.services.dingtalk.control).toHaveBeenCalledWith('install','user');});
 it('rejects foreign senders, provider injection, commands and extra credentials',async()=>{const f=fixture();const handler=f.handlers.get('desktop:controlEnterpriseCliConnector')!;await expect(handler({trusted:false},'dingtalk','install')).rejects.toThrow();for(const args of [['other','install'],['__proto__','login'],['feishu','shell'],['wecom','login',{secret:'secret'}]])await expect(handler({trusted:true},...args)).rejects.toThrow();for(const service of Object.values(f.services))expect(service.control).not.toHaveBeenCalled();});
 it('rejects nested secret-bearing status before crossing IPC',async()=>{const f=fixture();f.services.feishu.getState.mockReturnValue({provider:'feishu',phase:'connected',revision:1,installed:true,connection:{identityType:'user',checkedAt:'2026-11-05T08:00:00Z',accessToken:'secret'}} as any);await expect(f.handlers.get('desktop:getEnterpriseCliConnectors')!({trusted:true})).rejects.toThrow();});
});
