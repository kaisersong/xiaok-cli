import {it,expect,vi,afterEach} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';import {join} from 'node:path';import {homedir} from 'node:os';
import {createProductObservationOwner,parseObservationPolicyFile} from '../../../src/runtime/sol-pi/product-bootstrap.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';import {PermissionManager} from '../../../src/ai/permissions/manager.js';
import {selectRegisteredRecipeManifest,verifyRecipeEnvironment} from '../../../scripts/evals/sol-pi/paired-environment.mjs';
import {fileURLToPath} from 'node:url';
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const negativeEnvironment=process.env.SOL_PI_RECIPE_NEGATIVE_ENV;
const negativeOldManifest=process.env.SOL_PI_RECIPE_NEGATIVE_OLD_MANIFEST;
const qualifiedNegativeHost=process.platform==='darwin'&&process.arch==='arm64'&&Boolean(negativeEnvironment&&negativeOldManifest);
// This native negative bucket needs real previously registered source data.
// It never copies or asserts a successful ProductOwner/SDK qualification.
const root=join(homedir(),'.cache','xiaok','sol-pi','deepseek-recipe-0.1.1');
afterEach(()=>{vi.restoreAllMocks();rmSync(root,{recursive:true,force:true});});
it.skipIf(!qualifiedNegativeHost).each(['unknown','partial','directory','dangling','regular'])('actual ProductBootstrap and paired qualification reject selected newest %s before counter/native SDK',async kind=>{
 mkdirSync(root,{recursive:true});writeFileSync(join(root,'environment.json'),readFileSync(negativeEnvironment!));
 // Copies are negative fixture data only; no successful qualification is asserted.
 writeFileSync(join(root,'manifest.2026-10-07.json'),readFileSync(negativeOldManifest!));
 const selected=join(root,'manifest.2026-10-10-r1.json');
 if(kind==='directory')mkdirSync(selected);else if(kind==='dangling')symlinkSync(join(root,'missing.json'),selected);else if(kind==='regular')symlinkSync(join(root,'manifest.2026-10-07.json'),selected);else writeFileSync(selected,kind==='partial'?'{':'{}');
 const file=join(root,'material.txt');writeFileSync(file,'negative fixture');const policy=join(root,'policy.json');
 writeFileSync(policy,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:file,startLine:1}],bashSources:[]}));
 const persist=vi.fn(async()=>{}),session=new AgentSessionState();const owner=createProductObservationOwner({policy:parseObservationPolicyFile(policy),session,profileRoot:join(root,'profile'),environmentRoot:root,credentialSecrets:[],persist,permissionManager:new PermissionManager({mode:'auto'})});
 const expected=kind==='unknown'?'SOL_PI_PRODUCT_ENVIRONMENT_MANIFEST':kind==='directory'?'SOL_PI_PRODUCT_UNSAFE_FILE':kind==='partial'?/JSON|Expected property|Unexpected/: 'SOL_PI_PRODUCT_ENVIRONMENT_PERMISSIONS';
 await expect(owner).rejects.toThrow(expected);expect(persist).not.toHaveBeenCalled();
 const pairedSelected=await selectRegisteredRecipeManifest({sourceRoot,environmentRoot:root});expect.soft(pairedSelected).toBe(selected);
 let factoryLoads=0;let error;
 try{await verifyRecipeEnvironment({sourceRoot,registrationSourceRoot:sourceRoot,environmentPath:join(root,'environment.json'),manifestPath:pairedSelected,loadProduction:async file=>{factoryLoads++;return import(new URL('../../../'+file.replace(/\.js$/,'.ts'),import.meta.url).href);}});}catch(e){error=e;}
 expect(error).toBeInstanceOf(Error);if(!(error instanceof Error))throw new TypeError('recipe_error_not_error');expect(error.message).toBe('SOLPI_RECIPE_ENVIRONMENT_INVALID');expect(factoryLoads).toBe(0);
});
