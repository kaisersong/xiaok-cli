import { randomUUID } from 'node:crypto';
import type { ProductObservationPolicy, describeProductObservationPolicy } from '../../src/runtime/sol-pi/product-bootstrap.js';
export type DesktopObservationPolicySummary = ReturnType<typeof describeProductObservationPolicy>;
export interface ApprovedDesktopObservation { readonly opaqueApprovedDesktopObservation: never }
const approved = new WeakMap<object, ProductObservationPolicy>();
export function consumeDesktopObservationApproval(capability: ApprovedDesktopObservation): ProductObservationPolicy {
  const policy = capability && approved.get(capability); if (!policy) throw new Error('observation_user_approval_required');
  approved.delete(capability); return policy;
}
/** Callbacks are installed by Electron main; no renderer boolean or source string is accepted. */
export function createDesktopObservationApprovals(options: {
  now?: () => number;
  selectPolicy(sender: object): Promise<{policy: ProductObservationPolicy;summary: DesktopObservationPolicySummary}|null>;
  confirm(sender: object, summary: DesktopObservationPolicySummary, kind:'persistence'|'disclosure'|'semantic'|'compound'): Promise<boolean>;
}) {
  const drafts = new Map<string,{sender:object;policy:ProductObservationPolicy;expires:number}>();
  const destroyed = new WeakSet<object>();
  const now=options.now??Date.now;
  return {
    async prepare(sender:object) {
      if(destroyed.has(sender))throw new Error('observation_sender_destroyed');
      const selected=await options.selectPolicy(sender);if(!selected)return null;
      const kinds: Array<'persistence'|'disclosure'|'semantic'|'compound'> = ['persistence','disclosure'];
      if(selected.summary.semanticCompaction)kinds.push('semantic');
      if(selected.summary.compoundExecution)kinds.push('compound');
      for(const kind of kinds) {
        if(destroyed.has(sender)||await options.confirm(sender,selected.summary,kind)!==true)return null;
      }
      if(destroyed.has(sender))throw new Error('observation_sender_destroyed');
      for(const [id,draft]of drafts)if(draft.sender===sender||draft.expires<=now())drafts.delete(id);
      const draftId=randomUUID();drafts.set(draftId,{sender,policy:selected.policy,expires:now()+300000});
      return {draftId,expiresAt:now()+300000,model:selected.summary.model};
    },
    consume(sender:object,draftId:string):ApprovedDesktopObservation {
      const draft=drafts.get(draftId);if(!draft||draft.expires<=now()||destroyed.has(sender)){drafts.delete(draftId);throw new Error('observation_draft_invalid');}
      if(draft.sender!==sender)throw new Error('observation_sender_mismatch');
      drafts.delete(draftId);const capability=Object.freeze(Object.create(null)) as ApprovedDesktopObservation;approved.set(capability,draft.policy);return capability;
    },
    destroySender(sender:object){destroyed.add(sender);for(const [id,draft]of drafts)if(draft.sender===sender)drafts.delete(id);},
  };
}
