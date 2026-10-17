import {assertInstalledStackCapacityComponent} from './installed-execution-stack.js';
import {readBlobCapacityIssuer} from './blob-capacity-issuer.js';
import {readInstalledCapacityAuthority,assertInstalledCapacityAuthorityLifetime,claimInstalledCapacityLayer,finishInstalledSharedCapacityLayer,failInstalledCapacityLayer} from './installed-controller.js';
import {readMaintenanceExecution,assertMaintenanceProbeDeleted} from './maintenance-execution.js';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {createSharedBlobCapacity} from './shared-blob-capacity.js';
import {createAuthorityBlobBudget} from './authority-blob-budget.js';
import {assertControllerMaterialPipelineDatabase,assertMaterialPipelineDeleted} from './material-pipeline.js';
import {assertDockerRunnerDatabase,assertDockerRunnerDeleted} from '../isolated-execution/docker-runner.js';
import {assertExecutionTranscriptStoreDatabase,assertExecutionTranscriptDeleted} from './execution-transcripts.js';
import {assertProtectedRunLedgerDatabase,assertProtectedRunDeleted} from './protected-run-ledger.js';
import {assertInstalledEngineQualificationIdentity,assertInstalledQualificationDeleted} from './installed-engine-qualification.js';
import type {initializeInstalledMacEngine} from './installed-engine.js';
import type {BlobReservationProposal} from './blob-budget.js';
type Slot='qualification'|'materials'|'execution'|'transcripts'|'runs'|'maintenance-probe';
type Entry={authority:object;database:import('better-sqlite3').Database;current():void;slots:Map<Slot,{component:object}>};
const owners=new WeakMap<object,Entry>(),authorityEntries=new WeakMap<object,Entry>();
export function assertInstalledCapacityDeleted(authority:object,proof:object,proposal:Readonly<BlobReservationProposal>):void{
 const entry=authorityEntries.get(authority);if(!entry)throw Error('capacity_authority_configuration');entry.current();const mapping=readBlobCapacityIssuer(entry.database,proposal);
 const slot:Slot=mapping.issuerKind==='material'?'materials':mapping.issuerKind==='raw'?'execution':mapping.issuerKind==='transcript'?'transcripts':mapping.issuerKind==='run'?'runs':mapping.issuerKind==='qualification-probe'||mapping.issuerKind==='qualification-mounted'?(entry.slots.has('qualification')?'qualification':mapping.issuerKind==='qualification-mounted'?'execution':'maintenance-probe'):(()=>{throw Error('installed_capacity_deletion_unavailable');})();
 const issuer=entry.slots.get(slot);if(!issuer)throw Error('installed_capacity_deletion_unknown');
 switch(slot){case 'materials':assertMaterialPipelineDeleted(issuer.component,entry.database,proof,proposal);break;case 'execution':assertDockerRunnerDeleted(issuer.component,entry.database,proof,proposal);break;case 'transcripts':assertExecutionTranscriptDeleted(issuer.component,entry.database,proof,proposal);break;case 'runs':assertProtectedRunDeleted(issuer.component,entry.database,proof,proposal);break;case 'qualification':assertInstalledQualificationDeleted(issuer.component,entry.database,proof,proposal,mapping.issuerKind==='qualification-mounted'?'mounted':'probe');break;case 'maintenance-probe':assertMaintenanceProbeDeleted(issuer.component,entry.database,proof,proposal);break;}
 entry.current();readBlobCapacityIssuer(entry.database,proposal);
}
export function assertInstalledSharedCapacityAuthority(owner:object,authority:object):void{const entry=owners.get(owner);if(!entry||entry.authority!==authority)throw Error('installed_capacity_identity');entry.current();}
/** Only missing original mapping facts are recoverable here. Conflicting tuples,
 * authority identities and database/schema failures are not maintenance mode. */
export function isCapacityMappingNotReady(error:unknown):boolean{return error instanceof Error&&new Set(['shared_blob_migration_staging_missing','shared_blob_migration_registration_missing','shared_blob_migration_case_missing','shared_blob_migration_execution_missing']).has(error.message);}
export function assertInstalledSharedCapacity(owner:object,lifetime:InstalledControllerLifetime,requireUnused=false){const e=owners.get(owner);if(!e)throw Error('installed_capacity_identity');assertInstalledCapacityAuthorityLifetime(e.authority,lifetime);e.current();if(requireUnused&&e.slots.size)throw Error('installed_capacity_in_use');}
export function registerInstalledCapacityIssuer(owner:object,slot:Slot,component:object,engine?:Awaited<ReturnType<typeof initializeInstalledMacEngine>>,construction?:object){
 if(!construction)throw Error('installed_capacity_construction');assertInstalledStackCapacityComponent(construction,owner,slot,component,engine);
 const entry=owners.get(owner);if(!entry)throw Error('installed_capacity_identity');entry.current();const db=entry.database;
 if(slot==='qualification'){if(!engine)throw Error('installed_capacity_engine');assertInstalledEngineQualificationIdentity(component,engine,db);}else if(slot==='materials')assertControllerMaterialPipelineDatabase(component,db);else if(slot==='execution')assertDockerRunnerDatabase(component,db);else if(slot==='transcripts')assertExecutionTranscriptStoreDatabase(component,db);else if(slot==='runs')assertProtectedRunLedgerDatabase(component,db);else if(slot==='maintenance-probe')readMaintenanceExecution(component,db);else throw Error('installed_capacity_slot');
 const old=entry.slots.get(slot);if(old){if(old.component!==component)throw Error('installed_capacity_issuer_replaced');return;}
 entry.slots.set(slot,{component});
}
export function createInstalledSharedCapacity(authority:object){
 if(arguments.length!==1)throw Error('capacity_authority_configuration');const {database:db,authorityId}=claimInstalledCapacityLayer(authority,'installed-owner');const slots:Entry['slots']=new Map();let closed=false;
 function current(){if(closed)throw Error('installed_capacity_closed');const actual=readInstalledCapacityAuthority(authority);if(actual.database!==db||actual.authorityId!==authorityId)throw Error('installed_capacity_identity');}
 try{
 authorityEntries.set(authority,{authority,database:db,current,slots});

 const capacity=createSharedBlobCapacity(authority);let budget:ReturnType<typeof createAuthorityBlobBudget>;try{budget=createAuthorityBlobBudget(authority);}catch(error){capacity.close();throw error;}
 const owner=Object.freeze({capacity,budget,close(){if(closed)return;budget.close();capacity.close();closed=true;slots.clear();}});owners.set(owner,{authority,database:db,current,slots});finishInstalledSharedCapacityLayer(authority,owner);return owner;
 }catch(error){failInstalledCapacityLayer(authority,'installed-owner');throw error;}
}
