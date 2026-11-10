import {definitivePolicyDenial,isDefinitivePolicyDenial,ContinuityPolicyUnavailable} from '../../../src/runtime/context-continuity/policy-denial.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { ContinuityStore, digest, key } from './store.js';

/** A read-only credential is independent of execution tasks and cannot impersonate the user. */
export interface ExternalReferencePrincipal {
  kind: 'external_reader';
  credentialId: string;
  profileId: string;
  targetConversationId: string;
}
export interface IssueExternalReaderInput { operationId: string; targetConversationId: string; refIds: string[] }
export class ExternalReaderPolicy {
  constructor(private readonly store: ContinuityStore, private readonly assertScope: (id: string) => void,
    private readonly assertTask: (id: string) => void,private readonly mutationScope:(id:string)=>void=assertScope,private readonly mutationTask:(id:string)=>void=assertTask) {}
  issue(input: IssueExternalReaderInput): { credentialId: string; secret: string } {
    key(input.operationId);key(input.targetConversationId);
    if (!Array.isArray(input.refIds) || !input.refIds.length || input.refIds.length > 20 || new Set(input.refIds).size !== input.refIds.length) throw new Error('invalid_argument');
    input.refIds.forEach(key);
    return this.store.transaction(() => {
      if (this.store.existingOperation('issueExternalReader', input.operationId, input)) throw new Error('secret_already_issued');
      const db=this.store.db,target=this.policy(input.targetConversationId,true),credentialId=randomUUID(),secret=randomBytes(32).toString('base64url');
      const refs=input.refIds.map(refId=>{
        const ref=db.prepare('SELECT conversation_id FROM context_refs WHERE id=?').get(refId);if(!ref)throw definitivePolicyDenial();
        const sourcePolicy=this.policy(String(ref.conversation_id),true);
        const grant=db.prepare('SELECT id,revision FROM read_grants WHERE ref_id=? AND target_conversation=? AND revoked=0').get(refId,input.targetConversationId);
        if(!grant)throw definitivePolicyDenial();return {refId,grantId:String(grant.id),revision:Number(grant.revision),sourcePolicy};
      });
      db.prepare('INSERT INTO external_readers VALUES (?,?,?,?,?,0)').run(credentialId,digest(secret),input.targetConversationId,target,Date.now());
      const insert=db.prepare('INSERT INTO external_reader_refs VALUES (?,?,?,?,?)');
      for(const ref of refs)insert.run(credentialId,ref.refId,ref.grantId,ref.revision,ref.sourcePolicy);
      // The one-time bearer is deliberately absent from the operation journal and every durable result.
      this.store.operation('issueExternalReader',input.operationId,input,()=>({credentialId}));
      return {credentialId,secret};
    });
  }
  private policy(id:string,mutation=false):number {
    (mutation?this.mutationScope:this.assertScope)(id);const row=this.store.db.prepare('SELECT policy_revision FROM conversations WHERE id=? AND deleted=0').get(id);
    if(!row)throw definitivePolicyDenial();return Number(row.policy_revision);
  }
  authenticate(secret:string):ExternalReferencePrincipal {
    if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(secret))throw definitivePolicyDenial();
    const row=this.store.db.prepare('SELECT id,target_conversation FROM external_readers WHERE secret_hash=? AND revoked=0').get(digest(secret));
    if(!row)throw definitivePolicyDenial();
    const principal:ExternalReferencePrincipal={kind:'external_reader',credentialId:String(row.id),profileId:this.store.profileId,targetConversationId:String(row.target_conversation)};
    this.assert(principal);return principal;
  }
  assert(principal:ExternalReferencePrincipal):void{this.assertUsing(principal,false);}
  private assertUsing(principal:ExternalReferencePrincipal,mutation:boolean):void {
    const db=this.store.db,row=db.prepare('SELECT * FROM external_readers WHERE id=? AND revoked=0').get(principal.credentialId);
    if(principal.kind!=='external_reader'||principal.profileId!==this.store.profileId||!row||row.target_conversation!==principal.targetConversationId)throw definitivePolicyDenial();
    try{
      if(this.policy(String(row.target_conversation),mutation)!==row.target_policy)throw definitivePolicyDenial();
      const refs=db.prepare('SELECT x.*,r.conversation_id,g.revoked,g.revision,g.target_conversation,g.ref_id AS granted_ref FROM external_reader_refs x JOIN context_refs r ON r.id=x.ref_id LEFT JOIN read_grants g ON g.id=x.grant_id WHERE x.credential_id=?').all(principal.credentialId);
      if(!refs.length)throw definitivePolicyDenial();
      for(const ref of refs){
        if(ref.revoked!==0||ref.revision!==ref.grant_revision||ref.target_conversation!==row.target_conversation||ref.granted_ref!==ref.ref_id||this.policy(String(ref.conversation_id),mutation)!==ref.source_policy)throw definitivePolicyDenial();
        if(db.prepare('SELECT 1 FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=? AND a.deleted=1 LIMIT 1').get(String(ref.ref_id)))throw definitivePolicyDenial();
      }
      for(const dependency of db.prepare('SELECT ref_id,valid FROM external_reader_dependencies WHERE credential_id=?').all(principal.credentialId)){
        if(!dependency.valid)throw definitivePolicyDenial();
        for(const source of db.prepare('SELECT DISTINCT a.source_id FROM context_ref_entries e JOIN message_anchors a ON a.id=e.message_id WHERE e.ref_id=?').all(String(dependency.ref_id)))(mutation?this.mutationTask:this.assertTask)(String(source.source_id));
      }
    }catch(error){
      if(isDefinitivePolicyDenial(error)){
        this.store.policyMutation(()=>{
          db.prepare('UPDATE external_readers SET revoked=1 WHERE id=?').run(principal.credentialId);
          db.prepare('UPDATE external_reader_dependencies SET valid=0 WHERE credential_id=?').run(principal.credentialId);
        });
        throw error;
      }
      if(error instanceof ContinuityPolicyUnavailable)throw error;
      throw new ContinuityPolicyUnavailable('external_source_proof_unavailable',{cause:error});
    }
  }
  access(principal:ExternalReferencePrincipal,refId:string):string{return this.accessUsing(principal,refId,false);}
  private accessUsing(principal:ExternalReferencePrincipal,refId:string,mutation:boolean):string {
    this.assertUsing(principal,mutation);
    const row=this.store.db.prepare('SELECT grant_id,grant_revision,source_policy FROM external_reader_refs WHERE credential_id=? AND ref_id=?').get(principal.credentialId,refId);
    if(!row)throw definitivePolicyDenial();return `${principal.credentialId}:${row.grant_id}:${row.grant_revision}:${row.source_policy}`;
  }
  record(principal:ExternalReferencePrincipal,refId:string):void {
    this.store.policyMutation(()=>{
      this.accessUsing(principal,refId,true);
      this.store.db.prepare('INSERT OR IGNORE INTO external_reader_dependencies VALUES (?,?,1)').run(principal.credentialId,refId);
    });
  }
  revoke(credentialId:string):void {key(credentialId);this.store.policyMutation(()=>{if(!this.store.db.prepare('UPDATE external_readers SET revoked=1 WHERE id=?').run(credentialId).changes)throw definitivePolicyDenial();});}
  list():Array<{credentialId:string;targetConversationId:string;refIds:string[];revoked:boolean}> {
    for(const row of this.store.db.prepare('SELECT id,target_conversation FROM external_readers WHERE revoked=0').all()){
      try{this.assert({kind:'external_reader',credentialId:String(row.id),profileId:this.store.profileId,targetConversationId:String(row.target_conversation)});}
      catch(error){if(!(error instanceof Error)||error.message!=='not_readable')throw error;}
    }
    return this.store.db.prepare('SELECT id,target_conversation,revoked FROM external_readers ORDER BY created_at DESC').all().map(row=>({credentialId:String(row.id),targetConversationId:String(row.target_conversation),revoked:!!row.revoked,
      refIds:this.store.db.prepare('SELECT ref_id FROM external_reader_refs WHERE credential_id=? ORDER BY ref_id').all(String(row.id)).map(ref=>String(ref.ref_id))}));
  }
}
