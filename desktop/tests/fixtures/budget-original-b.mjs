import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileFunction,constants} from 'node:vm';
// Native Node ESM loader, including the actual SDK startup Root's TLA.
const load=compileFunction('return import(specifier)',['specifier'],{importModuleDynamically:constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
export async function originalBudgetB(scope,thread,budgetSource,{admission=false}={}) {
    const base=new URL('../../../../kswarm/src/core/',import.meta.url),module=name=>load(new URL(name,base).href);
    const [{createHub},{createSqlitePersistence},{createProjectInputAuthority},{protocolDigest},controlData,business]=await Promise.all([module('hub.js'),module('sqlite-persistence.js'),module('project-input-authority.js'),module('project-protocol.js'),module('dsh-scope-control-data.js'),module('dsh-owner-data.js')]);
    const root=mkdtempSync(join(tmpdir(),'budget-actual-b-')),filePath=join(root,'state.sqlite'),frames=new WeakMap(),imported=new Map(),effects=[];
    const source={resolve(proof,purpose){const row=frames.get(proof);if(!row||row.purpose!==purpose)throw Error('FIXTURE_ORIGINAL_B_FRAME_REQUIRED');return {data:row.data,budgetProof:row.budgetProof??null,assertCurrent(){}};}};
    const issue=(purpose,data,budgetProof)=>{const proof=Object.freeze(Object.create(null));frames.set(proof,{purpose,data,budgetProof});return proof;};
    const backend=createSqlitePersistence({filePath}),hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath},persistence:backend,dshBusinessSource:source,dshBudgetSource:budgetSource,bridge:{requestTask(input){effects.push(input);throw Error('FIXTURE_NO_EXECUTION');}}});
    const authority=createProjectInputAuthority(scope),control={requestSource:'user',projectInputAuthority:authority.reader()};
    function checked(result){if(!result.ok)throw Error('ACTUAL_B_'+JSON.stringify(result));return result;}
    checked(admission?hub.prepareDshAdmissionOwnerWriter(control):hub.prepareDshOwnerWriter(control));
    const chain=controlData.dshScopeChain(scope,thread,'mandate'),authScope={tenantId:thread.tenantId,workspaceId:thread.workspaceId,connectionId:'connection',providerAccountId:'github-user',repositoryId:thread.repositoryId,credentialEpoch:1};
    function policy(identity,axis,value) {const result=checked(hub.applyDshScopeFence(issue('control',{scope,type:'policy',identity,axis,epoch:1,value,authorityRef:'controlled-fixture-source'}),{requestSource:'scheduler'}));imported.set(result.control.id,result.control);}
    function leaf(identity,factKind,value) {const result=checked(hub.applyDshScopeFence(issue('control',{scope,type:'leaf',identity,factKind,epoch:1,value,authorityRef:'controlled-fixture-source'}),{requestSource:'scheduler'}));imported.set(result.control.id,result.control);}
    for(const cell of chain)for(const axis of controlData.DSH_POLICY_AXES)policy(cell.identity,axis,axis==='mode'?{mode:'auto_draft'}:{allowed:true,restriction:null});
    const ownerDomains=[{domainId:'fixture-b',kind:'work'},{domainId:'fixture-egress',kind:'egress_gate'},{domainId:'fixture-pointer',kind:'active_pointer'}];
    leaf(chain[3].identity,'source_auth',{authScope,sourceBindingVersion:1,roleMappingVersion:1,provenanceVersion:1,status:'active',attestationRef:'fixture-source-auth'});
    leaf(chain[4].identity,'mandate',{schemaVersion:1,mandateId:'mandate',sourceBindingId:thread.sourceBindingId,revision:1,authorizationEpoch:1,status:'active',issuedByUserId:'fixture-user',allowedActorProviderIds:['github-user'],allowedActions:['source.read','model.process_source','local.draft.create','local.draft.revise'],ruleVersion:'github_issue_draft_v1',selection:{issueIds:[thread.threadId]},validUntil:'2100-01-01T00:00:00.000Z',maxInputBytes:1000000,budgetRef:'account',limits:{maxActiveWorks:1,maxDraftRunsPerWork:2,maxTokens:5000,maxCostMinor:5000,currency:'USD',executionDeadline:'2100-01-01T00:00:00.000Z'},dataEgressPolicyRef:'egress',ownerDomains,ownerDomainsHash:protocolDigest(['dsh-owner-domains-v1',ownerDomains]),followup:{enabled:false,observationEndsAt:'2100-01-01T00:00:00.000Z',completionPredicate:'draft_ready',resumeAfterCompletion:false}});
    leaf(chain[4].identity,'egress',{policyRef:'egress',policyHash:'e'.repeat(64),provider:'model-provider',destinationRef:'model-destination',purposes:['draft'],enabled:true});
    leaf(chain[4].identity,'readonly',{executionProfile:'model_text_only_v1',schemaVersion:1,snapshotHash:null,snapshotPolicyDigest:null,approvalRef:null});
    function command(reservationId='not-yet-funded',overrides={}) {
        const input={inputId:'input-1',sourceObjectId:'issue-123',sourceRevision:'r1',contentHash:'1'.repeat(64),provenanceHash:'2'.repeat(64),objectKind:'issue',provenanceVersion:1,actorMappingVersion:1,snapshotRef:'snapshot-input-1'};
        const data={scope,thread,authScope,schemaVersion:1,commandId:'controlled-original-command',bindingId:'binding',generation:1,ownerKind:'kswarm_dsh',mandateId:'mandate',mandateRevision:1,authorizationEpoch:1,action:'create_draft_work',purpose:'draft',inputId:input.inputId,input,canonical:{inputId:input.inputId,createManifestHash:'3'.repeat(64)},targetWorkId:null,expectedOwnerVersion:null,targetFenceEpoch:null,dispatchPolicy:'draft_only_no_business_dispatch',assessmentRef:'assessment',assessmentHash:'4'.repeat(64),admissionWindowRef:'window',freshnessAttestationRef:'freshness',evidenceManifestHash:'5'.repeat(64),budgetReservationRef:reservationId,authorityValidUntil:'2100-01-01T00:00:00.000Z',executionDeadline:'2100-01-01T00:00:00.000Z',executionProfile:'model_text_only_v1'};
        const modes=[],policies=[],leaves=[];
        for(const cell of chain)for(const axis of controlData.DSH_POLICY_AXES){const row=imported.get(controlData.dshPolicyId(cell.scopeKey,axis));policies.push({scopeKey:cell.scopeKey,axis,epoch:row.epoch,canonicalHash:row.canonicalHash,controlRevision:row.revision});if(axis==='mode')modes.push({scopeKey:cell.scopeKey,epoch:row.epoch});}
        for(const kind of ['source_auth','mandate','egress','readonly']){const cell=chain[kind==='source_auth'?3:4],id=controlData.dshLeafId(cell.scopeKey,kind),row=imported.get(id);leaves.push({id,epoch:row.epoch,canonicalHash:row.canonicalHash,controlRevision:row.revision});}
        Object.assign(data,overrides);if(admission){data.schemaVersion=2;if(!Object.hasOwn(data,'workGuard'))data.workGuard=null;}
        data.modeGuards=modes;data.controlGuards={policies,leaves};
        const manifest=business.dshEvidenceManifest(thread,[{inputId:input.inputId,objectKind:input.objectKind,objectId:input.sourceObjectId,revision:input.sourceRevision,contentHash:input.contentHash,provenanceVersion:1,actorEvidenceHash:input.provenanceHash,actorMappingVersion:1}],'2026-01-01T00:00:00.000Z');
        data.evidence={manifest,attestationRef:'evidence-attestation'};data.evidenceManifestHash=manifest.manifestHash;data.egressGuard={policyRef:'egress',epoch:1,policyHash:'e'.repeat(64)};
        data.freshness={window:{windowId:'window',sourceBindingId:thread.sourceBindingId,prefixModeGuardsHash:protocolDigest(modes),admissionGrantHash:'7'.repeat(64),effectiveAt:'2026-01-01T00:00:00.000Z',baselineCheckpointRef:'baseline',providerTimeBasisProofRef:'provider-time',freshnessPolicyVersion:1},eventTimeEvidenceRef:'event-time',attestationRef:'freshness'};
        return {...data,...business.dshCommandIdentity(data)};
    }
    return {hub,command,effects,issue,module,apply:(data,proof)=>hub.applyDshOwnerCommand(issue('effect',data,proof),{requestSource:'scheduler'}),close(){hub.closePersistence();rmSync(root,{recursive:true,force:true});}};
}
