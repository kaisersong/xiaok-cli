import {preparePublicCase,prepareExportedArrayMutation} from './application-own-data-r64-fixtures.js';
import {preparePoisonInstaller} from './application-own-data-r64-patches.js';
import {prepareAsciiBoundaryReader} from './application-own-data-r65-ascii-public-fixtures.js';
import {matrixFactories,negativeFactories} from './application-own-data-r64-matrix-fixtures.js';
import {publishedArtifactPopulation} from '../../src/runtime/verification/published-artifact-index.js';
import {ownDataArrayPrototypeMap,ownDataArrayPrototypeFilter,ownDataArrayPrototypeFlatMap} from '../../src/runtime/verification/application-native-intrinsics.js';
const json=JSON.stringify, nativeError=Error;
function prepareSpecies(entry,variant){const input=[1,2];if(entry==='ownDataArrayPrototypeMap')return {invoke:()=>ownDataArrayPrototypeMap(input,x=>x+1)};if(entry==='ownDataArrayPrototypeFilter')return {invoke:()=>ownDataArrayPrototypeFilter(input,x=>x>1)};if(entry==='ownDataArrayPrototypeFlatMap')return {invoke:()=>ownDataArrayPrototypeFlatMap(input,x=>[x,x+1])};return preparePublicCase(entry,variant);}
const task=JSON.parse(process.argv[2]);
function snapshot(result){if(task.entry==='createPublishedArtifactIndex')return json({population:publishedArtifactPopulation(result)});return result===undefined?'undefined':json(result);}
function observe(prepared){let value,error;try{value=prepared.invoke()}catch(e){error=e}return {value,error};}
function finishObservation(observation){return {success:!observation.error,error:observation.error?.message,semantic:observation.error?undefined:snapshot(observation.value)};}
let receipt;
try{
 if(task.kind==='matrix'){
  const prepared=matrixFactories[task.index]();const observed=observe(prepared);
  receipt={...task,...finishObservation(observed),getterCalls:prepared.getterCalls()};
  receipt.pass=receipt.error===task.expectedError&&receipt.getterCalls===0;
 }else{
  const prepare=()=>task.kind==='species'?prepareSpecies(task.entry,task.variant):task.kind==='negative'?negativeFactories[task.index]():task.kind==='ascii'?prepareAsciiBoundaryReader(task.index):preparePublicCase(task.entry,task.variant);
  const baseline=finishObservation(observe(prepare()));
  if(task.kind==='baseline')receipt={...task,baseline,pass:baseline.success};
  else{
   // Both fresh case and recovery case plus installer are ready before patch.
   const fresh=prepare(),recovery=prepare();const installer=task.kind==='export'?prepareExportedArrayMutation(task.name):preparePoisonInstaller(task.operation);
   let patch,observed,poisonCalls=0,installationError;
   try{patch=installer();observed=observe(fresh);if(task.kind!=='export')poisonCalls=patch.calls();}catch(e){installationError=e;}finally{patch?.restore();}
   const patched=observed?finishObservation(observed):{success:false,error:installationError?.message};
   const restored=finishObservation(observe(recovery));
   const descriptorRestored=task.kind==='export'?undefined:patch?.descriptorRestored();
   const expectedValid=task.kind!=='negative'&&task.kind!=='descriptor-negative';
   const expectedBaseline=expectedValid?baseline.success:baseline.error===task.expectedError;
   receipt={...task,baseline,patched,restored,poisonCalls,installationError:installationError?.message,
    descriptorRestored,artifactReturned:observed?.value!==undefined,pass:expectedBaseline&&!installationError&&(task.kind==='export'||descriptorRestored===true)&&poisonCalls===0&&json(patched)===json(baseline)&&json(restored)===json(baseline)};
   if(task.compatibilityCharacterization)receipt.pass=baseline.success&&!installationError&&poisonCalls===1&&patched.success===false&&patched.error==='loop_application_trigger'&&observed?.value===undefined&&descriptorRestored===true&&json(restored)===json(baseline);
   if(task.kind==='ascii')receipt.rawLoopReachableThroughPublicCanonicalJson=fresh.boundary.rawLoopReachableThroughCanonicalJson;
  }
 }
}catch(e){receipt={...task,setupError:e?.message,pass:false};}
process.stdout.write(json(receipt)+'\n');
