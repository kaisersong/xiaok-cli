import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyRecipeEnvironment,selectRegisteredRecipeManifest} from '../../scripts/evals/sol-pi/paired-environment.mjs';

const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));
const environmentPath=process.env.SOL_PI_DEEPSEEK_COUNTER_ENV;
const manifestPath=process.env.SOL_PI_CURRENT_RECIPE_MANIFEST;
const qualified=Boolean(environmentPath&&manifestPath);
const capacityIdentity={destination:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',protocol:'openai_legacy',profileId:'generic-openai'};
const production=file=>import(pathToFileURL(resolve(sourceRoot,file)).href);

test('prepare selection loads the actual candidate production selector',async()=>{
 const root=await mkdtemp(join(tmpdir(),'solpi-prepare-selection-'));
 try{
  assert.equal(await selectRegisteredRecipeManifest({sourceRoot,environmentRoot:root}),join(root,'manifest.json'));
  await writeFile(join(root,'manifest.2026-10-06.json'),'{');
  assert.equal(await selectRegisteredRecipeManifest({sourceRoot,environmentRoot:root}),join(root,'manifest.2026-10-06.json'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('prepare selection cannot fall back when candidate production selector is missing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'solpi-prepare-missing-'));
 try{await assert.rejects(selectRegisteredRecipeManifest({sourceRoot:root,environmentRoot:root}));}
 finally{await rm(root,{recursive:true,force:true});}
});
test('selected partial, unknown, directory and symlink entries deny before invoking the factory',{skip:!qualified},async()=>{
 const root=await mkdtemp(join(tmpdir(),'solpi-prepare-reject-'));
 let calls=0;const loadProduction=file=>{calls++;return production(file);};
 try{
  await writeFile(join(root,'environment.json'),await readFile(environmentPath));
  for(const kind of ['partial','unknown','directory',...(process.platform==='win32'?[]:['dangling','regular'])]){
   const selected=join(root,'manifest.2026-10-06.json');
   if(kind==='directory')await mkdir(selected);
   else if(kind==='dangling')await symlink(join(root,'missing.json'),selected);
   else if(kind==='regular')await symlink(manifestPath,selected);
   else await writeFile(selected,kind==='partial'?'{':'{}');
   assert.equal(await selectRegisteredRecipeManifest({sourceRoot,environmentRoot:root}),selected);
   await assert.rejects(verifyRecipeEnvironment({sourceRoot,environmentPath:join(root,'environment.json'),manifestPath:selected,loadProduction}),/RECIPE_ENVIRONMENT_INVALID/);
   assert.equal(calls,0);
   await rm(selected,{recursive:true,force:true});
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('current host artifact qualifies through the actual factory without writing its installed registration',{skip:!qualified},async()=>{
  const before=await readFile(manifestPath);
  const value=await verifyRecipeEnvironment({sourceRoot,environmentPath,manifestPath,capacityIdentity,manifestSnapshotPath:manifestPath});
  assert.equal(value.identity.manifestSemanticSha256,'bda655eb6c90b5e0fa9abddbe250a1fb1153e918dcd613801032e2114aaf4908');
  assert.deepEqual(await readFile(manifestPath),before);
});
test('candidate registration loads independently while the supplied factory remains actual production',{skip:!qualified},async()=>{
  const root=await mkdtemp(join(tmpdir(),'solpi-recipe-loader-'));
  const calls=[];
  try{
    const value=await verifyRecipeEnvironment({sourceRoot:root,registrationSourceRoot:sourceRoot,environmentPath,manifestPath,capacityIdentity,
      loadProduction:file=>{calls.push(file);return production(file);}});
    assert.deepEqual(calls,['src/runtime/sol-pi/deepseek-capacity-profile.ts','src/runtime/sol-pi/capacity-admission.ts']);
    const {resolveProductionCapacityProfile,checkRequestCapacity}=await production('src/runtime/sol-pi/capacity-admission.ts');
    const profile=resolveProductionCapacityProfile({...capacityIdentity,counter:value.counter});
    assert.ok(profile);
    assert.equal(checkRequestCapacity(profile,{...capacityIdentity,serializedBody:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'Reply OK.'}],thinking:{type:'disabled'},max_tokens:1,stream:false})}).inputTokenUpperBound,7);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('snapshot drift and unknown registrations reject before calling the factory',{skip:!qualified},async()=>{
  const root=await mkdtemp(join(tmpdir(),'solpi-recipe-reject-'));
  let calls=0;const loadProduction=file=>{calls++;return production(file);};
  try{
    const wrong=join(root,'manifest.json');await writeFile(wrong,'{}');
    await assert.rejects(verifyRecipeEnvironment({sourceRoot,environmentPath,manifestPath,manifestSnapshotPath:wrong,loadProduction}),/RECIPE_ENVIRONMENT_INVALID/);
    await assert.rejects(verifyRecipeEnvironment({sourceRoot,environmentPath,manifestPath:wrong,loadProduction}),/RECIPE_ENVIRONMENT_INVALID/);
    assert.equal(calls,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('missing candidate registry cannot fall back to the arm factory or its table',{skip:!qualified},async()=>{
  const root=await mkdtemp(join(tmpdir(),'solpi-recipe-missing-'));
  let calls=0;
  try{
    await assert.rejects(verifyRecipeEnvironment({sourceRoot,registrationSourceRoot:root,environmentPath,manifestPath,
      loadProduction:file=>{calls++;return production(file);}}),/RECIPE_ENVIRONMENT_INVALID/);
    assert.equal(calls,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
