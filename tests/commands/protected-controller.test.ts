import {it,expect,vi} from 'vitest';
import {Command} from 'commander';
const f=vi.hoisted(()=>({opens:0,closes:0,calls:[] as unknown[],reply:undefined as unknown}));
vi.mock('../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient(){f.opens++;return{maintenanceTransport:{async call(method:string,payload:unknown){f.calls.push({method,payload});return f.reply;}},dispose(){f.closes++;}};}}));
import {diagnoseProtectedController,registerProtectedControllerCommands} from '../../src/commands/protected-controller.js';
it('uses the actual explicit Commander diagnosis path with bounded metadata only',async()=>{
 f.calls=[];f.reply={mode:'maintenance',items:[{resourceId:'r',kind:'guest-output',state:'reserved',mapping:'unmapped',reason:'capacity_mapping_missing'}],nextCursor:null,unmappedInventoryPresent:true};
 const command=new Command(),log=vi.spyOn(console,'log').mockImplementation(()=>{}),before=f.closes;
 try{registerProtectedControllerCommands(command);await command.parseAsync(['node','xiaok','protected-controller','diagnose','--owner-kind','task','--owner-id','task','--limit','16']);expect(f.calls).toEqual([{method:'maintenance.diagnose',payload:{requestSource:'user',ownerKind:'task',ownerId:'task',cursor:null,limit:16}}]);expect(JSON.parse(log.mock.calls[0][0])).toEqual(f.reply);expect(f.closes).toBe(before+1);}finally{log.mockRestore();}
});
it('rejects nonuser requests before opening a fixed client and rejects extended metadata',async()=>{
 const request={requestSource:'user' as const,ownerKind:'task' as const,ownerId:'task',cursor:null,limit:16},before=f.opens;
 await expect(diagnoseProtectedController({...request,requestSource:'agent'},new AbortController().signal)).rejects.toThrow('maintenance_request');expect(f.opens).toBe(before);
 f.reply={mode:'maintenance',items:[],nextCursor:null,unmappedInventoryPresent:false,privatePath:'/private/body'};
 await expect(diagnoseProtectedController(request,new AbortController().signal)).rejects.toThrow('maintenance_response');
});
