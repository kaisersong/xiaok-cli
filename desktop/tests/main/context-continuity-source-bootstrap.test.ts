// @vitest-environment node
import {expect,it} from 'vitest';
import {contextDerivative} from '../fixtures/context-derivative.js';
import {assertOriginalDesktopCanonicalSourceDraft,assertOriginalDesktopCanonicalSourceDraftMetadataStage} from '../../electron/desktop-services.js';
import {assertOriginalCanonicalSourceDraft,assertOriginalCanonicalSourceMetadataStage,finishOriginalCanonicalSourceBootstrap,abortOriginalCanonicalSourceBootstrap} from '../../electron/context-continuity/sync-canonical-store-owner.js';
it('requires explicit original user source before source selection; agent/scheduler/missing/accessor/Proxy cannot register',async()=>{
 const f=await contextDerivative();try{let reads=0;const hostile=Object.defineProperty([],'0',{enumerable:true,get(){reads++;return 'caller';}}),getter=Object.defineProperty({},'requestSource',{enumerable:true,get(){reads++;return 'user';}});
 for(const source of [undefined,{requestSource:'agent'},{requestSource:'scheduler'},getter,new Proxy({requestSource:'user'},{}),{requestSource:'user',extra:1}])await expect(f.services.bootstrapCanonicalSource({}as never,hostile,source as never)).rejects.toThrow('canonical_source_bootstrap_request_denied');expect(reads).toBe(0);
 await expect(f.services.bootstrapCanonicalSource({}as never,hostile,{requestSource:'user'})).rejects.toThrow('canonical_runtime_source_unavailable');expect(reads).toBe(0);
 }finally{await f.close();}
});
it('keeps draft, metadata stage, post-COMMIT and registered capabilities private and exact-owner bound',async()=>{
 const f=await contextDerivative();try{const store=f.services.continuity.port().service.store,device={}as never;
 for(const proof of [{},new Proxy({},{}),{kind:'original-canonical-source-post-commit'}]){
 expect(()=>assertOriginalDesktopCanonicalSourceDraft(f.services,device,proof)).toThrow('canonical_runtime_source_draft_unavailable');
 expect(()=>assertOriginalCanonicalSourceDraft(store,device,proof)).toThrow();expect(()=>assertOriginalCanonicalSourceMetadataStage(store,device,f.services,proof,proof)).toThrow();
 expect(()=>assertOriginalDesktopCanonicalSourceDraftMetadataStage(store,f.services,device,proof,proof)).toThrow();expect(()=>finishOriginalCanonicalSourceBootstrap(store,device,f.services,proof,proof,proof)).toThrow();expect(()=>abortOriginalCanonicalSourceBootstrap(store,device,proof)).toThrow();
 }
 }finally{await f.close();}
});
