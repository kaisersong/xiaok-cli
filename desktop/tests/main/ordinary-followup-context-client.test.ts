// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readOrdinaryFollowupContext} from '../../electron/ordinary-followup-context-client.js';
const scope={profileId:'profile',workspaceId:'workspace'},digest='a'.repeat(64);
const dto=()=>({ok:true,protocol:'ordinary_project_followup_context_v1',classification:'ordinary',projectId:'project',projectRevision:3,projectStatus:'active',primaryRoomId:'room',scope:{...scope},bindingDigest:digest,canonicalCreateDigest:'b'.repeat(64),conversionActions:{add_task:{eligible:false,reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'},add_revision:{eligible:false,reasonCode:'REVISION_BASE_NOT_READY'}}});
function gateway(value:unknown=dto(),ok=true){return {getDesktopMutationToken:vi.fn(()=> 'private-main-token'),request:vi.fn(async()=>Response.json(value,{status:ok?200:409}))};}
it('reads only the fixed authenticated owner source endpoint with explicit schema and expected scope',async()=>{
 const g=gateway(),controller=new AbortController(),value=await readOrdinaryFollowupContext(g,'project',scope,controller.signal);
 expect(value).toEqual(dto());expect(g.request).toHaveBeenCalledOnce();expect(g.request).toHaveBeenCalledWith('/projects/project/followup-context',expect.objectContaining({method:'GET',signal:controller.signal,redirect:'error',headers:{'x-kswarm-mutation-token':'private-main-token'}}));
});
it('rejects untrusted provenance/scope/project/version and extensions rather than falling back to anonymous details',async()=>{
 for(const bad of [{...dto(),classification:'legacy_unverified'},{...dto(),scope:{...scope,workspaceId:'other'}},{...dto(),projectId:'other'},{...dto(),projectRevision:0},{...dto(),protocol:'future'},{...dto(),goal:'body leak'},{...dto(),conversionActions:{...dto().conversionActions,add_task:{eligible:true,reasonCode:'anything'}}}]){
  const g=gateway(bad);await expect(readOrdinaryFollowupContext(g,'project',scope,new AbortController().signal)).rejects.toThrow();expect(g.request).toHaveBeenCalledOnce();
 }
});
it('refuses missing token and aborted call before network, and never treats HTTP failure as a source fact',async()=>{
 const noToken=gateway();noToken.getDesktopMutationToken.mockReturnValue('');await expect(readOrdinaryFollowupContext(noToken,'project',scope,new AbortController().signal)).rejects.toThrow('mutation_credential_required');expect(noToken.request).not.toHaveBeenCalled();
 const g=gateway(),controller=new AbortController();controller.abort(Error('source_read_stopped'));await expect(readOrdinaryFollowupContext(g,'project',scope,controller.signal)).rejects.toThrow('source_read_stopped');expect(g.request).not.toHaveBeenCalled();
 const error=gateway({ok:false,error:'PROJECT_NOT_FOUND'},false);await expect(readOrdinaryFollowupContext(error,'project',scope,new AbortController().signal)).rejects.toThrow('PROJECT_NOT_FOUND');expect(error.request).toHaveBeenCalledOnce();
 const unknown=gateway({ok:true,...dto()},false);await expect(readOrdinaryFollowupContext(unknown,'project',scope,new AbortController().signal)).rejects.toThrow('room_conversion_project_source_unavailable');
});
