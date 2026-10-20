import {claimInstalledMaintenanceMaterialsConstruction,bindInstalledMaintenanceMaterialsConstruction,assertInstalledMaintenanceConstructionReady} from './installed-execution-stack.js';
import {join} from 'node:path';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertInstalledRootBrokerClient,type createInstalledRootBrokerClient} from './root-broker-client.js';
import {assertInstalledSharedCapacity,registerInstalledCapacityIssuer,type createInstalledSharedCapacity} from './installed-shared-capacity.js';
import {readMaintenanceEngineAttachment,type MaintenanceEngineAttachment} from './maintenance-engine-attachment.js';
import {readMaintenanceExecution,type createInstalledMaintenanceExecution} from './maintenance-execution.js';
import {createControllerMaterialPipeline} from './material-pipeline.js';
import {createStagingFactualCleanup} from './staging-factual-cleanup.js';
/** Host-only recovery of the original staging copy. No material authorization,
 * stage/read input, normal quiescence, or execution port escapes this facade. */
const constructions=new WeakMap<object,{construction:object;database:import('better-sqlite3').Database;materials:object;activate():void}>();
export function assertMaintenanceStagingConstruction(value:object,materials:object,construction:object,database:import('better-sqlite3').Database):void{const known=constructions.get(value);if(!known||known.construction!==construction||known.materials!==materials||known.database!==database)throw Error('maintenance_staging_identity');}
export function activateInstalledMaintenanceStaging(value:object,construction:object):void{const known=constructions.get(value);if(!known||known.construction!==construction)throw Error('maintenance_staging_identity');assertInstalledMaintenanceConstructionReady(construction);known.activate();}
export function createInstalledMaintenanceStaging(input:{lifetime:InstalledControllerLifetime;broker:ReturnType<typeof createInstalledRootBrokerClient>;sharedCapacity:ReturnType<typeof createInstalledSharedCapacity>;attachment:MaintenanceEngineAttachment;execution:ReturnType<typeof createInstalledMaintenanceExecution>;construction?:object}){
 const {lifetime,sharedCapacity,construction}=input;if(!construction)throw Error('installed_capacity_construction');claimInstalledMaintenanceMaterialsConstruction(construction,lifetime,sharedCapacity);const {broker,attachment,execution}=input;assertInstalledControllerLifetime(lifetime);assertInstalledRootBrokerClient(broker,lifetime);assertInstalledSharedCapacity(sharedCapacity,lifetime);const db=lifetime.database,facts=readMaintenanceEngineAttachment(attachment,lifetime);let closed=false,cleanup:ReturnType<typeof createStagingFactualCleanup>|undefined,closing:Promise<void>|undefined;
 function current(){if(closed)throw Error('maintenance_staging_closed');assertInstalledControllerLifetime(lifetime);assertInstalledSharedCapacity(sharedCapacity,lifetime);readMaintenanceEngineAttachment(attachment,lifetime);}
 function active(){current();if(!cleanup)throw Error('maintenance_staging_inactive');return cleanup;}
 const materials=createControllerMaterialPipeline({root:join(lifetime.state,'staging'),database:db,budget:sharedCapacity.budget,engineBinding:{engineId:facts.engineBinding.engineId,incarnation:facts.engineBinding.incarnation},broker,assertCurrent:current,assertCleanup(id){active().assertCleanup(id);},resolveOwnerKey(){throw Error('maintenance_material_admission_disabled');},createCapacityOwnerBinding(){throw Error('maintenance_material_admission_disabled');}});
 const result=Object.freeze({cleanupResource(resourceId:string,signal?:AbortSignal){return active().cleanupResource(resourceId,signal);},sweepOnce(){return active().sweepOnce();},getStatus(){return active().getStatus();},close(){return closing??=(async()=>{if(cleanup)await cleanup.close();closed=true;})();}});
 constructions.set(result,{construction,database:db,materials,activate(){current();if(cleanup)throw Error('maintenance_staging_active');const binding=readMaintenanceExecution(execution,db);cleanup=createStagingFactualCleanup({database:db,materials,raw:binding.raw,maintenance:execution,assertCurrent:current});}});
 bindInstalledMaintenanceMaterialsConstruction(construction,result,materials);return result;
}
