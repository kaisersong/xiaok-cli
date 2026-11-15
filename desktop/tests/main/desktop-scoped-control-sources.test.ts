import {it,expect,vi} from 'vitest';
const calls=vi.hoisted(()=>({prepare:vi.fn(),owner:vi.fn(),dispatch:vi.fn(),writer:vi.fn()}));
vi.mock('../../electron/default-dispatch-preparation-native-source.js',()=>({createDefaultDispatchPreparationNativeSource:calls.prepare}));
vi.mock('../../electron/default-dispatch-preparation-owner.js',()=>({createDefaultDispatchPreparationOwner:calls.owner}));
vi.mock('../../electron/default-dispatch-business-controller.js',()=>({createDefaultDispatchBusinessController:calls.dispatch}));
vi.mock('../../electron/kswarm-writer-control-source.js',()=>({createKSwarmWriterControlSource:calls.writer}));
import {createDesktopScopedControlSources,desktopScopedKSwarmOptions} from '../../electron/desktop-scoped-control-sources.js';
it('unavailable creates no sources, reads no scope, and passes no scope or admission to KSwarm',()=>{
 const getScope=vi.fn(()=>{throw Error('scope must not be allocated');});const registerIngress=vi.fn(),registerFinalStep=vi.fn();
 const sources=createDesktopScopedControlSources({identity:{scope:'unavailable'},window:{} as never,getWindow:()=>null,getScope,isTrustedUrl:()=>false,registerIngress,registerFinalStep});
 expect(sources).toBeUndefined();expect(desktopScopedKSwarmOptions(sources)).toEqual({});expect(getScope).not.toHaveBeenCalled();expect(registerIngress).not.toHaveBeenCalled();expect(registerFinalStep).not.toHaveBeenCalled();for(const factory of Object.values(calls))expect(factory).not.toHaveBeenCalled();
});
it.each(['continuity','legacy'] as const)('retains source ownership and scope for %s identity',scope=>{
 const events:string[]=[],preparation={ingress:{},drain:vi.fn(),transportSource:{},transportAdmission:vi.fn()},dispatch={ingress:{},drain:vi.fn(),businessAdmission:vi.fn()},writer={admission:vi.fn()};
 calls.prepare.mockImplementation(()=>{events.push('prepare');return {};});calls.owner.mockReturnValue(preparation);calls.dispatch.mockImplementation(()=>{events.push('dispatch');return dispatch;});calls.writer.mockImplementation(()=>{events.push('writer');return writer;});
 const getScope=vi.fn(()=>({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)}));const sources=createDesktopScopedControlSources({identity:{scope},window:{} as never,getWindow:()=>null,getScope,isTrustedUrl:()=>true,registerIngress:()=>events.push('ingress'),registerFinalStep:()=>events.push('lifetime')});
 expect(getScope).toHaveBeenCalledOnce();expect(events).toEqual(['prepare','ingress','lifetime','dispatch','ingress','lifetime','writer']);
 expect(desktopScopedKSwarmOptions(sources)).toEqual({desktopProjectScope:getScope.mock.results[0]!.value,ownedControlAdmission:writer.admission,ownedBusinessAdmission:dispatch.businessAdmission,ownedPreparationSource:preparation.transportSource,ownedPreparationAdmission:preparation.transportAdmission});
});
