import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {authorizeCliValidationMaterials} from '../../src/commands/validation-materials.js';
it('requires explicit per-file selection and prints review without printing private handles',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'cli-validation-'))),file=join(root,'source.ts');writeFileSync(file,'source');
 const hash='a'.repeat(64),invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},exactCommand={argv:['node','verify.cjs'],cwdRelative:'.'};
 const client={prepareMaterialAuthorization:vi.fn(async(draft:any)=>({challengeId:'challenge',canonicalReview:{...draft,materials:[{path:file,byteLimit:6,sha256:hash,size:6}],scopeDigest:hash,engineBinding:{engineId:'engine',incarnation:'epoch'}}})),authorizeMaterialChallenge:vi.fn(async()=>({id:'grant',secret:'this-is-private-grant'})),prepareValidationInput:vi.fn(async()=>({mountPlanHandle:{id:'mount',secret:'this-is-private-mount'},invocation,command:exactCommand,scopeDigest:hash}))};
 const output=vi.fn(),operation={purpose:'isolated-validation' as const,invocation,exactCommand,editedFile:{path:file,afterHash:hash},expiresAt:Date.now()+60000};
 try{
 await expect(authorizeCliValidationMaterials({requestSource:'user',selectedPaths:[],cwd:root,operation,client,writeReview:output,assertCurrent:()=>{}})).rejects.toThrow(/selection/);expect(client.prepareMaterialAuthorization).not.toHaveBeenCalled();
 const result=await authorizeCliValidationMaterials({requestSource:'user',selectedPaths:['source.ts'],cwd:root,operation,client,writeReview:output,assertCurrent:()=>{}});
 expect(output.mock.calls[0][0]).toContain(file);expect(output.mock.calls[0][0]).toContain(hash);expect(JSON.stringify(output.mock.calls)).not.toContain('this-is-private');expect(JSON.stringify(result)).not.toContain('this-is-private');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('actual CLI rejects material flags without explicit compound policy before model startup',async()=>{
 const {spawnSync}=await import('node:child_process');const {resolve}=await import('node:path');
 const result=spawnSync(process.execPath,['--import','tsx',resolve('src/index.ts'),'chat','--validation-material','one.ts','--validation-material','two.ts','--print','test'],{encoding:'utf8',timeout:15000});
 expect(result.status).toBe(2);expect(result.stdout+result.stderr).toContain('SOL_PI_VALIDATION_POLICY_REQUIRED');
},20000);

it.skipIf(process.platform!=='darwin'||process.arch!=='arm64'||!existsSync(join(homedir(),'.cache/xiaok/sol-pi/deepseek-recipe-0.1.1/environment.json'))||existsSync('/Library/Application Support/xiaok-verification/deployment.json'))('actual CLI refuses uninstalled protected execution before any model or file side effect',async()=>{
 const {spawnSync}=await import('node:child_process');const {resolve}=await import('node:path');
 const child=spawnSync(process.execPath,[resolve('tests/support/sol-pi-cli-compound-smoke.mjs'),'--protected-materials'],{encoding:'utf8',timeout:75000});
 expect(child.status,child.stderr).toBe(0);const report=JSON.parse(child.stdout.trim());expect(report.status).not.toBe(0);expect(report.calls).toBe(0);expect(report.content).toBeNull();expect(report.configModel).toBe('old-alias');expect(report.diagnostic).toContain('SOL_PI_VERIFICATION_UNAVAILABLE');expect(report.crashes[0].error.code).toBe('ENOENT');
},80000);
