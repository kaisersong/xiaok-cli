// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),yaml=require('js-yaml');
it('prepares the fixed host SDK and exact target before all three existing CI packaging jobs',()=>{
 const root=resolve(import.meta.dirname,'../../..');const targets:string[]=[];
 for(const filename of ['desktop-release.yml','desktop-cross-platform.yml']){
  const workflow=yaml.load(readFileSync(resolve(root,'.github/workflows',filename),'utf8'));
  for(const job of Object.values(workflow.jobs) as any[]){const steps=job.steps??[],build=steps.findIndex((step:any)=>step.name==='Build desktop');if(build<0)continue;
   const prep=steps.findIndex((step:any)=>step.name==='Prepare verified artifact export helper'),install=steps.findIndex((step:any)=>step.name==='Install root dependencies');expect(install).toBeGreaterThanOrEqual(0);expect(prep).toBeGreaterThan(install);expect(prep).toBeLessThan(build);
   const platform=String(job['runs-on']).startsWith('macos')?'darwin-arm64':'win32-x64';targets.push(platform);expect(steps[prep].run.trim().split('\n')).toEqual(['node scripts/verification/prepare-artifact-export-toolchain.mjs',`node scripts/verification/build-artifact-export-helper.mjs --target ${platform}`,'cd desktop && npm run test -- --run tests/main/artifact-export-package.test.ts']);expect(steps[prep].env.XIAOK_EXPORT_PACKAGE_INTEGRATION).toBe('1');
   const pack=steps.findIndex((step:any)=>String(step.run??'').includes('npx electron-builder'));expect(pack).toBeGreaterThan(build);
  }
 }
 expect(targets.sort()).toEqual(['darwin-arm64','win32-x64','win32-x64']);
});
