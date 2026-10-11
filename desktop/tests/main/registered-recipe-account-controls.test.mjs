// @vitest-environment node
import {it,expect,inject} from 'vitest';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readFileSync,chmodSync,lstatSync,renameSync,symlinkSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotOfficialRecipe,installOfficialRecipeSnapshot} from '../fixtures/registered-recipe-account-core.mjs';
import {verifyRecipeEnvironment} from '../../../scripts/evals/sol-pi/paired-environment.mjs';
const snapshot=inject('registeredRecipeFixtureSnapshot'),accountRoot=inject('profileTestAccountRoot');
const root=join(homedir(),'.cache','xiaok','sol-pi','deepseek-recipe-0.1.1'),sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
it('actual isolated registered metadata passes the official real recipe counter factory, no fabricated registration',async()=>{
 for(const e of snapshot.entries)expect(createHash('sha256').update(readFileSync(join(root,e.name))).digest('hex')).toBe(e.sha256);
 const actual=await verifyRecipeEnvironment({sourceRoot,environmentPath:join(root,'environment.json'),manifestPath:join(root,snapshot.selectedName)});
 expect(actual.identity.manifestFileSha256).toBe(snapshot.entries.find(e=>e.name===snapshot.selectedName).sha256);expect(actual.identity.manifestSemanticSha256).toBe(snapshot.manifestSemanticSha256);expect(actual.counter).toBeDefined();
},30000);
it('rejects existing owned target instead of replacing metadata',()=>expect(()=>installOfficialRecipeSnapshot(snapshot,accountRoot)).toThrow());
it('rejects metadata drift before writing an existing owned target',()=>{const altered=structuredClone(snapshot);altered.entries[0].base64=Buffer.from('{}').toString('base64');expect(()=>installOfficialRecipeSnapshot(altered,accountRoot)).toThrow('registered_recipe_fixture_snapshot_drift');});
it('rejects nonowned account namespace before touching it',()=>expect(()=>installOfficialRecipeSnapshot(snapshot,dirname(accountRoot))).toThrow());
it('rejects unsafe source metadata permissions before any counter',async()=>{const p=join(root,snapshot.selectedName),mode=lstatSync(p).mode;chmodSync(p,0o666);try{await expect(snapshotOfficialRecipe(sourceRoot)).rejects.toThrow('registered_recipe_fixture_node_unsafe');}finally{chmodSync(p,mode);}});
it('rejects source symlink before any counter',async()=>{const p=join(root,snapshot.selectedName),backup=p+'.owned-backup';renameSync(p,backup);symlinkSync(backup,p);try{await expect(snapshotOfficialRecipe(sourceRoot)).rejects.toThrow('registered_recipe_fixture_node_unsafe');}finally{unlinkSync(p);renameSync(backup,p);}});
it('rejects unregistered selected source bytes before any counter',async()=>{const p=join(root,snapshot.selectedName),backup=p+'.owned-backup';renameSync(p,backup);const {writeFileSync,rmSync}=await import('node:fs');writeFileSync(p,'{}',{mode:0o400,flag:'wx'});try{await expect(snapshotOfficialRecipe(sourceRoot)).rejects.toThrow('registered_recipe_fixture_manifest_unregistered');}finally{rmSync(p);renameSync(backup,p);}});
