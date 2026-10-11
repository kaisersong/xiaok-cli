import {afterEach,describe,expect,it} from 'vitest';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isRegisteredRecipeManifest,selectRecipeManifestPath} from '../../../src/runtime/sol-pi/recipe-environment-registration.js';

const original=['50117314e0001bac768e500792d951f9b80fef8b97204a7dc6cd857a9a2713dd','a0e31c572efb0fbf2723ac56a6c65caf22efd931ac60458a7d38c1e255b21417'] as const;
const current=['969176f17fbe17fae8ae51b73746019f78e5739fb97005d39f99a8aa1c7e90a3','bda655eb6c90b5e0fa9abddbe250a1fb1153e918dcd613801032e2114aaf4908'] as const;
describe('fixed official recipe manifest registrations',()=>{
  it.each([original,current])('accepts the complete registered pair %s',(bytes,semantic)=>{
    expect(isRegisteredRecipeManifest(bytes,semantic)).toBe(true);
  });
  it.each([
    [original[0],current[1]],[current[0],original[1]],
    ['0'.repeat(64),current[1]],[current[0],'0'.repeat(64)],
    [current[0].slice(1),current[1]],[current[0],current[1].toUpperCase()],
  ])('rejects unknown, crossed or modified pair %s',(bytes,semantic)=>{
    expect(isRegisteredRecipeManifest(bytes,semantic)).toBe(false);
  });
  it('does not invoke caller conversion or Proxy traps when matching data',()=>{
    let calls=0;
    const raw=new Proxy({toString(){calls++;return current[0];}},{get(){calls++;throw Error('caller getter');}});
    expect(isRegisteredRecipeManifest(raw,current[1])).toBe(false);
    expect(isRegisteredRecipeManifest(current[0],raw)).toBe(false);
    expect(calls).toBe(0);
    expect(isRegisteredRecipeManifest(...current)).toBe(true);
  });
});

const roots:string[]=[];
function directory(){const root=mkdtempSync(join(tmpdir(),'solpi-manifest-selection-'));roots.push(root);return root;}
afterEach(()=>{for(const root of roots.splice(0)){chmodSync(root,0o700);rmSync(root,{recursive:true,force:true,maxRetries:3});}});
describe('recipe registration snapshot selection',()=>{
  it('selects the original path when no new directory entry exists',()=>{
    const root=directory();writeFileSync(join(root,'manifest.json'),'original');
    expect(selectRecipeManifestPath(root)).toBe(join(root,'manifest.json'));
  });
  it.each(['qualified','partial','unknown'])('selects an existing %s entry without granting it qualification',body=>{
    const root=directory();writeFileSync(join(root,'manifest.json'),'original');
    const selected=join(root,'manifest.2026-10-06.json');writeFileSync(selected,body==='partial'?'{':body);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it.skipIf(process.platform==='win32').each(['dangling','regular'])('does not fall back past a %s symlink',kind=>{
    const root=directory(),target=join(root,'target.json');
    if(kind==='regular')writeFileSync(target,'unknown');
    const selected=join(root,'manifest.2026-10-06.json');symlinkSync(target,selected);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it('does not treat a directory at the new entry as absence',()=>{
    const root=directory(),selected=join(root,'manifest.2026-10-06.json');mkdirSync(selected);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it.skipIf(process.platform==='win32')('propagates a real POSIX ENOTDIR rather than returning an original path',()=>{
    const root=directory(),file=join(root,'file');writeFileSync(file,'file');
    expect(()=>selectRecipeManifestPath(file)).toThrow(expect.objectContaining({code:'ENOTDIR'}));
  });
  it.skipIf(process.platform==='win32'||process.getuid?.()===0)('propagates a real EACCES rather than returning an original path',()=>{
    const root=directory();chmodSync(root,0);
    try{expect(()=>selectRecipeManifestPath(root)).toThrow(expect.objectContaining({code:'EACCES'}));}finally{chmodSync(root,0o700);}
  });
});

const fresh=['7f0a028c0ca6331b3cf8550fe341e1b3d2a896ebb890d68633624c7b83c8d71f','ab755e9b459899999917365262f713f5907fe335acebc14b6669768fa3d10c40'] as const;
describe('fresh fixed recipe manifest registration',()=>{
  it('accepts the exact independently qualified fresh pair',()=>{
    expect(isRegisteredRecipeManifest(...fresh)).toBe(true);
  });
  it.each([
    [fresh[0],original[1]],[original[0],fresh[1]],
    [fresh[0],current[1]],[current[0],fresh[1]],
    ['0'.repeat(64),fresh[1]],[fresh[0],'0'.repeat(64)],
    [fresh[0].slice(1),fresh[1]],[fresh[0],fresh[1].toUpperCase()],
  ])('rejects crossed or modified fresh pair %s',(bytes,semantic)=>{
    expect(isRegisteredRecipeManifest(bytes,semantic)).toBe(false);
  });
  it('does not call conversion or Proxy traps for fresh pair matching',()=>{
    let calls=0;
    const raw=new Proxy({toString(){calls++;return fresh[0];}},{get(){calls++;throw Error('caller getter');}});
    expect(isRegisteredRecipeManifest(raw,fresh[1])).toBe(false);
    expect(isRegisteredRecipeManifest(fresh[0],raw)).toBe(false);
    expect(calls).toBe(0);
  });
});
describe('fresh recipe registration snapshot selection',()=>{
  it.each(['qualified','partial','unknown'])('selects the fresh %s entry without falling back or granting qualification',body=>{
    const root=directory();
    writeFileSync(join(root,'manifest.json'),'original');
    writeFileSync(join(root,'manifest.2026-10-06.json'),'previous');
    const selected=join(root,'manifest.2026-10-07.json');writeFileSync(selected,body==='partial'?'{':body);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it.skipIf(process.platform==='win32').each(['dangling','regular'])('selects a fresh %s symlink for the qualification gate to reject',kind=>{
    const root=directory(),target=join(root,'target.json');
    writeFileSync(join(root,'manifest.2026-10-06.json'),'previous');
    if(kind==='regular')writeFileSync(target,'unknown');
    const selected=join(root,'manifest.2026-10-07.json');symlinkSync(target,selected);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it('selects a directory at the fresh entry rather than treating it as absence',()=>{
    const root=directory(),selected=join(root,'manifest.2026-10-07.json');
    writeFileSync(join(root,'manifest.2026-10-06.json'),'previous');mkdirSync(selected);
    expect(selectRecipeManifestPath(root)).toBe(selected);
  });
  it('preserves previous and original selection when the fresh entry is absent',()=>{
    const root=directory();writeFileSync(join(root,'manifest.json'),'original');
    expect(selectRecipeManifestPath(root)).toBe(join(root,'manifest.json'));
    writeFileSync(join(root,'manifest.2026-10-06.json'),'previous');
    expect(selectRecipeManifestPath(root)).toBe(join(root,'manifest.2026-10-06.json'));
  });
});
