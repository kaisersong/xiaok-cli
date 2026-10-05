// Host-only official environment qualification; no network or configuration writes.
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const recipeManifestSemanticSha256='a0e31c572efb0fbf2723ac56a6c65caf22efd931ac60458a7d38c1e255b21417';
export const recipeManifestFileSha256='50117314e0001bac768e500792d951f9b80fef8b97204a7dc6cd857a9a2713dd';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyRecipeEnvironment({sourceRoot,environmentPath,manifestPath,expected,loadProduction,capacityIdentity,manifestSnapshotPath}){
 let registration;
 try{
  const environmentBytes=await fs.readFile(environmentPath),manifestBytes=await fs.readFile(manifestPath);
  if(sha(manifestBytes)!==recipeManifestFileSha256)throw Error('manifest-bytes');
  if(manifestSnapshotPath&&sha(await fs.readFile(manifestSnapshotPath))!==recipeManifestFileSha256)throw Error('manifest-snapshot');
  const environment=JSON.parse(environmentBytes),environmentManifest=JSON.parse(manifestBytes);
  if(environmentManifest.sha256!==recipeManifestSemanticSha256)throw Error('manifest-semantic');
  const identity={environmentPath:await fs.realpath(environmentPath),manifestPath:await fs.realpath(manifestPath),environmentSha256:sha(environmentBytes),manifestFileSha256:sha(manifestBytes),manifestSemanticSha256:environmentManifest.sha256};
  if(expected&&JSON.stringify(identity)!==JSON.stringify(expected))throw Error('environment-binding');
  if(!loadProduction){const {register}=await import(pathToFileURL(join(sourceRoot,'node_modules/tsx/dist/esm/api/index.mjs')).href);registration=register({namespace:randomUUID()});}
  const load=loadProduction??(file=>registration.import(join(sourceRoot,file),import.meta.url));
  const {freezeDeepSeekRecipeCounter}=await load('src/runtime/sol-pi/deepseek-capacity-profile.ts');
  const counter=freezeDeepSeekRecipeCounter({...environment,environmentManifest});
  if(capacityIdentity){const {resolveProductionCapacityProfile}=await load('src/runtime/sol-pi/capacity-admission.ts');if(!resolveProductionCapacityProfile({...capacityIdentity,counter}))throw Error('capacity-identity');}
  return {identity,environment,environmentManifest,counter};
 }catch(cause){throw new Error('SOLPI_RECIPE_ENVIRONMENT_INVALID',{cause});}finally{await registration?.unregister();}
}
